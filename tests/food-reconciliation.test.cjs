const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { harness } = require('./helpers/isolated-auth.cjs');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');

function productionHarness(db) {
  const h = harness({ realFoodServices: true });
  if (db) h.mocks['@/lib/db'] = { db };
  // Exercise real production query, workbook builder and extraordinary query.
  for (const name of ['hr-billing-service', 'payroll-export', 'billing-export-service', 'extraordinary-service']) {
    delete h.mocks[`@/lib/food-services/${name}`];
  }
  h.mocks.exceljs = ExcelJS;
  return h;
}
function fixture() {
  const week = { id: 'week', weekStart: new Date('2099-06-08'), publishedAt: new Date(), status: 'ARCHIVED', days: [] };
  const day = { id: 'day', serviceDate: week.weekStart, items: [] }; week.days.push(day);
  const item = { id: 'item', name: 'Platillo archivado', serviceType: 'BREAKFAST', price: '99.00', available: false, archivedAt: new Date() };
  day.items.push(item);
  const orders = ['25.00', '30.00'].map((price, index) => ({
    id: `order-${index}`, status: 'CONFIRMED', payrollStatus: index ? 'PROCESSED' : 'EXPORTED',
    itemCount: 1, unitPrice: price, totalAmount: price, confirmedAt: new Date(), menuWeek: week,
    employee: { id: `employee-${index}`, fullName: `Persona ${index}`, employeeNumber: `QA-${index}`, position: null, status: 'ACTIVE', department: { id: 'dept', code: 'QA', name: 'QA' }, workShift: null },
    reservations: [{ id: `reservation-${index}`, consumption: index ? { id: 'existing-consumption', consumedAt: new Date() } : null, menuItem: { ...item, menuDay: { id: day.id, serviceDate: day.serviceDate } } }],
  }));
  orders.push({ ...orders[0], id: 'cancelled', status: 'CANCELLED', totalAmount: '777.00' });
  const queries = []; const transactions = [];
  const db = {
    foodOrder: { findMany: async q => {
      queries.push(q); assert.equal(q.where.status, 'CONFIRMED');
      assert.equal(q.select.reservations.where.status, 'ACTIVE');
      assert.equal(q.select.reservations.select.menuItem.select.price, undefined);
      assert.equal(q.select.reservations.where.menuItem, undefined);
      return orders.filter(o => o.status === q.where.status && (!q.where.menuWeekId || q.where.menuWeekId === o.menuWeek.id) && (!q.where.id || q.where.id.in.includes(o.id)));
    } },
    menuWeek: { findFirst: async q => {
      assert.equal(q.select.days.select.items.where, undefined, 'archived/disabled items must remain visible');
      assert.ok(q.where.OR.some(condition => condition.foodOrders?.some.status === 'CONFIRMED'));
      return week;
    } },
    foodExtraordinaryService: { findMany: async () => [] },
    $executeRawUnsafe: async sql => assert.equal(sql, 'SET TRANSACTION READ ONLY'),
    $transaction: async (fn, options) => { transactions.push(options); return fn(db); },
  };
  return { db, week, orders, queries, transactions };
}
async function workbook(report) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(report.body); return book;
}

test('CHEF and RH share ordinary orders and historical prices, regardless of consumption or archived menus', async () => {
  const f = fixture(); const h = productionHarness(f.db);
  const rh = await h.load('lib/food-services/hr-billing-service.ts').getHrBillingSummary(f.db, undefined, f.week.id);
  const chef = await h.load('lib/food-services/chef-production-service.ts').getChefProductionSummary(f.week.id);
  assert.deepEqual(rh.totals, { orders: 2, employees: 2, services: 2, amount: '55.00' });
  assert.equal(chef.totals.confirmedOrders, rh.totals.orders);
  assert.equal(chef.totals.uniqueCollaborators, rh.totals.employees);
  assert.equal(chef.totals.ordinaryServices, rh.totals.services);
  assert.equal(chef.totals.ordinaryAmount, rh.totals.amount);
  assert.equal(chef.days[0].services[0].employeeConfirmed, 2);
  assert.equal(chef.days[0].services[0].ordinaryAmount, '55.00');
  assert.deepEqual(rh.orders.map(o => o.services[0].amount), ['25.00', '30.00']);
  assert.deepEqual(rh.orders.map(o => o.services[0].menuPrice), ['25.00', '30.00']);
  assert.ok(f.queries.every(q => q.where.menuWeekId === f.week.id));
});

test('repeated informative Excel downloads preserve payroll data and all existing sheet columns', async () => {
  const f = fixture(); const h = productionHarness(f.db);
  const before = JSON.stringify(f.orders);
  const download = h.load('lib/food-services/payroll-export.ts').exportFoodPayroll;
  const first = await workbook(await download(f.week.id, 'chef'));
  const second = await workbook(await download(f.week.id, 'rh'));
  assert.equal(JSON.stringify(f.orders), before);
  assert.equal(f.transactions.length, 2);
  assert.ok(f.transactions.every(o => o.isolationLevel === 'RepeatableRead'));
  assert.deepEqual(first.worksheets.map(s => s.name), second.worksheets.map(s => s.name));
  assert.equal(first.worksheets.length, 4);
  const detail = first.worksheets[1];
  assert.deepEqual(detail.getRow(4).values.slice(1), ['Nómina', 'Colaborador', 'Departamento', 'Turno', 'Fecha servicio', 'Tipo', 'Platillo', 'Importe', 'Pedido', 'Reservación']);
  assert.equal(detail.getCell('H5').value, 25); assert.equal(detail.getCell('H6').value, 30);
  assert.equal(first.getWorksheet('Control').getCell('B13').value, 'CUADRA');
  assert.match(first.getWorksheet('Control').getCell('A2').value, /informativo/);
  for (let index = 0; index < 2; index++) {
    const a = first.worksheets[index]; const b = second.worksheets[index];
    assert.deepEqual(a.getRows(4, a.rowCount - 3).map(r => r.values), b.getRows(4, b.rowCount - 3).map(r => r.values));
  }
});

test('extraordinary demand remains separate from ordinary employee charges', async () => {
  const f = fixture(); const h = productionHarness(f.db);
  f.db.foodExtraordinaryService.findMany = async () => [{ menuItemId: 'item', quantity: 4 }];
  const chef = await h.load('lib/food-services/chef-production-service.ts').getChefProductionSummary('week');
  assert.equal(chef.totals.confirmedServices, 6);
  assert.equal(chef.totals.extraordinaryServices, 4);
  assert.equal(chef.totals.ordinaryServices, 2);
  assert.equal(chef.totals.ordinaryAmount, '55.00');
});

test('both independent report endpoints preserve access guards and allow GET and legacy POST downloads', async () => {
  for (const area of ['chef', 'hr']) {
    const h = harness({ roles: area === 'chef' ? ['CHEF'] : ['RH'], granted: true });
    const route = h.load(`app/api/food-services/${area}/billing/export/route.ts`);
    for (const method of ['GET', 'POST']) {
      assert.equal((await route[method](new Request('http://localhost/report?weekId=week', { method }))).status, 200);
      assert.equal((await route[method](new Request('http://localhost/report', { method }))).status, 400);
    }
    assert.deepEqual(h.calls.writes, []);
  }
});

test('isolated QA: real shared queries and repeated Excel reports are read-only and reconcile per week', {
  skip: process.env.RUN_FOOD_RECONCILIATION_READONLY !== '1', timeout: 60000,
}, async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await assertIsolatedIdentity(db);
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      // Inject the same transaction so every query, including report construction,
      // runs against one read-only snapshot. No sessions or fixtures are created.
      const client = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
      const h = productionHarness(client);
      const before = await tx.foodOrder.findMany({ orderBy: { id: 'asc' }, include: { reservations: true, cancellation: true } });
      const grantBefore = await tx.corporateModulePermission.findMany({ where: { moduleKey: 'food-services' }, orderBy: { id: 'asc' } });
      assert.equal(grantBefore.find(p => p.userId === 'cmw5ausm90002kafoyifjtrdf' && p.actionKey === 'cancel-food-order')?.granted, true, 'El permiso QA debe permanecer concedido');
      const rhService = h.load('lib/food-services/hr-billing-service.ts');
      const weeks = (await rhService.getHrBillingSummary(tx)).weeks;
      assert.ok(weeks.length > 0);
      for (const week of weeks) {
        const rh = await rhService.getHrBillingSummary(tx, undefined, week.id);
        const chef = await h.load('lib/food-services/chef-production-service.ts').getChefProductionSummary(week.id);
        assert.equal(chef.totals.confirmedOrders, rh.totals.orders);
        assert.equal(chef.totals.uniqueCollaborators, rh.totals.employees);
        assert.equal(chef.totals.ordinaryServices, rh.totals.services);
        assert.equal(chef.totals.ordinaryAmount, rh.totals.amount);
        assert.equal(chef.days.reduce((n, d) => n + d.services.reduce((a, s) => a + s.employeeConfirmed, 0), 0), rh.totals.services);
        for (let repetition = 0; repetition < 2; repetition++) {
          const book = await workbook(await h.load('lib/food-services/payroll-export.ts').exportFoodPayroll(week.id, 'read-only-audit'));
          assert.equal(book.getWorksheet('Control').getCell('B13').value, 'CUADRA');
        }
        console.log(`QA ${week.weekStart.toISOString().slice(0, 10)}: ${rh.totals.orders} pedidos, ${rh.totals.employees} colaboradores, ${rh.totals.services} servicios, $${rh.totals.amount}`);
      }
      assert.deepEqual(await tx.foodOrder.findMany({ orderBy: { id: 'asc' }, include: { reservations: true, cancellation: true } }), before);
      assert.deepEqual(await tx.corporateModulePermission.findMany({ where: { moduleKey: 'food-services' }, orderBy: { id: 'asc' } }), grantBefore);
      assert.equal(await tx.consumption.count(), 0);
    }, { isolationLevel: 'RepeatableRead', timeout: 45000 });
  } finally { await db.$disconnect(); }
});
