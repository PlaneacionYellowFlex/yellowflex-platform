/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002 Bloque C (parte 1) — prenómina MASIVA por periodo contra PostgreSQL real aislado (más de 500 pedidos).
// node --require ./tests/helpers/server-only-register.cjs --import tsx --test tests/food-payroll-mass-postgres.test.cjs
// Requiere RUN_FOOD_PAYROLL_DB_TESTS=1. Crea fixtures QA-FIXTURE-* propios y los elimina al terminar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');

const passed = [];
function scenario(name) { passed.push(name); console.log(`ESCENARIO OK ${String(passed.length).padStart(2, '0')}: ${name}`); }
const cents = v => Math.round(Number(v) * 100);

test('prenómina masiva: más de 500 pedidos sin omisiones, excepciones, idempotencia, Excel agrupado y concurrencia', {
  skip: process.env.RUN_FOOD_PAYROLL_DB_TESTS !== '1', timeout: 600000,
}, async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const ExcelJS = require('exceljs');
  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const marker = `QA-FIXTURE-MASS-${run}`;
  const ref = s => `QA-FIXTURE-${run}-${s}`.slice(0, 40);
  const qkey = () => `qa-fixture-${randomUUID()}`;
  const userIds = []; const employeeIds = []; const weekIds = [];
  const prevSecret = process.env.FOOD_PAYROLL_PREVIEW_SECRET;
  try {
    await assertIsolatedIdentity(db);
    process.env.FOOD_PAYROLL_PREVIEW_SECRET = `qa-fixture-secret-${randomUUID()}-${randomUUID()}`;
    globalThis.prisma = db;
    const engine = require('../lib/food-services/payroll-batch-service.ts');
    const mass = require('../lib/food-services/payroll-batch-mass.ts');
    const ops = require('../lib/food-services/payroll-batch-operations.ts');
    const deps = { db };
    const code = c => err => { assert.equal(err.code, c, `esperado ${c}, recibido ${err.code}: ${err.message}`); return true; };

    const mkUser = async (role, actions) => {
      const u = await db.user.create({ data: { name: `${marker}-${role}-${actions.length}`, passwordMustChange: false, roles: { create: { role } } } });
      userIds.push(u.id);
      await db.corporateModulePermission.createMany({ data: actions.map(actionKey => ({ userId: u.id, moduleKey: 'food-services', actionKey, granted: true })) });
      return { id: u.id, name: u.name, email: null, roles: [role], employee: null };
    };
    const rh = await mkUser('RH', ['view', 'manage', 'view-payroll-batches', 'create-payroll-batch', 'void-payroll-batch', 'export-payroll-batch']);
    const rhView = await mkUser('RH', ['view', 'manage', 'view-payroll-batches']);

    // ---------------- fixtures masivos: 5 semanas (3 del periodo principal, 1 fuera, 1 para concurrencia)
    const dept = await db.department.findFirstOrThrow();
    const shift = await db.workShift.findFirstOrThrow({ where: { active: true } });
    const base = Date.UTC(2196, 0, 4) + randomInt(0, 1500) * 7 * 86400000;
    const weeks = [];
    for (let w = 0; w < 5; w++) {
      const weekStart = new Date(base + w * 7 * 86400000);
      const week = await db.menuWeek.create({ data: { weekStart, status: 'PUBLISHED' } }); weekIds.push(week.id);
      const items = [];
      for (let d = 0; d < 5; d++) {
        const day = await db.menuDay.create({ data: { menuWeekId: week.id, serviceDate: new Date(weekStart.getTime() + d * 86400000) } });
        items.push(await db.menuItem.create({ data: { menuDayId: day.id, name: `${marker} W${w}D${d}`, serviceType: 'LUNCH', price: '50.00' } }));
      }
      weeks.push({ week, items, day: weekStart.toISOString().slice(0, 10) });
    }
    const N = Math.max(230, Number(process.env.YF_MASS_TEST_EMPLOYEES) || 230); // escala opcional para pruebas de volumen
    const employees = Array.from({ length: N + 2 }, (_, i) => ({ id: randomUUID(), employeeNumber: `${marker}-${String(i).padStart(4, '0')}`,
      fullName: `${marker} Colaborador ${i}`, departmentId: dept.id, workShiftId: shift.id, pinHash: 'fictional-unusable', pinMustChange: false,
      status: i === N ? 'INACTIVE' : 'ACTIVE' }));
    await db.employee.createMany({ data: employees }); employees.forEach(e => employeeIds.push(e.id));
    const prices = ['35.50', '42.25', '62.00'];
    const orders = []; const reservations = [];
    const addOrder = (e, w, { itemCount, price, status = 'CONFIRMED', payrollStatus = 'PENDING', total } = {}) => {
      const id = randomUUID(); const qty = itemCount ?? 1 + randomInt(0, 5); const unit = price ?? prices[randomInt(0, 3)];
      orders.push({ id, employeeId: e.id, menuWeekId: weeks[w].week.id, itemCount: qty, unitPrice: unit, totalAmount: total ?? (Number(unit) * qty).toFixed(2), status, payrollStatus });
      for (const it of weeks[w].items.slice(0, qty)) reservations.push({ id: randomUUID(), employeeId: e.id, menuItemId: it.id, foodOrderId: id, status: status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE' });
      return orders[orders.length - 1];
    };
    for (let i = 0; i < N; i++) for (let w = 0; w < 3; w++) if ((i + w) % 11 !== 0) addOrder(employees[i], w);
    const formerOrder = addOrder(employees[N], 1, { itemCount: 2, price: '62.00' });           // excolaborador: excepción a revisar
    const unverified = orders.find(o => o.employeeId === employees[5].id); unverified.payrollStatus = 'UNVERIFIED';
    const mismatch = orders.find(o => o.employeeId === employees[7].id); mismatch.totalAmount = '0.01';
    const cancelledOrder = orders.find(o => o.employeeId === employees[9].id); cancelledOrder.status = 'CANCELLED';
    reservations.filter(r => r.foodOrderId === cancelledOrder.id).forEach(r => { r.status = 'CANCELLED'; });
    for (let i = 0; i < 3; i++) addOrder(employees[i], 3);                                     // fuera del periodo
    for (let i = 0; i < 50; i++) addOrder(employees[N - 1 - i], 4);                             // periodo de concurrencia
    for (let i = 0; i < orders.length; i += 500) await db.foodOrder.createMany({ data: orders.slice(i, i + 500) });
    for (let i = 0; i < reservations.length; i += 1000) await db.reservation.createMany({ data: reservations.slice(i, i + 1000) });
    // Dos pedidos del periodo ya asignados a un lote explícito previo (excluidos rutinarios).
    const pre = orders.filter(o => o.menuWeekId === weeks[0].week.id && o.status === 'CONFIRMED' && o.payrollStatus === 'PENDING' && o.totalAmount !== '0.01').slice(0, 2);
    const pp = await engine.previewFoodPayrollBatch(rh, { payrollReference: ref('previo'), orderIds: pre.map(o => o.id) }, deps);
    await engine.createFoodPayrollBatch(rh, { payrollReference: ref('previo'), orderIds: pre.map(o => o.id), previewToken: pp.previewToken }, qkey(), deps);

    const inMain = o => [weeks[0].week.id, weeks[1].week.id, weeks[2].week.id].includes(o.menuWeekId);
    const expected = orders.filter(o => inMain(o) && o.status === 'CONFIRMED' && o.payrollStatus === 'PENDING' && o.totalAmount !== '0.01'
      && o.id !== formerOrder.id && !pre.some(p => p.id === o.id));
    const expectedEmployees = new Set(expected.map(o => o.employeeId)).size;
    const expectedServices = expected.reduce((s, o) => s + o.itemCount, 0);
    const expectedCents = expected.reduce((s, o) => s + cents(o.totalAmount), 0);
    assert.ok(expected.length > 500, `fixture con ${expected.length} pedidos elegibles`);
    const period = { weekFrom: weeks[0].day, weekTo: weeks[2].day };

    // 01 consulta individual paginada: total exacto y páginas sin huecos ni duplicados
    const seen = new Set(); let page = 1; let pages = 1; let total = 0;
    do {
      const r = await ops.listFoodPayrollCandidates(rh, { ...period, employee: marker, limit: 200, page }, deps);
      total = r.total; pages = r.pages; r.orders.forEach(o => { assert.equal(seen.has(o.orderId), false, 'duplicado entre páginas'); seen.add(o.orderId); }); page++;
    } while (page <= pages);
    const pendingInPeriod = orders.filter(o => inMain(o) && o.status === 'CONFIRMED' && o.payrollStatus === 'PENDING').length;
    assert.equal(total, pendingInPeriod); assert.equal(seen.size, pendingInPeriod); assert.ok(pages >= 3);
    scenario(`consulta individual paginada: ${total} pedidos en ${pages} páginas sin omisiones ni duplicados`);

    // 02 vista previa masiva: totales exactos y solo excepciones enumeradas
    let t0 = Date.now();
    const p1 = await mass.previewFoodPayrollPeriod(rh, { payrollReference: ref('masiva'), ...period }, deps);
    const previewMs = Date.now() - t0;
    assert.equal(p1.totals.eligible.orders, expected.length); assert.equal(p1.totals.eligible.employees, expectedEmployees);
    assert.equal(p1.totals.eligible.services, expectedServices); assert.equal(p1.totals.eligible.amountCents, expectedCents);
    assert.equal(p1.employees.length, expectedEmployees); assert.equal(p1.employees.reduce((s, e) => s + cents(e.amount), 0), expectedCents);
    assert.deepEqual(p1.requiresReview.map(r => r.orderId), [formerOrder.id]);
    assert.deepEqual(p1.excludedAttention.map(r => r.orderId).sort(), [unverified.id, mismatch.id].sort());
    assert.equal(p1.excludedRoutine, 2); assert.equal(p1.excludedSummary.ACTIVE_ASSIGNMENT_EXISTS, 2);
    assert.equal(p1.confirmedOrdersInPeriod, orders.filter(o => inMain(o) && o.status === 'CONFIRMED').length);
    assert.ok(p1.previewToken.length < 5000, 'el token masivo no enumera pedidos');
    await assert.rejects(mass.previewFoodPayrollPeriod(rhView, { payrollReference: ref('x'), ...period }, deps), /Acceso restringido/);
    scenario(`vista previa masiva: ${expected.length} pedidos, ${expectedEmployees} colaboradores, ${expectedServices} servicios, $${(expectedCents / 100).toFixed(2)} en ${previewMs} ms`);

    // 03 pedido nuevo después de la vista previa: no se omite ni se incluye en silencio
    const late = addOrder(employees[N + 1], 2, { itemCount: 1, price: '50.00' });
    await db.foodOrder.create({ data: late });
    await db.reservation.createMany({ data: reservations.filter(r => r.foodOrderId === late.id) });
    const body = (p, extra = {}) => ({ payrollReference: p.payrollReference, weekFrom: p.period.weekFrom, weekTo: p.period.weekTo, previewToken: p.previewToken, ...extra });
    await assert.rejects(mass.createFoodPayrollPeriodBatch(rh, body(p1), qkey(), deps), code('PREVIEW_STALE'));
    assert.equal(await db.foodPayrollBatch.count({ where: { payrollReference: ref('masiva') } }), 0);
    scenario('pedido confirmado tras la vista previa: PREVIEW_STALE, nada se genera');

    // 04 generación masiva con la excepción revisada: ningún pedido elegible queda fuera
    const p2 = await mass.previewFoodPayrollPeriod(rh, { payrollReference: ref('masiva'), ...period }, deps);
    assert.equal(p2.totals.eligible.orders, expected.length + 1);
    const key = qkey(); t0 = Date.now();
    const created = await mass.createFoodPayrollPeriodBatch(rh, body(p2, { reviewedInactiveOrderIds: [formerOrder.id] }), key, deps);
    const createMs = Date.now() - t0;
    assert.equal(created.status, 201);
    const batchId = created.body.batchId;
    assert.equal(created.body.orderCount, expected.length + 2);
    assert.equal(cents(created.body.committedAmount), expectedCents + 5000 + 12400);
    const left = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "FoodOrder" o WHERE o."menuWeekId" = ANY($1::text[]) AND o."status" = 'CONFIRMED'
      AND o."payrollStatus" = 'PENDING' AND NOT EXISTS (SELECT 1 FROM "FoodPayrollAssignment" a WHERE a."orderId" = o."id" AND a."status" = 'ACTIVE')`,
      [weeks[0].week.id, weeks[1].week.id, weeks[2].week.id]);
    assert.equal(left[0].n, 1, 'solo queda fuera el pedido con importe inconsistente (requiere atención)');
    const stored = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: batchId }, include: { _count: { select: { items: true, assignments: true, services: true } } } });
    assert.equal(stored._count.items, expected.length + 2); assert.equal(stored._count.assignments, expected.length + 2);
    assert.equal(stored._count.services, expectedServices + 1 + 2);
    assert.equal(stored.employeeCount, expectedEmployees + 2);
    scenario(`generación masiva: ${stored._count.items} pedidos de ${stored.employeeCount} colaboradores en ${createMs} ms, sin omisiones`);

    // 05 idempotencia del modo masivo
    const replay = await mass.createFoodPayrollPeriodBatch(rh, body(p2, { reviewedInactiveOrderIds: [formerOrder.id] }), key, deps);
    assert.equal(replay.status, 200); assert.deepEqual(replay.body, created.body);
    await assert.rejects(mass.createFoodPayrollPeriodBatch(rh, body(p2), key, deps), code('IDEMPOTENCY_KEY_REUSED'));
    await assert.rejects(engine.createFoodPayrollBatch(rh, { payrollReference: p2.payrollReference, orderIds: [late.id], previewToken: p2.previewToken }, qkey(), deps), code('PREVIEW_MISMATCH'));
    scenario('idempotencia masiva: reintento idéntico 200; clave con otra solicitud 409; token masivo no sirve para selección explícita');

    // 06 sin cargos duplicados: nuevo cálculo del periodo ya no tiene elegibles
    const p3 = await mass.previewFoodPayrollPeriod(rh, { payrollReference: ref('otra'), ...period }, deps);
    assert.equal(p3.totals.eligible.orders, 0); assert.equal(p3.requiresReview.length, 0);
    assert.equal(p3.excludedSummary.ACTIVE_ASSIGNMENT_EXISTS, expected.length + 2 + 2);
    await assert.rejects(mass.createFoodPayrollPeriodBatch(rh, body(p3), qkey(), deps), code('NOTHING_TO_GENERATE'));
    scenario('periodo ya procesado: 0 elegibles, NOTHING_TO_GENERATE, sin cargos duplicados');

    // 07 Excel oficial agrupado por número de empleado
    const ex = await ops.exportFoodPayrollBatch(rh, batchId, {}, deps);
    const file = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: batchId }, select: { fileContent: true } });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(file.fileContent);
    const g = wb.getWorksheet('Descuentos por colaborador');
    assert.equal(wb.worksheets[0].name, 'Descuentos por colaborador');
    assert.equal(g.rowCount, 1 + stored.employeeCount + 1);
    let sum = 0; const nums = new Set();
    for (let r = 2; r <= stored.employeeCount + 1; r++) { const row = g.getRow(r); nums.add(row.getCell(2).value); sum += Math.round(row.getCell(11).value * 100); }
    assert.equal(nums.size, stored.employeeCount, 'un renglón por número de empleado'); assert.equal(sum, cents(created.body.committedAmount));
    const sample = employees[3];
    const sampleRow = [...Array(g.rowCount).keys()].map(i => g.getRow(i + 1)).find(row => row.getCell(2).value === sample.employeeNumber);
    const sampleExpected = orders.filter(o => o.employeeId === sample.id && inMain(o) && o.status === 'CONFIRMED' && o.payrollStatus === 'PENDING' && o.totalAmount !== '0.01' && !pre.some(p => p.id === o.id));
    assert.equal(Math.round(sampleRow.getCell(11).value * 100), sampleExpected.reduce((s, o) => s + cents(o.totalAmount), 0));
    assert.equal(wb.getWorksheet('Prenomina').rowCount, 1 + stored._count.items + 1);
    assert.match(ex.fileSha256, /^[0-9a-f]{64}$/);
    scenario(`Excel oficial: ${stored.employeeCount} renglones agrupados por número de empleado que suman el total del lote`);

    // 08 detalle paginado sin omisiones
    const ids = new Set(); let dp = 1; let dpages = 1;
    do { const d = await ops.getFoodPayrollBatch(rhView, batchId, deps, dp); dpages = d.pages; d.items.forEach(i => ids.add(i.id)); assert.equal(d.itemsTotal, stored._count.items); dp++; } while (dp <= dpages);
    assert.equal(ids.size, stored._count.items);
    scenario(`detalle paginado: ${ids.size} renglones en ${dpages} páginas, sin omisiones`);

    // 09 dos generaciones masivas simultáneas del mismo periodo: un solo lote
    const cp = { weekFrom: weeks[4].day, weekTo: weeks[4].day };
    const ca = await mass.previewFoodPayrollPeriod(rh, { payrollReference: ref('c1'), ...cp }, deps);
    const cb = await mass.previewFoodPayrollPeriod(rh, { payrollReference: ref('c2'), ...cp }, deps);
    const race = await Promise.allSettled([mass.createFoodPayrollPeriodBatch(rh, body(ca), qkey(), deps), mass.createFoodPayrollPeriodBatch(rh, body(cb), qkey(), deps)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(race.map(r => r.reason?.code)));
    assert.ok(['PREVIEW_STALE', 'ACTIVE_ASSIGNMENT_EXISTS'].includes(race.find(r => r.status === 'rejected').reason.code));
    const assigned = await db.foodPayrollAssignment.count({ where: { status: 'ACTIVE', order: { menuWeekId: weeks[4].week.id } } });
    assert.equal(assigned, 50);
    scenario('generaciones masivas simultáneas: un solo lote, 50 asignaciones, sin duplicados');

    assert.equal(passed.length, 9);
    console.log(`QA YF-002-C1: escenarios=${passed.length} pedidos_masivos=${stored._count.items}`);
  } finally {
    try {
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL yellowflex.qa_fixture_cleanup = 'on'`);
        const batches = (await tx.foodPayrollBatch.findMany({ where: { payrollReference: { startsWith: `QA-FIXTURE-${run}` } }, select: { id: true } })).map(b => b.id);
        await tx.foodPayrollAuditEvent.deleteMany({ where: { OR: [{ batchId: { in: batches } }, { batchId: null, actorId: { in: userIds }, idempotencyKey: { startsWith: 'qa-fixture-' } }] } });
        await tx.foodPayrollAssignment.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatchItemService.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatchItem.deleteMany({ where: { batchId: { in: batches } } });
        await tx.foodPayrollBatch.deleteMany({ where: { id: { in: batches } } });
      }, { timeout: 120000 });
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
        events: await db.foodPayrollAuditEvent.count({ where: { actorId: { in: userIds } } }),
        orders: await db.foodOrder.count({ where: { menuWeekId: { in: weekIds } } }),
        users: await db.user.count({ where: { name: { startsWith: marker } } }),
        employees: await db.employee.count({ where: { employeeNumber: { startsWith: marker } } }),
      };
      console.log('QA YF-002-C1 limpieza: ' + JSON.stringify(residue));
      assert.deepEqual(residue, { batches: 0, events: 0, orders: 0, users: 0, employees: 0 }, 'Limpieza de fixtures incompleta');
    } finally {
      if (prevSecret === undefined) delete process.env.FOOD_PAYROLL_PREVIEW_SECRET; else process.env.FOOD_PAYROLL_PREVIEW_SECRET = prevSecret;
      delete globalThis.prisma; await db.$disconnect();
    }
  }
});
