const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');
const { harness } = require('./helpers/isolated-auth.cjs');

test('exceptional cancellation: isolated PostgreSQL transactions, concurrency, demand, payroll and ownership', {
  skip: process.env.RUN_FOOD_CANCELLATION_DB_TESTS !== '1', timeout: 60000,
}, async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  const marker = `QA-CANCEL-${randomUUID()}`;
  let week; let actor; const employeeIds = []; const userIds = [];
  const envKeys = ['FOOD_QA_ISOLATED', 'FOOD_QA_REFERENCE_DATE', 'NODE_ENV'];
  const before = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
  try {
    await assertIsolatedIdentity(db);
    process.env.NODE_ENV = 'development'; process.env.FOOD_QA_ISOLATED = '1';
    process.env.FOOD_QA_REFERENCE_DATE = '2199-06-07T18:00:00.000Z';
    globalThis.prisma = db;
    const { getNextFoodWeekStart } = require('../lib/food-services/calendar.ts');
    const { cancelFoodOrder } = require('../lib/food-services/order-cancellation.ts');
    const { getChefProductionSummary } = require('../lib/food-services/chef-production-service.ts');
    const { getHrBillingSummary } = require('../lib/food-services/hr-billing-service.ts');
    const { exportFoodPayroll } = require('../lib/food-services/payroll-export.ts');
    const { registerConsumption, saveWeeklyReservations } = require('../lib/food-services/service.ts');
    const referenceWeek = getNextFoodWeekStart();
    assert.equal(await db.menuWeek.count({ where: { weekStart: referenceWeek } }), 0, 'La semana de prueba debe estar libre');
    const rh = await db.user.create({ data: { name: marker, passwordMustChange: false, roles: { create: { role: 'RH' } } } });
    userIds.push(rh.id); actor = { id: rh.id, roles: ['RH'], passwordMustChange: false };
    await db.corporateModulePermission.createMany({ data: ['view', 'manage', 'cancel-food-order'].map(actionKey => ({ userId: rh.id, moduleKey: 'food-services', actionKey, granted: true })) });
    const dept = await db.department.findFirstOrThrow();
    const shift = await db.workShift.findFirstOrThrow({ where: { active: true, code: 'T1' } });
    week = await db.menuWeek.create({ data: { weekStart: referenceWeek, status: 'PUBLISHED' } });
    const day = await db.menuDay.create({ data: { menuWeekId: week.id, serviceDate: referenceWeek } });
    const item = await db.menuItem.create({ data: { menuDayId: day.id, name: marker, serviceType: 'BREAKFAST', price: '25' } });
    const orders = [];
    for (let i = 0; i < 9; i++) {
      const employee = await db.employee.create({ data: { employeeNumber: `${marker}-${i}`, fullName: `${marker} ${i}`, departmentId: dept.id, workShiftId: shift.id, pinHash: 'fictional-unusable', pinMustChange: false } });
      employeeIds.push(employee.id);
      if (i === 8) {
        // Exercise the actual confirmation transaction and PostgreSQL advisory lock.
        const confirmHarness = harness({ realFoodServices: true });
        confirmHarness.mocks['@/lib/db'] = { db };
        confirmHarness.mocks['@/lib/food-services/reservation-window'] = { getReservationWindowStatus: () => ({ isOpen: true, targetWeekStart: referenceWeek }) };
        const confirmed = await confirmHarness.load('lib/food-services/service.ts').confirmWeeklyOrder(employee.id, [item.id]);
        orders.push(await db.foodOrder.findUniqueOrThrow({ where: { id: confirmed.id } }));
      } else {
        orders.push(await db.foodOrder.create({ data: { employeeId: employee.id, menuWeekId: week.id, itemCount: 1, unitPrice: '25', totalAmount: '25', payrollStatus: 'PENDING', reservations: { create: { employeeId: employee.id, menuItemId: item.id } } } }));
      }
    }
    const cancel = (index, reason = 'Prueba ficticia de cancelación') => cancelFoodOrder(actor, { orderId: orders[index].id, reason });
    assert.equal((await getChefProductionSummary()).totals.confirmedServices, 9);
    // Execute the authorized path through the actual API as well as the service.
    const apiHarness = harness({ realFoodServices: true });
    const auth = apiHarness.load('lib/auth/corporate-auth.ts');
    apiHarness.mocks['@/lib/db'] = { db };
    apiHarness.mocks['@/lib/auth/corporate-auth'] = { ...auth, requireCorporateUser: async () => actor };
    const response = await apiHarness.load('app/api/food-services/hr/orders/route.ts').POST(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ orderId: orders[0].id, reason: 'Cancelación QA por API autorizada' }),
    }));
    assert.equal(response.status, 200);
    const audit = await db.foodOrderCancellation.findUniqueOrThrow({ where: { orderId: orders[0].id } });
    assert.equal(audit.actorId, rh.id); assert.equal(audit.previousStatus, 'CONFIRMED'); assert.equal(audit.newStatus, 'CANCELLED');
    assert.equal((await db.reservation.findFirstOrThrow({ where: { foodOrderId: orders[0].id } })).status, 'CANCELLED');
    assert.equal((await getChefProductionSummary()).totals.confirmedServices, 8);
    assert.equal((await getHrBillingSummary(db, [orders[0].id])).orders.length, 0);
    await assert.rejects(cancel(0), /de nuevo/);
    await assert.rejects(cancel(1, '   '));
    for (const roles of [['CHEF'], ['EMPLEADO'], ['ADMIN']]) await assert.rejects(cancelFoodOrder({ ...actor, roles }, { orderId: orders[1].id, reason: 'Motivo ficticio' }), /restringido/);
    await db.corporateModulePermission.update({ where: { userId_moduleKey_actionKey: { userId: rh.id, moduleKey: 'food-services', actionKey: 'cancel-food-order' } }, data: { granted: false } });
    await assert.rejects(cancel(1), /restringido/);
    await db.corporateModulePermission.update({ where: { userId_moduleKey_actionKey: { userId: rh.id, moduleKey: 'food-services', actionKey: 'cancel-food-order' } }, data: { granted: true } });
    const race = await Promise.allSettled([cancel(1), cancel(1)]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await db.foodOrderCancellation.count({ where: { orderId: orders[1].id } }), 1);
    // A failing audit must roll back both order and reservations.
    const h = harness({ realFoodServices: true });
    h.mocks['@/lib/db'] = { db: new Proxy(db, { get(target, key) {
      if (key === '$transaction') return callback => target.$transaction(tx => callback(new Proxy(tx, { get(t, k) {
        if (k === 'foodOrderCancellation') return { create: async () => { throw new Error('QA audit failure'); } };
        return t[k];
      } })));
      return target[key];
    } }) };
    await assert.rejects(h.load('lib/food-services/order-cancellation.ts').cancelFoodOrder(actor, { orderId: orders[2].id, reason: 'Fallo de auditoría simulado' }), /QA audit failure/);
    assert.equal((await db.foodOrder.findUniqueOrThrow({ where: { id: orders[2].id } })).status, 'CONFIRMED');
    assert.equal((await db.reservation.findFirstOrThrow({ where: { foodOrderId: orders[2].id } })).status, 'ACTIVE');
    assert.equal(await db.foodOrderCancellation.count({ where: { orderId: orders[2].id } }), 0);
    const reservation = await db.reservation.findFirstOrThrow({ where: { foodOrderId: orders[3].id } });
    await db.consumption.create({ data: { employeeId: orders[3].employeeId, menuItemId: item.id, reservationId: reservation.id, priceApplied: '25' } });
    await assert.rejects(cancel(3), /consumos/);
    for (const [index, payrollStatus] of [[4, 'EXPORTED'], [5, 'PROCESSED'], [6, 'UNVERIFIED']]) {
      await db.foodOrder.update({ where: { id: orders[index].id }, data: { payrollStatus } });
      await assert.rejects(cancel(index), /ajuste controlado/);
    }
    // Cancellation and consumption use the same lock: exactly one can win.
    const consumeRace = await Promise.allSettled([cancel(7), registerConsumption(orders[7].employeeId, item.id, 'EMPLOYEE_NUMBER')]);
    assert.equal(consumeRace.filter(r => r.status === 'fulfilled').length, 1);
    const finalOrder = await db.foodOrder.findUniqueOrThrow({ where: { id: orders[7].id } });
    const consumptionCount = await db.consumption.count({ where: { employeeId: orders[7].employeeId } });
    assert.equal(consumptionCount, finalOrder.status === 'CANCELLED' ? 0 : 1);
    // An already-cancelled employee cannot save/reactivate it through the normal API service.
    const hh = harness({ realFoodServices: true }); hh.mocks['@/lib/db'] = { db };
    hh.mocks['@/lib/food-services/reservation-window'] = { getReservationWindowStatus: () => ({ isOpen: true, targetWeekStart: referenceWeek }) };
    await assert.rejects(hh.load('lib/food-services/service.ts').saveWeeklyReservations(orders[0].employeeId, [item.id]), /no puede modificarse/);
    // Informational downloads do not change payroll state or block cancellation.
    const beforeReport = await db.foodOrder.findMany({ where: { menuWeekId: week.id }, orderBy: { id: 'asc' } });
    await exportFoodPayroll(week.id, rh.id);
    assert.deepEqual(await db.foodOrder.findMany({ where: { menuWeekId: week.id }, orderBy: { id: 'asc' } }), beforeReport);
    await cancel(8);
    const report = await exportFoodPayroll(week.id, rh.id);
    const last = await db.foodOrder.findUniqueOrThrow({ where: { id: orders[8].id } });
    assert.equal(last.status, 'CANCELLED'); assert.equal(last.payrollStatus, 'PENDING');
    const ExcelJS = require('exceljs'); const book = new ExcelJS.Workbook(); await book.xlsx.load(report.body);
    const exported = []; book.worksheets[0].eachRow(row => { exported.push(String(row.getCell(1).value)); });
    const cancelled = await db.foodOrder.findMany({ where: { menuWeekId: week.id, status: 'CANCELLED' }, include: { employee: true } });
    for (const order of cancelled) assert.ok(!exported.includes(order.employee.employeeNumber));
    assert.equal(await db.foodOrder.count({ where: { menuWeekId: week.id } }), 9, 'No orders deleted');
    console.log('QA: authorization, reason, duplicate/concurrent cancellation, rollback, demand, consumption and payroll export verified.');
  } finally {
    // Delete only this run's disposable fixture, never restored or pilot records.
    if (week) {
      await db.foodOrderCancellation.deleteMany({ where: { order: { menuWeekId: week.id } } });
      await db.consumption.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await db.reservation.deleteMany({ where: { foodOrder: { menuWeekId: week.id } } });
      await db.foodOrder.deleteMany({ where: { menuWeekId: week.id } });
      await db.menuItem.deleteMany({ where: { menuDay: { menuWeekId: week.id } } });
      await db.menuDay.deleteMany({ where: { menuWeekId: week.id } });
      await db.menuWeek.delete({ where: { id: week.id } });
    }
    await db.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await db.corporateModulePermission.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    for (const key of envKeys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    delete globalThis.prisma; await db.$disconnect();
  }
});
