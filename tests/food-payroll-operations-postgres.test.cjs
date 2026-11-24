/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002 Bloque B — operación RH de prenómina contra PostgreSQL real aislado (127.0.0.1:55432/yellowflex_restore_test).
// node --require ./tests/helpers/server-only-register.cjs --import tsx --test tests/food-payroll-operations-postgres.test.cjs
// Requiere RUN_FOOD_PAYROLL_DB_TESTS=1. Crea fixtures QA-FIXTURE-* propios y los elimina al terminar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID, randomInt } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');

const passed = [];
function scenario(name) { passed.push(name); console.log(`ESCENARIO OK ${String(passed.length).padStart(2, '0')}: ${name}`); }

test('prenómina Bloque B: permisos, selección, historial, anulación, exportación oficial y concurrencia', {
  skip: process.env.RUN_FOOD_PAYROLL_DB_TESTS !== '1', timeout: 180000,
}, async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const ExcelJS = require('exceljs');
  const db = new PrismaClient({ datasourceUrl: url });
  const run = randomUUID().slice(0, 8);
  const marker = `QA-FIXTURE-PAYB-${run}`;
  const ref = s => `QA-FIXTURE-${run}-${s}`.slice(0, 40);
  const qkey = () => `qa-fixture-${randomUUID()}`;
  const userIds = []; const employeeIds = []; const weekIds = [];
  const prevSecret = process.env.FOOD_PAYROLL_PREVIEW_SECRET;
  try {
    await assertIsolatedIdentity(db);
    process.env.FOOD_PAYROLL_PREVIEW_SECRET = `qa-fixture-secret-${randomUUID()}-${randomUUID()}`;
    globalThis.prisma = db;
    const engine = require('../lib/food-services/payroll-batch-service.ts');
    const ops = require('../lib/food-services/payroll-batch-operations.ts');
    const deps = { db };
    const code = c => err => { assert.equal(err.code, c, `esperado ${c}, recibido ${err.code}: ${err.message}`); return true; };
    const denied = /Acceso restringido/;

    const mkUser = async (role, actions) => {
      const u = await db.user.create({ data: { name: `${marker}-${role}-${actions.join('+') || 'none'}`, passwordMustChange: false, roles: { create: { role } } } });
      userIds.push(u.id);
      if (actions.length) await db.corporateModulePermission.createMany({ data: actions.map(actionKey => ({ userId: u.id, moduleKey: 'food-services', actionKey, granted: true })) });
      return { id: u.id, name: u.name, email: null, roles: [role], employee: null };
    };
    const all = ['view', 'manage', 'view-payroll-batches', 'create-payroll-batch', 'void-payroll-batch', 'export-payroll-batch'];
    const rh = await mkUser('RH', all);
    const rhView = await mkUser('RH', ['view', 'manage', 'view-payroll-batches']);
    const rhCreate = await mkUser('RH', ['view', 'manage', 'create-payroll-batch']);
    const rhNoManage = await mkUser('RH', ['view', 'view-payroll-batches', 'create-payroll-batch', 'void-payroll-batch', 'export-payroll-batch']);
    const admin = await mkUser('ADMIN', all);

    const dept = await db.department.findFirstOrThrow();
    const shift = await db.workShift.findFirstOrThrow({ where: { active: true } });
    const base = Date.UTC(2197, 0, 7) + randomInt(0, 2000) * 7 * 86400000;
    const weeks = [];
    for (let w = 0; w < 3; w++) {
      const weekStart = new Date(base + w * 7 * 86400000);
      const week = await db.menuWeek.create({ data: { weekStart, status: 'PUBLISHED' } }); weekIds.push(week.id);
      const items = [];
      for (let d = 0; d < 5; d++) {
        const day = await db.menuDay.create({ data: { menuWeekId: week.id, serviceDate: new Date(weekStart.getTime() + d * 86400000) } });
        items.push(await db.menuItem.create({ data: { menuDayId: day.id, name: `${marker} W${w}D${d}`, serviceType: 'LUNCH', price: '80.00' } }));
      }
      weeks.push({ week, items });
    }
    let n = 0;
    const mkOrder = async (w, itemCount = 2, price = '40.00', name) => {
      const e = await db.employee.create({ data: { employeeNumber: `${marker}-E${n++}`, fullName: name ?? `${marker} Persona ${n}`, departmentId: dept.id,
        workShiftId: shift.id, pinHash: 'fictional-unusable', pinMustChange: false, status: 'ACTIVE' } });
      employeeIds.push(e.id);
      return db.foodOrder.create({ data: { employeeId: e.id, menuWeekId: weeks[w].week.id, itemCount, unitPrice: price, totalAmount: (Number(price) * itemCount).toFixed(2),
        status: 'CONFIRMED', payrollStatus: 'PENDING', reservations: { create: weeks[w].items.slice(0, itemCount).map(i => ({ employeeId: e.id, menuItemId: i.id, status: 'ACTIVE' })) } } });
    };
    const generate = async (orderIds, r) => {
      const p = await engine.previewFoodPayrollBatch(rh, { payrollReference: r, orderIds }, deps);
      return (await engine.createFoodPayrollBatch(rh, { payrollReference: r, orderIds, previewToken: p.previewToken }, qkey(), deps)).body;
    };

    // 01 capacidades granulares sin atajo ADMIN
    assert.deepEqual(await ops.getPayrollCapabilities(rh.id, db), { view: true, create: true, void: true, export: true });
    assert.deepEqual(await ops.getPayrollCapabilities(rhView.id, db), { view: true, create: false, void: false, export: false });
    assert.deepEqual(await ops.getPayrollCapabilities(admin.id, db), { view: false, create: false, void: false, export: false });
    assert.deepEqual(await ops.getPayrollCapabilities(rhNoManage.id, db), { view: false, create: false, void: false, export: false });
    scenario('capacidades granulares C-PANEL; ADMIN sin acceso implícito; manage obligatorio');

    // 02 búsqueda de pedidos con filtros por semana y colaborador
    const a1 = await mkOrder(0, 2, '40.00', `${marker} Ana Ruiz`); const a2 = await mkOrder(1, 3, '45.50'); const a3 = await mkOrder(2, 1, '30.00');
    const wk = i => weeks[i].week.weekStart.toISOString().slice(0, 10);
    const c1 = await ops.listFoodPayrollCandidates(rh, { weekFrom: wk(0), weekTo: wk(1), employee: marker }, deps);
    assert.deepEqual(c1.orders.map(o => o.orderId).sort(), [a1.id, a2.id].sort());
    assert.ok(c1.orders.every(o => o.classification === 'eligible'));
    const c2 = await ops.listFoodPayrollCandidates(rh, { employee: 'Ana Ruiz', weekFrom: wk(0), weekTo: wk(2) }, deps);
    assert.deepEqual(c2.orders.map(o => o.orderId), [a1.id]);
    await assert.rejects(ops.listFoodPayrollCandidates(rhView, {}, deps), denied);
    await assert.rejects(ops.listFoodPayrollCandidates(rh, { weekFrom: '01/02/2026' }, deps), code('INVALID_REQUEST'));
    scenario('selección: filtros por semana y colaborador; requiere permiso de generación');

    // 03 historial y detalle
    const b1 = await generate([a1.id, a2.id, a3.id], ref('hist'));
    const list = await ops.listFoodPayrollBatches(rhView, { reference: ref('hist') }, deps);
    assert.equal(list.batches.length, 1);
    assert.equal(list.batches[0].committedAmount, '246.50'); assert.equal(list.batches[0].serviceWeeks.length, 3);
    assert.equal('fileContent' in list.batches[0], false, 'el historial no expone el archivo');
    const detail = await ops.getFoodPayrollBatch(rhView, b1.batchId, deps);
    assert.equal(detail.items.length, 3); assert.ok(detail.items.every(i => i.assignmentStatus === 'ACTIVE'));
    assert.deepEqual(detail.auditEvents.map(e => e.eventType), ['BATCH_CREATED']);
    await assert.rejects(ops.getFoodPayrollBatch(rhCreate, b1.batchId, deps), denied);
    await assert.rejects(ops.getFoodPayrollBatch(rhView, randomUUID(), deps), code('BATCH_NOT_FOUND'));
    const c3 = await ops.listFoodPayrollCandidates(rh, { weekFrom: wk(0), weekTo: wk(2), employee: marker, view: 'all' }, deps);
    assert.ok(c3.orders.filter(o => [a1.id, a2.id, a3.id].includes(o.orderId)).every(o => o.classification === 'excluded' && o.activeBatch?.id === b1.batchId));
    scenario('consulta histórica y detalle; pedidos asignados visibles con su lote');

    // 04 anulación antes de exportar con liberación transaccional
    const ordersBefore = await db.foodOrder.findMany({ where: { id: { in: [a1.id, a2.id, a3.id] } }, orderBy: { id: 'asc' } });
    await assert.rejects(ops.voidFoodPayrollBatch(rhView, b1.batchId, { reason: 'QA sin permiso' }, deps), denied);
    await assert.rejects(ops.voidFoodPayrollBatch(rh, b1.batchId, { reason: 'x' }, deps), code('INVALID_REQUEST'));
    const v = await ops.voidFoodPayrollBatch(rh, b1.batchId, { reason: 'QA error de selección' }, deps);
    assert.equal(v.status, 'VOIDED'); assert.equal(v.releasedAssignments, 3);
    const voided = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b1.batchId }, include: { assignments: true } });
    assert.equal(voided.voidedById, rh.id); assert.ok(voided.assignments.every(x => x.status === 'RELEASED' && x.releasedById === rh.id));
    assert.deepEqual(await db.foodOrder.findMany({ where: { id: { in: [a1.id, a2.id, a3.id] } }, orderBy: { id: 'asc' } }), ordersBefore, 'anular no modifica FoodOrder');
    await assert.rejects(ops.voidFoodPayrollBatch(rh, b1.batchId, { reason: 'QA segunda vez' }, deps), code('BATCH_ALREADY_VOIDED'));
    await assert.rejects(ops.exportFoodPayrollBatch(rh, b1.batchId, {}, deps), code('BATCH_ALREADY_VOIDED'));
    const events = (await ops.getFoodPayrollBatch(rh, b1.batchId, deps)).auditEvents.map(e => e.eventType);
    assert.deepEqual(events, ['BATCH_CREATED', 'BATCH_VOIDED', 'ASSIGNMENT_RELEASED']);
    scenario('anulación previa a exportación; asignaciones liberadas en la misma transacción; sin doble anulación');

    // 05 pedidos liberados vuelven a ser elegibles
    const b2 = await generate([a1.id, a2.id, a3.id], ref('re'));
    assert.equal(b2.orderCount, 3);
    scenario('pedidos liberados reutilizables en un nuevo lote');

    // 06 exportación oficial Excel con SHA-256
    await assert.rejects(ops.exportFoodPayrollBatch(rhView, b2.batchId, {}, deps), denied);
    const ex = await ops.exportFoodPayrollBatch(rh, b2.batchId, { externalReference: 'QA envío 1' }, deps);
    assert.equal(ex.status, 'EXPORTED'); assert.match(ex.fileSha256, /^[0-9a-f]{64}$/); assert.match(ex.fileName, /^Prenomina_.*\.xlsx$/);
    const stored = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b2.batchId } });
    assert.equal(createHash('sha256').update(stored.fileContent).digest('hex'), ex.fileSha256);
    assert.equal(stored.exportedById, rh.id); assert.equal(stored.externalReference, 'QA envío 1');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(stored.fileContent);
    assert.deepEqual(wb.worksheets.map(s => s.name), ['Prenomina', 'Servicios', 'Control']);
    assert.equal(wb.getWorksheet('Prenomina').rowCount, 1 + 3 + 1);
    assert.equal(wb.getWorksheet('Servicios').rowCount, 1 + 6);
    const totalRow = wb.getWorksheet('Prenomina').getRow(5);
    assert.equal(totalRow.getCell(4).value, 'TOTAL'); assert.equal(totalRow.getCell(13).value, 246.5);
    const control = Object.fromEntries(wb.getWorksheet('Control').getSheetValues().slice(2).map(r => [r[1], r[2]]));
    assert.equal(control['Referencia de prenómina'], ref('re')); assert.match(control.Aviso, /no significa que el descuento haya sido aplicado/);
    const st = await db.foodOrder.findMany({ where: { id: { in: [a1.id, a2.id, a3.id] } }, select: { payrollStatus: true } });
    assert.ok(st.every(o => o.payrollStatus === 'PENDING'), 'exportar no marca descuento aplicado ni cambia FoodOrder');
    scenario('exportación oficial Excel con SHA-256 registrado; EXPORTED no cambia pedidos');

    // 07 una sola exportación; sin anular tras exportar; descarga íntegra
    await assert.rejects(ops.exportFoodPayrollBatch(rh, b2.batchId, {}, deps), code('BATCH_ALREADY_EXPORTED'));
    await assert.rejects(ops.voidFoodPayrollBatch(rh, b2.batchId, { reason: 'QA tras exportar' }, deps), code('BATCH_ALREADY_EXPORTED'));
    const dl = await ops.downloadFoodPayrollExport(rhView, b2.batchId, deps);
    assert.equal(dl.fileSha256, ex.fileSha256); assert.equal(createHash('sha256').update(dl.body).digest('hex'), ex.fileSha256);
    await assert.rejects(ops.downloadFoodPayrollExport(rhCreate, b2.batchId, deps), denied);
    await assert.rejects(ops.downloadFoodPayrollExport(rhView, b1.batchId, deps), code('EXPORT_NOT_FOUND'));
    const again = await ops.listFoodPayrollCandidates(rh, { weekFrom: wk(0), weekTo: wk(2), employee: marker, view: 'all' }, deps);
    assert.ok(again.orders.filter(o => [a1.id, a2.id, a3.id].includes(o.orderId)).every(o => o.classification === 'excluded'), 'pedidos exportados no se vuelven a cobrar');
    scenario('una sola exportación oficial; no se anula tras exportar; descarga con SHA-256 verificado');

    // 08 inmutabilidad en PostgreSQL de la exportación registrada
    const guard = /YF_PAYROLL_GUARD/;
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollBatch" SET "fileSha256" = $2 WHERE "id" = $1`, b2.batchId, 'f'.repeat(64)), guard);
    await assert.rejects(db.$executeRawUnsafe(`UPDATE "FoodPayrollBatch" SET "status" = 'VOIDED', "voidedAt" = now(), "voidedById" = $2, "voidReason" = 'QA directo' WHERE "id" = $1`, b2.batchId, rh.id),
      err => /YF_PAYROLL_GUARD|violates check constraint/.test(err.message));
    scenario('exportación registrada inmutable en PostgreSQL');

    // 09 anulación y exportación concurrentes sobre el mismo lote
    const o4 = await mkOrder(0); const o5 = await mkOrder(1);
    const b3 = await generate([o4.id, o5.id], ref('race'));
    const race = await Promise.allSettled([ops.voidFoodPayrollBatch(rh, b3.batchId, { reason: 'QA carrera anular' }, deps), ops.exportFoodPayrollBatch(rh, b3.batchId, {}, deps)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(race.map(r => r.reason?.code)));
    const final = await db.foodPayrollBatch.findUniqueOrThrow({ where: { id: b3.batchId }, include: { assignments: true } });
    if (final.status === 'VOIDED') assert.ok(final.assignments.every(a => a.status === 'RELEASED') && !final.exportedAt);
    else { assert.equal(final.status, 'EXPORTED'); assert.ok(final.assignments.every(a => a.status === 'ACTIVE') && !final.voidedAt); }
    scenario(`anulación y exportación concurrentes: una sola gana (${final.status})`);

    // 10 doble exportación concurrente (doble clic)
    const o6 = await mkOrder(2); const b4 = await generate([o6.id], ref('dbl'));
    const twice = await Promise.allSettled([ops.exportFoodPayrollBatch(rh, b4.batchId, {}, deps), ops.exportFoodPayrollBatch(rh, b4.batchId, {}, deps)]);
    assert.equal(twice.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(twice.find(r => r.status === 'rejected').reason.code, 'BATCH_ALREADY_EXPORTED');
    assert.equal(await db.foodPayrollAuditEvent.count({ where: { batchId: b4.batchId, eventType: 'BATCH_EXPORTED' } }), 1);
    scenario('doble exportación simultánea: un solo archivo oficial');

    // 11 filtros del historial por estado
    const exported = await ops.listFoodPayrollBatches(rhView, { status: 'EXPORTED', reference: `QA-FIXTURE-${run}` }, deps);
    assert.ok(exported.batches.length >= 2 && exported.batches.every(b => b.status === 'EXPORTED'));
    const voidedList = await ops.listFoodPayrollBatches(rhView, { status: 'VOIDED', reference: `QA-FIXTURE-${run}` }, deps);
    assert.ok(voidedList.batches.some(b => b.id === b1.batchId));
    scenario('historial filtrable por estado y referencia');

    assert.equal(passed.length, 11);
    console.log(`QA YF-002-B: escenarios=${passed.length}`);
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
      }, { timeout: 60000 });
      await db.reservation.deleteMany({ where: { foodOrder: { menuWeekId: { in: weekIds } } } });
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
      console.log('QA YF-002-B limpieza: ' + JSON.stringify(residue));
      assert.deepEqual(residue, { batches: 0, events: 0, orders: 0, users: 0, employees: 0 }, 'Limpieza de fixtures incompleta');
    } finally {
      if (prevSecret === undefined) delete process.env.FOOD_PAYROLL_PREVIEW_SECRET; else process.env.FOOD_PAYROLL_PREVIEW_SECRET = prevSecret;
      delete globalThis.prisma; await db.$disconnect();
    }
  }
});
