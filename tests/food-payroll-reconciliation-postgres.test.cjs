/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002-C2 — conciliación, ajustes y cierre definitivo contra PostgreSQL real aislado.
// node --require ./tests/helpers/server-only-register.cjs --import tsx --test tests/food-payroll-reconciliation-postgres.test.cjs
// Requiere RUN_FOOD_PAYROLL_DB_TESTS=1. Crea fixtures QA-FIXTURE-* propios y los elimina al terminar.
// Escala opcional: YF_RECON_TEST_EMPLOYEES (mínimo 520 colaboradores en el lote masivo).
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');

const done = new Map();
function scenario(n, name) {
  assert.ok(!done.has(n), `escenario ${n} repetido`);
  done.set(n, name); console.log(`ESCENARIO OK ${String(n).padStart(2, '0')}: ${name}`);
}
const cents = v => Math.round(Number(v) * 100);
const money = c => (c / 100).toFixed(2);

test('conciliación C2: masiva, diferencias, ajustes, cierre, concurrencia, inmutabilidad, permisos y reportes', {
  skip: process.env.RUN_FOOD_PAYROLL_DB_TESTS !== '1', timeout: 900000,
}, async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const ExcelJS = require('exceljs');
  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const marker = `QA-FIXTURE-RECON-${run}`;
  const ref = s => `QA-FIXTURE-${run}-${s}`.slice(0, 40);
  const qkey = () => `qa-fixture-${randomUUID()}`;
  const userIds = []; const employeeIds = []; const weekIds = [];
  const prevSecret = process.env.FOOD_PAYROLL_PREVIEW_SECRET;
  try {
    await assertIsolatedIdentity(db);
    process.env.FOOD_PAYROLL_PREVIEW_SECRET = `qa-fixture-secret-${randomUUID()}-${randomUUID()}`;
    globalThis.prisma = db;
    const mass = require('../lib/food-services/payroll-batch-mass.ts');
    const ops = require('../lib/food-services/payroll-batch-operations.ts');
    const rc = require('../lib/food-services/payroll-reconciliation.ts');
    const contract = require('../lib/food-services/payroll-reconciliation-contract.ts');
    const deps = { db };
    const code = c => err => { assert.equal(err.code, c, `esperado ${c}, recibido ${err.code}: ${err.message}`); return true; };
    const denied = err => { assert.equal(err.name, 'CorporateAuthorizationRequired', `esperado acceso restringido, recibido ${err.code}: ${err.message}`); return true; };
    const dbGuard = err => { assert.match(String(err.message), /YF_PAYROLL_GUARD|violates|duplicate key|unique|check constraint/i); return true; };

    const ALL = ['view', 'manage', 'view-payroll-batches', 'create-payroll-batch', 'void-payroll-batch', 'export-payroll-batch',
      'view-payroll-reconciliations', 'register-payroll-reconciliation', 'manage-payroll-adjustments', 'close-payroll-batch', 'export-payroll-control'];
    const mkUser = async (role, actions, label) => {
      const u = await db.user.create({ data: { name: `${marker}-${label}`, passwordMustChange: false, roles: { create: { role } } } });
      userIds.push(u.id);
      if (actions.length) await db.corporateModulePermission.createMany({ data: actions.map(actionKey => ({ userId: u.id, moduleKey: 'food-services', actionKey, granted: true })) });
      return { id: u.id, name: u.name, email: null, roles: [role], employee: null };
    };
    const rh = await mkUser('RH', ALL, 'rh');
    const rh2 = await mkUser('RH', ALL, 'rh2');
    const rhView = await mkUser('RH', ['view', 'manage', 'view-payroll-batches', 'view-payroll-reconciliations'], 'rh-consulta');
    const rhNoClose = await mkUser('RH', ALL.filter(a => a !== 'close-payroll-batch' && a !== 'manage-payroll-adjustments' && a !== 'export-payroll-control'), 'rh-sin-cierre');
    const rhNoManage = await mkUser('RH', ALL.filter(a => a !== 'manage'), 'rh-sin-manage');
    const chef = await mkUser('CHEF', ALL, 'chef');
    const admin = await mkUser('ADMIN', ALL, 'admin');

    // ---------------- fixtures: semanas propias y colaboradores ficticios
    const dept = await db.department.findFirstOrThrow();
    const shift = await db.workShift.findFirstOrThrow({ where: { active: true } });
    const base = Date.UTC(2296, 0, 1) + randomInt(0, 1500) * 7 * 86400000;
    const weeks = [];
    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(base + w * 7 * 86400000);
      const week = await db.menuWeek.create({ data: { weekStart, status: 'PUBLISHED' } }); weekIds.push(week.id);
      const items = [];
      for (let d = 0; d < 5; d++) {
        const day = await db.menuDay.create({ data: { menuWeekId: week.id, serviceDate: new Date(weekStart.getTime() + d * 86400000) } });
        items.push(await db.menuItem.create({ data: { menuDayId: day.id, name: `${marker} W${w}D${d}`, serviceType: 'LUNCH', price: '50.00' } }));
      }
      weeks.push({ week, items, day: weekStart.toISOString().slice(0, 10) });
    }
    const N = Math.max(520, Number(process.env.YF_RECON_TEST_EMPLOYEES) || 520);
    const mkEmployees = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: randomUUID(), employeeNumber: `${marker}-${prefix}${String(i).padStart(4, '0')}`,
      fullName: `${marker} ${prefix} Colaborador ${i}`, departmentId: dept.id, workShiftId: shift.id, pinHash: 'fictional-unusable', pinMustChange: false, status: 'ACTIVE' }));
    const e1 = mkEmployees('A', 6); const e2 = mkEmployees('B', 12); const e3 = mkEmployees('C', N);
    await db.employee.createMany({ data: [...e1, ...e2, ...e3] }); [...e1, ...e2, ...e3].forEach(e => employeeIds.push(e.id));
    const prices = ['35.50', '42.25', '62.00', '48.10'];
    const orders = []; const reservations = [];
    const addOrder = (e, w, qty = 1 + randomInt(0, 5), unit = prices[randomInt(0, prices.length)]) => {
      const id = randomUUID();
      orders.push({ id, employeeId: e.id, menuWeekId: weeks[w].week.id, itemCount: qty, unitPrice: unit, totalAmount: (Number(unit) * qty).toFixed(2), status: 'CONFIRMED', payrollStatus: 'PENDING' });
      for (const it of weeks[w].items.slice(0, qty)) reservations.push({ id: randomUUID(), employeeId: e.id, menuItemId: it.id, foodOrderId: id, status: 'ACTIVE' });
    };
    e1.forEach(e => addOrder(e, 0));
    e2.forEach(e => addOrder(e, 1));
    e3.forEach((e, i) => { addOrder(e, 2); if (i % 3 === 0) addOrder(e, 3); });
    for (let i = 0; i < orders.length; i += 1000) await db.foodOrder.createMany({ data: orders.slice(i, i + 1000) });
    for (let i = 0; i < reservations.length; i += 1000) await db.reservation.createMany({ data: reservations.slice(i, i + 1000) });

    const generateExported = async (label, from, to) => {
      const p = await mass.previewFoodPayrollPeriod(rh, { payrollReference: ref(label), weekFrom: weeks[from].day, weekTo: weeks[to].day }, deps);
      const g = await mass.createFoodPayrollPeriodBatch(rh, { payrollReference: ref(label), weekFrom: weeks[from].day, weekTo: weeks[to].day,
        reviewedInactiveOrderIds: [], previewToken: p.previewToken }, qkey(), deps);
      await ops.exportFoodPayrollBatch(rh, g.body.batchId, {}, deps);
      return g.body.batchId;
    };
    const b1 = await generateExported('S1', 0, 0);
    const b2 = await generateExported('S2', 1, 1);
    const b3 = await generateExported('S3', 2, 3);

    // ---------------- utilidades de archivo
    const templateRows = async (batchId) => {
      const t = await rc.downloadReconciliationTemplate(rh, batchId, deps);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.body);
      const ws = wb.getWorksheet('Conciliación'); const rows = [];
      for (let i = 2; i <= ws.rowCount; i++) {
        const r = ws.getRow(i);
        rows.push({ ref: r.getCell(1).value, batch: r.getCell(2).value, num: r.getCell(3).value, name: r.getCell(4).value, orders: r.getCell(5).value, expected: r.getCell(6).value });
      }
      return { template: t, rows };
    };
    const headers = ['Referencia de prenómina', 'Lote', 'No. colaborador', 'Colaborador', 'Pedidos', 'Importe esperado', 'Importe aplicado por Nómina', 'Comentario'];
    const makeFile = async (rows, { header = headers, sheet = 'Conciliación' } = {}) => {
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(sheet);
      ws.addRow(header);
      for (const r of rows) ws.addRow([r.ref, r.batch, r.num, r.name, r.orders, r.expected, r.applied === undefined ? null : r.applied, r.note ?? null]);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const full = rows => rows.map(r => ({ ...r, applied: r.expected }));
    const confirm = (actor, batchId, file, preview, key = qkey(), { deps: extraDeps = {}, ...meta } = {}) => rc.confirmReconciliation(actor, batchId, file,
      { fileName: 'conciliacion.xlsx', previewToken: preview.previewToken, ...meta }, key, { ...deps, ...extraDeps });
    const statusCounts = async batchId => Object.fromEntries((await db.foodOrder.groupBy({ by: ['payrollStatus'], where: { payrollItems: { some: { batchId } } }, _count: { _all: true } }))
      .map(g => [g.payrollStatus, g._count._all]));

    // =====================================================================================================
    // 1. Conciliación completa (plantilla real, todos los descuentos aplicados por completo)
    {
      const { template, rows } = await templateRows(b1);
      assert.equal(rows.length, 6); assert.ok(template.fileSha256.match(/^[0-9a-f]{64}$/));
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(template.body);
      const ws = wb.getWorksheet('Conciliación');
      for (let i = 2; i <= ws.rowCount; i++) ws.getRow(i).getCell(7).value = ws.getRow(i).getCell(6).value;
      const file = Buffer.from(await wb.xlsx.writeBuffer());
      const p = await rc.previewReconciliation(rh, b1, file, 'plantilla_llena.xlsx', deps);
      assert.equal(p.valid, true); assert.equal(p.totals.complete, 6); assert.equal(p.totals.pendingRecovery, '0.00');
      const c = await confirm(rh, b1, file, p);
      assert.equal(c.status, 201); assert.equal(c.body.adjustmentsCreated, 0);
      const batch = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b1 } });
      assert.equal(batch.status, 'PARTIALLY_RECONCILED');
      const closed = await rc.closeFoodPayrollBatch(rh, b1, { reconciliationId: c.body.reconciliationId, note: 'Cierre QA completo' }, deps);
      assert.equal(closed.processedOrders, 6); assert.equal(closed.pendingAdjustments, 0);
      const recon = await db.foodPayrollReconciliation.findUniqueOrThrow({ where: { id: c.body.reconciliationId } });
      assert.equal(recon.status, 'RECONCILED'); assert.ok(recon.closedAt);
      assert.deepEqual(await statusCounts(b1), { PROCESSED: 6 });
      assert.equal((await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b1 } })).status, 'RECONCILED');
    }
    scenario(1, 'conciliación completa con la plantilla: RECONCILED y 6/6 pedidos PROCESSED, sin ajustes');

    // ---------------- lote S2: validaciones estrictas
    const s2 = (await templateRows(b2)).rows;
    assert.equal(s2.length, 12);
    const exp2 = new Map(s2.map(r => [r.num, cents(r.expected)]));
    const b2Before = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b2 } });
    const errCodes = p => Object.keys(p.errorCounts).sort();

    // 6. Colaborador ausente del archivo
    {
      const file = await makeFile(full(s2).slice(1));
      const p = await rc.previewReconciliation(rh, b2, file, 'ausente.xlsx', deps);
      assert.equal(p.valid, false); assert.equal(p.previewToken, null); assert.equal(p.missingCount, 1);
      assert.deepEqual(errCodes(p), ['EMPLOYEE_MISSING']);
      assert.equal(p.errors[0].employeeNumber, s2[0].num);
      // Un token de otro archivo no sirve para confirmar este.
      const good = await makeFile(full(s2));
      const gp = await rc.previewReconciliation(rh, b2, good, 'bueno.xlsx', deps);
      await assert.rejects(confirm(rh, b2, file, gp), code('PREVIEW_MISMATCH'));
      assert.equal(await db.foodPayrollReconciliation.count({ where: { batchId: b2 } }), 0);
    }
    scenario(6, 'colaborador ausente: error EMPLOYEE_MISSING (no se interpreta como cero), sin token y sin registro');

    // 7. Colaborador desconocido
    {
      const rows = [...full(s2), { ref: ref('S2'), batch: b2, num: `${marker}-NOEXISTE`, name: 'Desconocido', orders: 1, expected: 10, applied: 10 }];
      const p = await rc.previewReconciliation(rh, b2, await makeFile(rows), 'desconocido.xlsx', deps);
      assert.equal(p.valid, false); assert.deepEqual(errCodes(p), ['UNKNOWN_EMPLOYEE']);
      // Colaborador real de otro lote: también desconocido para este lote.
      const other = await rc.previewReconciliation(rh, b2, await makeFile([...full(s2), { ref: ref('S2'), num: e1[0].employeeNumber, applied: 5 }]), 'otro.xlsx', deps);
      assert.deepEqual(errCodes(other), ['UNKNOWN_EMPLOYEE']);
    }
    scenario(7, 'colaborador desconocido o de otro lote: UNKNOWN_EMPLOYEE');

    // 8. Filas duplicadas
    {
      const rows = [...full(s2), { ...full(s2)[3] }];
      const p = await rc.previewReconciliation(rh, b2, await makeFile(rows), 'duplicado.xlsx', deps);
      assert.equal(p.valid, false); assert.deepEqual(errCodes(p), ['DUPLICATE_EMPLOYEE']); assert.equal(p.errors[0].row, 14);
    }
    scenario(8, 'filas duplicadas: DUPLICATE_EMPLOYEE con el renglón original');

    // 9. Importes inválidos, estructura y referencia
    {
      const rows = full(s2);
      rows[0].applied = -5; rows[1].applied = '12.345'; rows[2].applied = 'abc'; rows[3].applied = 12.345; rows[4].applied = '1,2'; rows[5].ref = 'OTRA-REF';
      const p = await rc.previewReconciliation(rh, b2, await makeFile(rows), 'invalidos.xlsx', deps);
      assert.equal(p.valid, false);
      assert.equal(p.errorCounts.AMOUNT_INVALID, 5); assert.equal(p.errorCounts.REFERENCE_MISMATCH, 1);
      const badExpected = full(s2); badExpected[0].expected = 1;
      assert.deepEqual(errCodes(await rc.previewReconciliation(rh, b2, await makeFile(badExpected), 'esperado.xlsx', deps)), ['EXPECTED_MISMATCH']);
      await assert.rejects(rc.previewReconciliation(rh, b2, await makeFile(full(s2), { header: headers.filter(h => !h.startsWith('Importe aplicado')) }), 'x.xlsx', deps), code('STRUCTURE_INVALID'));
      await assert.rejects(rc.previewReconciliation(rh, b2, await makeFile(full(s2), { sheet: 'Hoja1' }), 'x.xlsx', deps), code('STRUCTURE_INVALID'));
      await assert.rejects(rc.previewReconciliation(rh, b2, Buffer.from('no es excel'), 'x.csv', deps), code('FILE_FORMAT'));
      await assert.rejects(rc.previewReconciliation(rh, b2, Buffer.alloc(0), 'x.xlsx', deps), code('FILE_EMPTY'));
      // Texto con formato válido sí se acepta ("$1,234.50" y enteros).
      const fmt = full(s2); fmt[0].applied = `$${money(exp2.get(s2[0].num))}`;
      assert.equal((await rc.previewReconciliation(rh, b2, await makeFile(fmt), 'fmt.xlsx', deps)).valid, true);
    }
    scenario(9, 'importes inválidos (negativo, 3 decimales, texto), referencia ajena, esperado alterado y estructura: rechazados');

    // 4 (parte 1). Celda vacía: información faltante, distinguible del cero explícito
    {
      const blank = full(s2); blank[1].applied = undefined;
      const p = await rc.previewReconciliation(rh, b2, await makeFile(blank), 'vacio.xlsx', deps);
      assert.deepEqual(errCodes(p), ['AMOUNT_MISSING']);
      const zero = full(s2); zero[1].applied = 0;
      const z = await rc.previewReconciliation(rh, b2, await makeFile(zero), 'cero.xlsx', deps);
      assert.equal(z.valid, true); assert.equal(z.totals.notApplied, 1);
    }

    // 14 (parte 1). Reversión completa ante error durante la confirmación
    const mixed = full(s2);
    mixed[0].applied = money(exp2.get(s2[0].num) - 1050);  // parcial: faltan 10.50
    mixed[1].applied = 0;                                   // cero explícito
    mixed[2].applied = money(exp2.get(s2[2].num) + 1525);  // superior: sobran 15.25
    mixed[3].applied = money(exp2.get(s2[3].num) - 700);   // parcial que se condonará
    mixed[4].note = 'Aplicado en la quincena 23';
    assert.ok(exp2.get(s2[0].num) > 1050 && exp2.get(s2[3].num) > 700);
    const mixedFile = await makeFile(mixed);
    {
      const p = await rc.previewReconciliation(rh, b2, mixedFile, 'mixto.xlsx', deps);
      assert.equal(p.valid, true);
      await assert.rejects(confirm(rh, b2, mixedFile, p, qkey(), { deps: { onStage: s => { if (s === 'employees-created') throw new Error('QA: falla simulada'); } } }), /falla simulada/);
      assert.equal(await db.foodPayrollReconciliation.count({ where: { batchId: b2 } }), 0);
      assert.equal(await db.foodPayrollReconciliationEmployee.count({ where: { batchId: b2 } }), 0);
      assert.equal(await db.foodPayrollAdjustment.count({ where: { batchId: b2 } }), 0);
      assert.equal((await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b2 } })).status, 'EXPORTED');
    }

    // 10. Vista previa desactualizada (otra conciliación registrada y anulada después) y expirada
    {
      const pOld = await rc.previewReconciliation(rh, b2, mixedFile, 'mixto.xlsx', deps);
      const other = await makeFile(full(s2));
      const pOther = await rc.previewReconciliation(rh2, b2, other, 'otro.xlsx', deps);
      const cOther = await confirm(rh2, b2, other, pOther);
      await assert.rejects(rc.voidReconciliation(rh2, b2, { reconciliationId: cOther.body.reconciliationId, reason: 'corto' }, deps), code('INVALID_REQUEST'));
      const v = await rc.voidReconciliation(rh2, b2, { reconciliationId: cOther.body.reconciliationId, reason: 'Archivo equivocado de la quincena anterior' }, deps);
      assert.equal(v.status, 'EXPORTED');
      await assert.rejects(confirm(rh, b2, mixedFile, pOld), code('PREVIEW_STALE'));
      const payload = JSON.parse(Buffer.from(pOld.previewToken.split('.')[0], 'base64url').toString('utf8'));
      const expired = contract.signReconciliationToken({ ...payload, exp: Date.now() - 1000 });
      await assert.rejects(rc.confirmReconciliation(rh, b2, mixedFile, { fileName: 'm.xlsx', previewToken: expired }, qkey(), deps), code('PREVIEW_EXPIRED'));
      await assert.rejects(rc.confirmReconciliation(rh, b2, mixedFile, { fileName: 'm.xlsx', previewToken: `${pOld.previewToken.slice(0, -2)}xx` }, qkey(), deps), code('PREVIEW_INVALID'));
      await assert.rejects(confirm(rh2, b2, mixedFile, pOld), code('PREVIEW_ACTOR_MISMATCH'));
      const voided = await db.foodPayrollReconciliation.findUniqueOrThrow({ where: { id: cOther.body.reconciliationId } });
      assert.ok(voided.voidedAt); assert.equal(voided.voidedById, rh2.id);
    }
    scenario(10, 'vista previa desactualizada (PREVIEW_STALE), expirada, alterada o de otro usuario: rechazadas; anulación previa conservada');

    // 12. Conciliaciones concurrentes (claves distintas) sobre el mismo lote
    let recon2; let winner;
    {
      const pa = await rc.previewReconciliation(rh, b2, mixedFile, 'mixto.xlsx', deps);
      const pb = await rc.previewReconciliation(rh2, b2, mixedFile, 'mixto.xlsx', deps);
      const ka = qkey(); const kb = qkey();
      const race = await Promise.allSettled([confirm(rh, b2, mixedFile, pa, ka), confirm(rh2, b2, mixedFile, pb, kb)]);
      winner = race[0].status === 'fulfilled' ? { actor: rh, preview: pa, key: ka } : { actor: rh2, preview: pb, key: kb };
      assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(race.map(r => r.reason?.code)));
      assert.equal(race.find(r => r.status === 'rejected').reason.code, 'RECONCILIATION_EXISTS');
      assert.equal(await db.foodPayrollReconciliation.count({ where: { batchId: b2, voidedAt: null } }), 1);
      recon2 = race.find(r => r.status === 'fulfilled').value.body;
      assert.equal(recon2.adjustmentsCreated, 4);
    }
    scenario(12, 'conciliaciones concurrentes: una sola registrada, la otra RECONCILIATION_EXISTS');

    // 11. Conciliación duplicada: vista previa bloqueada, otra clave rechazada, misma clave reproducida, clave reutilizada
    {
      await assert.rejects(rc.previewReconciliation(rh, b2, mixedFile, 'mixto.xlsx', deps), code('RECONCILIATION_EXISTS'));
      const recon = await db.foodPayrollReconciliation.findUniqueOrThrow({ where: { id: recon2.reconciliationId } });
      assert.equal(recon.idempotencyKey, winner.key);
      // Doble envío con la misma clave: se reproduce la respuesta registrada, sin una segunda conciliación.
      const replay = await confirm(winner.actor, b2, mixedFile, winner.preview, winner.key);
      assert.equal(replay.status, 200); assert.equal(replay.replayed, true); assert.equal(replay.body.reconciliationId, recon2.reconciliationId);
      // Misma clave con otro archivo: clave reutilizada.
      const payload = JSON.parse(Buffer.from(winner.preview.previewToken.split('.')[0], 'base64url').toString('utf8'));
      const otherFile = await makeFile(full(s2));
      const forged = contract.signReconciliationToken({ ...payload, f: require('node:crypto').createHash('sha256').update(otherFile).digest('hex') });
      await assert.rejects(rc.confirmReconciliation(winner.actor, b2, otherFile, { fileName: 'x.xlsx', previewToken: forged }, winner.key, deps), code('IDEMPOTENCY_KEY_REUSED'));
      // Otra clave con la conciliación ya registrada.
      await assert.rejects(confirm(winner.actor, b2, mixedFile, winner.preview, qkey()), code('RECONCILIATION_EXISTS'));
      assert.equal(await db.foodPayrollReconciliation.count({ where: { batchId: b2, voidedAt: null } }), 1);
      assert.ok(await db.foodPayrollAuditEvent.count({ where: { batchId: b2, eventType: 'RECONCILIATION_REPLAYED' } }) >= 1);
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "FoodPayrollReconciliation" ("id","batchId","status","idempotencyKey","requestHash","idempotencyResponse","contractVersion",
        "payrollReference","previewDigest","fileName","expectedAmount","receivedAmount","reconciledAmount","unreconciledAmount","pendingRefundAmount","employeeCount","completeCount",
        "partialCount","notAppliedCount","overCount","evidenceSha256","evidenceContent","actorId") SELECT gen_random_uuid()::text, "batchId", 'RECEIVED', 'qa-fixture-dup-' || "id", "requestHash",
        "idempotencyResponse", 1, "payrollReference", "previewDigest", 'dup.xlsx', "expectedAmount", "receivedAmount", "reconciledAmount", "unreconciledAmount", "pendingRefundAmount",
        "employeeCount", "completeCount", "partialCount", "notAppliedCount", "overCount", "evidenceSha256", "evidenceContent", "actorId" FROM "FoodPayrollReconciliation" WHERE "id" = $1`, recon.id), dbGuard);
    }
    scenario(11, 'conciliación duplicada: reintento idempotente, clave reutilizada, otra clave e inserción directa rechazados');

    // 3, 4, 5. Resultados por colaborador y ajustes iniciales
    const adj = async num => db.foodPayrollAdjustment.findFirstOrThrow({ where: { batchId: b2, employeeNumber: num, reconciliationId: recon2.reconciliationId, parentAdjustmentId: null } });
    const empRow = num => db.foodPayrollReconciliationEmployee.findFirstOrThrow({ where: { reconciliationId: recon2.reconciliationId, employeeNumber: num } });
    {
      const r0 = await empRow(s2[0].num); const a0 = await adj(s2[0].num);
      assert.equal(r0.result, 'PARTIAL'); assert.equal(cents(r0.differenceAmount), -1050);
      assert.equal(a0.kind, 'PARTIAL'); assert.equal(cents(a0.balanceAmount), 1050); assert.equal(a0.status, 'PENDING');
      assert.equal(cents(a0.originalAmount), exp2.get(s2[0].num)); assert.equal(cents(a0.adjustedAmount), exp2.get(s2[0].num) - 1050);
      assert.equal(a0.batchItemId, null); assert.equal(a0.orderId, null);
    }
    {
      const r1 = await empRow(s2[1].num); const a1 = await adj(s2[1].num);
      assert.equal(r1.result, 'NOT_APPLIED'); assert.equal(cents(r1.appliedAmount), 0); assert.equal(a1.kind, 'NOT_APPLIED');
      assert.equal(cents(a1.balanceAmount), exp2.get(s2[1].num));
    }
    {
      const r2 = await empRow(s2[2].num); const a2 = await adj(s2[2].num);
      assert.equal(r2.result, 'OVER_APPLIED'); assert.equal(cents(r2.differenceAmount), 1525); assert.equal(a2.kind, 'OVER_APPLIED'); assert.equal(cents(a2.balanceAmount), -1525);
      const r4 = await empRow(s2[4].num); assert.equal(r4.result, 'COMPLETE'); assert.equal(r4.note, 'Aplicado en la quincena 23');
    }
    const state = await rc.getFoodPayrollReconciliation(rh, b2, { result: 'DIFFERENCES' }, deps);
    assert.equal(state.total, 4); assert.equal(state.kpis.employeesWithDifferences, 4); assert.equal(state.kpis.reconciledEmployees, 8);
    assert.equal(state.kpis.pendingRecovery, money(1050 + exp2.get(s2[1].num) + 700)); assert.equal(state.kpis.pendingRefund, '15.25');

    // 14 (parte 2). Reversión del cierre ante error
    {
      await assert.rejects(rc.closeFoodPayrollBatch(rh, b2, { reconciliationId: recon2.reconciliationId }, { ...deps, onStage: s => { if (s === 'orders-updated') throw new Error('QA: falla en cierre'); } }), /falla en cierre/);
      assert.equal((await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b2 } })).status, 'PARTIALLY_RECONCILED');
      assert.equal((await db.foodPayrollReconciliation.findUniqueOrThrow({ where: { id: recon2.reconciliationId } })).status, 'RECEIVED');
      assert.deepEqual(await statusCounts(b2), { PENDING: 12 });
      assert.equal(await db.foodPayrollAuditEvent.count({ where: { batchId: b2, eventType: 'BATCH_RECONCILED' } }), 0);
    }
    scenario(14, 'reversión completa: fallas en confirmación y cierre no dejan conciliación, ajustes, estados ni auditoría parciales');

    // 18. Autorización granular C-PANEL (servicio y transacción)
    {
      const f = await makeFile(full(s2));
      await assert.rejects(rc.previewReconciliation(rhView, b2, f, 'x.xlsx', deps), denied);
      await assert.rejects(rc.closeFoodPayrollBatch(rhNoClose, b2, { reconciliationId: recon2.reconciliationId }, deps), denied);
      await assert.rejects(rc.resolveFoodPayrollAdjustment(rhNoClose, (await adj(s2[0].num)).id, { resolutionType: 'RECOVERED', amount: '1.00', reference: 'QA', note: 'Intento sin permiso' }, deps), denied);
      await assert.rejects(rc.exportFoodPayrollControlReport(rhNoClose, b2, 'summary', deps), denied);
      for (const actor of [chef, admin, rhNoManage]) {
        await assert.rejects(rc.getFoodPayrollReconciliation(actor, b2, {}, deps), denied);
        await assert.rejects(rc.closeFoodPayrollBatch(actor, b2, { reconciliationId: recon2.reconciliationId }, deps), denied);
        await assert.rejects(rc.downloadReconciliationTemplate(actor, b2, deps), denied);
      }
      const v = await rc.getFoodPayrollReconciliation(rhView, b2, {}, deps); assert.equal(v.reconciliation.id, recon2.reconciliationId);
      await assert.rejects(rc.voidReconciliation(rhView, b2, { reconciliationId: recon2.reconciliationId, reason: 'Sin permiso de registro' }, deps), denied);
      const caps = await ops.getPayrollCapabilities(rhView.id, db);
      assert.deepEqual({ reconView: caps.reconView, reconcile: caps.reconcile, adjust: caps.adjust, close: caps.close, control: caps.control },
        { reconView: true, reconcile: false, adjust: false, close: false, control: false });
      assert.equal(Object.values(await ops.getPayrollCapabilities(admin.id, db)).some(Boolean), false);
      assert.equal(Object.values(await ops.getPayrollCapabilities(chef.id, db)).some(Boolean), false);
      // Permiso revocado entre la verificación inicial y la transacción: la transacción vuelve a verificar.
      await db.corporateModulePermission.updateMany({ where: { userId: rh2.id, actionKey: 'close-payroll-batch' }, data: { granted: false } });
      await assert.rejects(rc.closeFoodPayrollBatch(rh2, b2, { reconciliationId: recon2.reconciliationId }, deps), denied);
      await db.corporateModulePermission.updateMany({ where: { userId: rh2.id, actionKey: 'close-payroll-batch' }, data: { granted: true } });
      assert.equal((await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b2 } })).status, 'PARTIALLY_RECONCILED');
    }
    scenario(18, 'autorización granular: consulta sin registro, registro sin cierre/ajustes/control; CHEF, ADMIN y RH sin manage negados');

    // 15 (parte 1). Ajustes: protecciones antes del cierre
    {
      const a0 = await adj(s2[0].num);
      await assert.rejects(db.foodPayrollAdjustment.update({ where: { id: a0.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedById: rh.id, voidReason: 'Intento de ocultar diferencia' } }), dbGuard);
      await assert.rejects(db.foodPayrollAdjustment.update({ where: { id: a0.id }, data: { balanceAmount: '1.00' } }), dbGuard);
      await assert.rejects(db.foodPayrollAdjustment.delete({ where: { id: a0.id } }), dbGuard);
      await assert.rejects(rc.closeFoodPayrollBatch(rh, b2, { reconciliationId: 'otra' }, deps), code('PREVIEW_STALE'));
    }

    // 13 se ejecuta con el lote masivo; aquí: cierre de S2 con diferencias pendientes (cierre administrativo ≠ liquidación)
    const preClose = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b2 } });
    const closed2 = await rc.closeFoodPayrollBatch(rh, b2, { reconciliationId: recon2.reconciliationId, note: 'Cierre con diferencias pendientes' }, deps);
    assert.equal(closed2.pendingAdjustments, 4); assert.equal(closed2.processedOrders, 9); assert.equal(closed2.exportedOrders, 3);
    assert.equal(closed2.pendingRecovery, money(1050 + exp2.get(s2[1].num) + 700)); assert.equal(closed2.pendingRefund, '15.25');
    assert.equal((await db.foodPayrollReconciliation.findUniqueOrThrow({ where: { id: recon2.reconciliationId } })).status, 'PARTIALLY_RECONCILED');
    const orderOf = async num => db.foodOrder.findFirstOrThrow({ where: { employee: { employeeNumber: num }, payrollItems: { some: { batchId: b2 } } }, include: { payrollAssignments: true } });
    for (const i of [0, 1, 3]) {
      const o = await orderOf(s2[i].num);
      assert.equal(o.payrollStatus, 'EXPORTED'); assert.equal(o.payrollAssignments.filter(a => a.status === 'ACTIVE').length, 1);
    }
    assert.equal((await orderOf(s2[2].num)).payrollStatus, 'PROCESSED');
    scenario(4, 'descuento cero explícito: NOT_APPLIED con saldo completo; celda vacía es información faltante (AMOUNT_MISSING)');
    scenario(5, 'descuento superior: OVER_APPLIED, saldo por devolver -15.25, pedido PROCESSED');

    // 3. Descuento parcial: recuperación parcial (ajuste sucesor) y liquidación posterior
    {
      const a0 = await adj(s2[0].num);
      await assert.rejects(rc.resolveFoodPayrollAdjustment(rh, a0.id, { resolutionType: 'RECOVERED', amount: '20.00', reference: 'Q24', note: 'Recuperación mayor al saldo' }, deps), code('RESOLUTION_INVALID'));
      await assert.rejects(rc.resolveFoodPayrollAdjustment(rh, a0.id, { resolutionType: 'REFUNDED', amount: '1.00', reference: 'Q24', note: 'Tipo no válido para saldo' }, deps), code('RESOLUTION_INVALID'));
      await assert.rejects(rc.resolveFoodPayrollAdjustment(rh, a0.id, { resolutionType: 'RECOVERED', amount: '1.00', note: 'Sin referencia de nómina' }, deps), code('RESOLUTION_INVALID'));
      const r1 = await rc.resolveFoodPayrollAdjustment(rh, a0.id, { resolutionType: 'RECOVERED', amount: '6.00', reference: 'NOM-Q24', note: 'Recuperado parcialmente en la quincena 24' }, deps);
      assert.equal(r1.remainder, '4.50'); assert.ok(r1.successorId); assert.equal(r1.processedOrders, 0);
      assert.equal((await orderOf(s2[0].num)).payrollStatus, 'EXPORTED');
      await assert.rejects(rc.resolveFoodPayrollAdjustment(rh, a0.id, { resolutionType: 'RECOVERED', amount: '4.50', reference: 'NOM-Q25', note: 'Segundo intento sobre ajuste resuelto' }, deps), code('ADJUSTMENT_ALREADY_RESOLVED'));
      const succ = await db.foodPayrollAdjustment.findUniqueOrThrow({ where: { id: r1.successorId } });
      assert.equal(cents(succ.balanceAmount), 450); assert.equal(succ.parentAdjustmentId, a0.id); assert.equal(succ.status, 'PENDING');
      const race = await Promise.allSettled([1, 2].map(() => rc.resolveFoodPayrollAdjustment(rh, succ.id, { resolutionType: 'RECOVERED', amount: '4.50', reference: 'NOM-Q25', note: 'Liquidado en la quincena 25' }, deps)));
      assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(race.find(r => r.status === 'rejected').reason.code, 'ADJUSTMENT_ALREADY_RESOLVED');
      assert.equal(race.find(r => r.status === 'fulfilled').value.processedOrders, 1);
      assert.equal((await orderOf(s2[0].num)).payrollStatus, 'PROCESSED');
      const o = await orderOf(s2[0].num); assert.equal(o.payrollAssignments.filter(a => a.status === 'ACTIVE').length, 1);
    }
    scenario(3, 'descuento parcial: saldo a nivel colaborador, pedido no liberado; recuperación parcial con sucesor y PROCESSED solo al cubrirse');

    // 15 (parte 2). Ajustes auditables: condonación, devolución, corrección, historial y append-only
    {
      const a3 = await adj(s2[3].num);
      await assert.rejects(rc.resolveFoodPayrollAdjustment(rh, a3.id, { resolutionType: 'WAIVED', amount: '1.00', note: 'Condonación parcial no permitida' }, deps), code('RESOLUTION_INVALID'));
      const w = await rc.resolveFoodPayrollAdjustment(rh, a3.id, { resolutionType: 'WAIVED', amount: '7.00', note: 'Condonado por autorización de Dirección (oficio QA)' }, deps);
      assert.equal(w.processedOrders, 0); assert.equal((await orderOf(s2[3].num)).payrollStatus, 'EXPORTED');
      const a2 = await adj(s2[2].num);
      const rf = await rc.resolveFoodPayrollAdjustment(rh, a2.id, { resolutionType: 'REFUNDED', amount: '15.25', reference: 'TRF-001', note: 'Devuelto por transferencia al colaborador' }, deps);
      assert.equal(rf.remainder, '0.00');
      const a1 = await adj(s2[1].num);
      await assert.rejects(rc.resolveFoodPayrollAdjustment(rh, a1.id, { resolutionType: 'CORRECTED', amount: '1.00', reference: 'EVID-1', note: 'Corrección parcial no permitida' }, deps), code('RESOLUTION_INVALID'));
      const done1 = await db.foodPayrollAdjustment.findUniqueOrThrow({ where: { id: a3.id }, include: { resolvedBy: true, actor: true, batch: true } });
      assert.equal(done1.status, 'APPLIED'); assert.equal(done1.resolutionType, 'WAIVED'); assert.equal(done1.resolvedBy.id, rh.id); assert.ok(done1.appliedAt);
      assert.equal(done1.batch.payrollReference, ref('S2')); assert.equal(done1.employeeNumber, s2[3].num); assert.ok(done1.reason.includes('Descuento parcial'));
      await assert.rejects(db.foodPayrollAdjustment.update({ where: { id: a3.id }, data: { resolutionNote: 'Reescritura del historial' } }), dbGuard);
      const ev = await db.foodPayrollAuditEvent.groupBy({ by: ['eventType'], where: { batchId: b2 }, _count: { _all: true } });
      const evm = Object.fromEntries(ev.map(e => [e.eventType, e._count._all]));
      for (const t of ['RECONCILIATION_RECORDED', 'ADJUSTMENT_RECORDED', 'RECONCILIATION_VOIDED', 'BATCH_RECONCILED', 'ADJUSTMENT_RESOLVED', 'RECONCILIATION_REJECTED']) assert.ok(evm[t] >= 1, `falta evento ${t}`);
      const anyEvent = await db.foodPayrollAuditEvent.findFirstOrThrow({ where: { batchId: b2 } });
      await assert.rejects(db.foodPayrollAuditEvent.update({ where: { id: anyEvent.id }, data: { reasonCode: 'X' } }), dbGuard);
      const list = await rc.listFoodPayrollAdjustments(rh, { status: 'ALL', batchId: b2 }, deps);
      assert.equal(list.total, 5); // 4 iniciales + 1 sucesor (la conciliación anulada no tenía diferencias)
      const pend = await rc.listFoodPayrollAdjustments(rh, { status: 'PENDING', batchId: b2 }, deps);
      assert.equal(pend.total, 1); assert.equal(pend.adjustments[0].kind, 'NOT_APPLIED');
    }
    scenario(15, 'ajustes auditables: motivo, responsable, fechas, resolución y referencia; condonación/corrección completas; append-only');

    // 16. Prevención de cargos duplicados posteriores
    {
      const p = await mass.previewFoodPayrollPeriod(rh, { payrollReference: ref('DUP'), weekFrom: weeks[0].day, weekTo: weeks[1].day }, deps);
      assert.equal(p.totals.eligible.orders, 0);
      assert.equal(p.excludedRoutine, 18);
      await assert.rejects(mass.createFoodPayrollPeriodBatch(rh, { payrollReference: ref('DUP'), weekFrom: weeks[0].day, weekTo: weeks[1].day,
        reviewedInactiveOrderIds: [], previewToken: p.previewToken }, qkey(), deps), code('NOTHING_TO_GENERATE'));
      const o1 = await orderOf(s2[1].num); const o0 = await orderOf(s2[0].num);
      await assert.rejects(db.foodOrder.update({ where: { id: o1.id }, data: { payrollStatus: 'PROCESSED' } }), dbGuard);   // no cubierto
      await assert.rejects(db.foodOrder.update({ where: { id: o1.id }, data: { payrollStatus: 'PENDING' } }), dbGuard);     // no se libera
      await assert.rejects(db.foodOrder.update({ where: { id: o0.id }, data: { payrollStatus: 'EXPORTED' } }), dbGuard);    // PROCESSED es final
      await assert.rejects(db.foodOrder.update({ where: { id: o1.id }, data: { status: 'CANCELLED' } }), dbGuard);
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollAssignment" SET "status" = 'RELEASED', "releasedAt" = now(), "releasedById" = $2, "releaseReason" = 'QA intento'
        WHERE "orderId" = $1`, o1.id, rh.id), dbGuard);
    }
    scenario(16, 'cargos duplicados posteriores: periodo ya cobrado sin elegibles; estados y asignaciones protegidos en base de datos');

    // 17. Inmutabilidad del lote, del Excel oficial y de la evidencia
    {
      const after = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b2 } });
      assert.equal(after.fileSha256, b2Before.fileSha256); assert.ok(Buffer.from(after.fileContent).equals(Buffer.from(b2Before.fileContent)));
      assert.equal(after.committedAmount.toString(), b2Before.committedAmount.toString()); assert.equal(after.exportedAt.getTime(), b2Before.exportedAt.getTime());
      assert.equal(preClose.fileSha256, after.fileSha256);
      const dl = await ops.downloadFoodPayrollExport(rh, b2, deps); assert.equal(dl.fileSha256, b2Before.fileSha256);
      await assert.rejects(db.foodPayrollBatch.update({ where: { id: b2 }, data: { closeNote: 'Reescritura' } }), dbGuard);
      await assert.rejects(db.foodPayrollBatch.update({ where: { id: b2 }, data: { status: 'EXPORTED' } }), dbGuard);
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollReconciliation" SET "receivedAmount" = 0 WHERE "id" = $1`, recon2.reconciliationId), dbGuard);
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollReconciliationEmployee" SET "appliedAmount" = "expectedAmount" WHERE "reconciliationId" = $1`, recon2.reconciliationId), dbGuard);
      await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollBatchItem" SET "committedAmount" = "committedAmount" WHERE "batchId" = $1`, b2), dbGuard);
      const item = await db.foodPayrollBatchItem.findFirstOrThrow({ where: { batchId: b2 } });
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO "FoodPayrollReconciliationItem" ("id","reconciliationId","batchId","batchItemId","sentAmount","deductedAmount","undeductedAmount")
        VALUES (gen_random_uuid()::text, $1, $2, $3, 1, 1, 0)`, recon2.reconciliationId, b2, item.id), dbGuard);
      const ev = await rc.downloadReconciliationEvidence(rh, b2, recon2.reconciliationId, deps);
      assert.ok(ev.body.equals(mixedFile)); assert.equal(ev.fileSha256, require('node:crypto').createHash('sha256').update(mixedFile).digest('hex'));
      // Transición directa EXPORTED -> RECONCILED rechazada por la base de datos (se exige conciliación).
      await assert.rejects(db.foodPayrollBatch.update({ where: { id: b3 }, data: { status: 'RECONCILED', closedAt: new Date(), closedById: rh.id } }), dbGuard);
      await assert.rejects(db.foodPayrollBatch.update({ where: { id: b3 }, data: { status: 'PARTIALLY_RECONCILED' } }), dbGuard);
    }
    scenario(17, 'inmutabilidad: lote, snapshots, Excel oficial (SHA-256), evidencia y resultados conciliados; transiciones directas rechazadas');

    // 19. Exportaciones de control sin efectos financieros
    {
      const snap = async () => JSON.stringify({
        batch: await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b2 }, select: { status: true, updatedAt: true, closedAt: true, fileSha256: true } }),
        recon: await db.foodPayrollReconciliation.findMany({ where: { batchId: b2 }, orderBy: { id: 'asc' }, select: { id: true, status: true, voidedAt: true, closedAt: true } }),
        adj: await db.foodPayrollAdjustment.findMany({ where: { batchId: b2 }, orderBy: { id: 'asc' }, select: { id: true, status: true, balanceAmount: true, appliedAt: true } }),
        orders: await db.foodOrder.findMany({ where: { payrollItems: { some: { batchId: b2 } } }, orderBy: { id: 'asc' }, select: { id: true, payrollStatus: true, updatedAt: true } }),
        assignments: await db.foodPayrollAssignment.findMany({ where: { batchId: b2 }, orderBy: { id: 'asc' }, select: { id: true, status: true } }),
      });
      const before = await snap();
      const sheets = {};
      for (const type of ['reconciliation', 'differences', 'adjustments', 'summary']) {
        const r = await rc.exportFoodPayrollControlReport(rh, b2, type, deps);
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.body); sheets[type] = wb;
        assert.match(r.fileName, /\.xlsx$/); assert.match(r.fileSha256, /^[0-9a-f]{64}$/);
      }
      await rc.downloadReconciliationEvidence(rh, b2, recon2.reconciliationId, deps);
      await rc.getFoodPayrollReconciliation(rh, b2, { page: 1 }, deps);
      assert.equal(await snap(), before);
      assert.equal(sheets.reconciliation.getWorksheet('Conciliación por colaborador').rowCount, 12 + 2);
      assert.equal(sheets.differences.getWorksheet('Diferencias detectadas').rowCount, 4 + 2);
      assert.equal(sheets.adjustments.getWorksheet('Ajustes').rowCount, 5 + 1);
      const summary = sheets.summary.getWorksheet('Resumen de cierre');
      const kv = Object.fromEntries(summary.getSheetValues().slice(2).map(r => [r[1], r[2]]));
      assert.equal(kv['Estado del lote'], 'RECONCILED'); assert.equal(kv['Ajustes pendientes'], 1);
      assert.equal(kv['Saldo pendiente de recuperar vigente (MXN)'], money(exp2.get(s2[1].num)));
      assert.equal(kv['Pedidos PROCESSED (descuento cubierto)'], 10); assert.equal(kv['Pedidos EXPORTED (enviados, no cubiertos)'], 2);
      assert.equal(await db.foodPayrollAuditEvent.count({ where: { batchId: b2, eventType: 'CONTROL_EXPORTED' } }), 4 + 1); // 4 reportes + 1 plantilla
      await assert.rejects(rc.downloadReconciliationTemplate(rh, b2, deps), code('BATCH_ALREADY_RECONCILED'));
    }
    scenario(19, 'reportes de control (conciliación, diferencias, ajustes, resumen) sin cambios en lote, pedidos, ajustes ni asignaciones');

    // 2. Conciliación masiva de más de 500 colaboradores
    let recon3;
    {
      const t0 = Date.now();
      const { rows } = await templateRows(b3);
      assert.equal(rows.length, N);
      const filled = rows.map((r, i) => ({ ...r, applied: i % 97 === 5 ? 0 : i % 89 === 7 ? money(cents(r.expected) - 1) : i % 83 === 11 ? money(cents(r.expected) + 250) : r.expected }));
      const file = await makeFile(filled);
      const tp = Date.now();
      const p = await rc.previewReconciliation(rh, b3, file, 'masiva.xlsx', deps);
      const previewMs = Date.now() - tp;
      assert.equal(p.valid, true); assert.equal(p.rows.length, N); assert.equal(p.totals.employees, N);
      const expectedTotal = rows.reduce((s, r) => s + cents(r.expected), 0);
      const batch = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b3 } });
      assert.equal(cents(p.totals.expected), cents(batch.committedAmount)); assert.equal(cents(p.totals.expected), expectedTotal);
      const appliedTotal = filled.reduce((s, r) => s + cents(r.applied), 0);
      assert.equal(cents(p.totals.applied), appliedTotal);
      const tc = Date.now();
      const c = await confirm(rh, b3, file, p);
      const confirmMs = Date.now() - tc;
      recon3 = c.body;
      const diffs = p.totals.partial + p.totals.notApplied + p.totals.overApplied;
      assert.ok(p.totals.partial > 0 && p.totals.notApplied > 0 && p.totals.overApplied > 0);
      assert.equal(c.body.adjustmentsCreated, diffs);
      assert.equal(await db.foodPayrollReconciliationEmployee.count({ where: { reconciliationId: recon3.reconciliationId } }), N);
      const sumRows = await db.foodPayrollReconciliationEmployee.aggregate({ where: { reconciliationId: recon3.reconciliationId }, _sum: { expectedAmount: true, appliedAmount: true } });
      assert.equal(cents(sumRows._sum.expectedAmount), expectedTotal); assert.equal(cents(sumRows._sum.appliedAmount), appliedTotal);
      const page2 = await rc.getFoodPayrollReconciliation(rh, b3, { page: 3 }, deps);
      assert.equal(page2.total, N); assert.equal(page2.pages, Math.ceil(N / 50)); assert.equal(page2.employees.length, 50);
      console.log(`QA YF-002-C2 masiva: colaboradores=${N} pedidos=${batch.orderCount} diferencias=${diffs} vista_previa_ms=${previewMs} confirmacion_ms=${confirmMs} total_ms=${Date.now() - t0}`);
      recon3.diffs = diffs; recon3.batch = batch;
    }
    scenario(2, `conciliación masiva de ${N} colaboradores: sin omisiones, totales exactos en centavos, un ajuste por diferencia`);

    // 13. Cierres concurrentes
    {
      const race = await Promise.allSettled([rh, rh2].map(a => rc.closeFoodPayrollBatch(a, b3, { reconciliationId: recon3.reconciliationId }, deps)));
      assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(race.map(r => r.reason?.code)));
      assert.equal(race.find(r => r.status === 'rejected').reason.code, 'BATCH_ALREADY_RECONCILED');
      const ok = race.find(r => r.status === 'fulfilled').value;
      assert.equal(ok.processedOrders + ok.exportedOrders, recon3.batch.orderCount);
      const counts = await statusCounts(b3);
      assert.equal((counts.PROCESSED ?? 0) + (counts.EXPORTED ?? 0), recon3.batch.orderCount); assert.equal(counts.PENDING, undefined);
      assert.equal(await db.foodPayrollAuditEvent.count({ where: { batchId: b3, eventType: 'BATCH_RECONCILED' } }), 1);
      const uncovered = await db.foodPayrollReconciliationEmployee.count({ where: { reconciliationId: recon3.reconciliationId, result: { in: ['PARTIAL', 'NOT_APPLIED'] } } });
      assert.equal(ok.uncoveredEmployees, uncovered);
      await assert.rejects(rc.voidReconciliation(rh, b3, { reconciliationId: recon3.reconciliationId, reason: 'Anular después del cierre' }, deps), code('BATCH_ALREADY_RECONCILED'));
    }
    scenario(13, 'cierres concurrentes: un solo cierre, estados de pedidos actualizados una vez, el segundo BATCH_ALREADY_RECONCILED');

    // 20 se verifica en la limpieza (finally).
    assert.equal(done.size, 19, `escenarios ejecutados: ${[...done.keys()].sort((a, b) => a - b).join(',')}`);
  } finally {
    try {
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL yellowflex.qa_fixture_cleanup = 'on'`);
        const batches = (await tx.foodPayrollBatch.findMany({ where: { payrollReference: { startsWith: `QA-FIXTURE-${run}` } }, select: { id: true } })).map(b => b.id);
        // Ajustes: primero los que no tienen sucesor (cadena de saldos remanentes).
        for (let guard = 0; guard < 50; guard++) {
          const leaves = await tx.foodPayrollAdjustment.findMany({ where: { batchId: { in: batches }, successors: { none: {} } }, select: { id: true } });
          if (!leaves.length) break;
          await tx.foodPayrollAdjustment.deleteMany({ where: { id: { in: leaves.map(l => l.id) } } });
        }
        await tx.foodPayrollReconciliationEmployee.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollReconciliation.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollAuditEvent.deleteMany({ where: { OR: [{ batchId: { in: batches } }, { batchId: null, actorId: { in: userIds }, idempotencyKey: { startsWith: 'qa-fixture-' } }] } });
        await tx.foodPayrollAssignment.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatchItemService.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatchItem.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatch.deleteMany({ where: { id: { in: batches } } });
      }, { timeout: 300000 });
      await db.reservation.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await db.foodOrder.deleteMany({ where: { menuWeekId: { in: weekIds } } });
      await db.menuItem.deleteMany({ where: { menuDay: { menuWeekId: { in: weekIds } } } });
      await db.menuDay.deleteMany({ where: { menuWeekId: { in: weekIds } } });
      await db.menuWeek.deleteMany({ where: { id: { in: weekIds } } });
      await db.employee.deleteMany({ where: { id: { in: employeeIds } } });
      await db.corporateModulePermission.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      const residue = {
        batches: await db.foodPayrollBatch.count({ where: { payrollReference: { startsWith: `QA-FIXTURE-${run}` } } }),
        reconciliations: await db.foodPayrollReconciliation.count({ where: { payrollReference: { startsWith: `QA-FIXTURE-${run}` } } }),
        reconciliationEmployees: await db.foodPayrollReconciliationEmployee.count({ where: { employeeNumber: { startsWith: marker } } }),
        adjustments: await db.foodPayrollAdjustment.count({ where: { employeeNumber: { startsWith: marker } } }),
        events: await db.foodPayrollAuditEvent.count({ where: { actorId: { in: userIds } } }),
        orders: await db.foodOrder.count({ where: { menuWeekId: { in: weekIds } } }),
        users: await db.user.count({ where: { name: { startsWith: marker } } }),
        employees: await db.employee.count({ where: { employeeNumber: { startsWith: marker } } }),
      };
      console.log('QA YF-002-C2 limpieza: ' + JSON.stringify(residue));
      assert.deepEqual(residue, { batches: 0, reconciliations: 0, reconciliationEmployees: 0, adjustments: 0, events: 0, orders: 0, users: 0, employees: 0 }, 'Limpieza de fixtures incompleta');
      if (done.size === 19) scenario(20, 'limpieza completa de fixtures: lotes, conciliaciones, resultados, ajustes, eventos, pedidos, usuarios y colaboradores en cero');
      console.log(`QA YF-002-C2: escenarios=${done.size}`);
      if (done.size === 20) assert.deepEqual([...done.keys()].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
    } finally {
      if (prevSecret === undefined) delete process.env.FOOD_PAYROLL_PREVIEW_SECRET; else process.env.FOOD_PAYROLL_PREVIEW_SECRET = prevSecret;
      delete globalThis.prisma; await db.$disconnect();
    }
  }
});
