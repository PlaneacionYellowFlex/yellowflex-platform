/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { harness } = require('./helpers/isolated-auth.cjs');

for (const [roles, granted, temporary, expected] of [
  [['RH'], true, false, true], [['RH'], false, false, false],
  [['CHEF'], true, false, false], [['EMPLEADO'], true, false, false],
  [['ADMIN'], true, false, false], [['RH'], true, true, false],
]) test(`cancellation API gate: ${roles}, grant=${granted}, temporary=${temporary}`, async () => {
  const h = harness({ roles, granted, temporary, realFoodServices: true });
  const service = h.load('lib/food-services/order-cancellation.ts');
  if (expected) assert.equal((await service.requireFoodOrderCancellationAccess()).id, 'actor');
  else {
    const route = h.load('app/api/food-services/hr/orders/route.ts');
    const response = await route.POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ orderId: 'other', reason: 'Solicitud QA' }) }));
    assert.equal(response.status, 403);
    assert.deepEqual(h.calls.writes, []);
  }
});

test('reason is mandatory, trimmed, bounded and rejects caller-supplied identity', () => {
  const { cancelFoodOrderSchema: schema } = harness({ realFoodServices: true }).load('lib/food-services/order-cancellation.ts');
  for (const reason of [undefined, '', '    ', 'abc', 'x'.repeat(501)]) assert.equal(schema.safeParse({ orderId: 'order', reason }).success, false);
  assert.equal(schema.parse({ orderId: 'order', reason: '  Motivo válido  ' }).reason, 'Motivo válido');
  assert.equal(schema.safeParse({ orderId: 'order', reason: 'Motivo válido', actorId: 'admin' }).success, false);
});

test('payroll assignment blocks cancellation inside the locked transaction; unassigned order retains cancellation flow', async () => {
  async function scenario(assigned) {
    const h = harness({ roles: ['RH'], granted: true, realFoodServices: true });
    const order = { id: 'order-1', status: 'CONFIRMED', payrollStatus: 'PENDING', payrollExportedAt: null,
      employeeId: 'employee-1', itemCount: 1, reservations: [{ menuItemId: 'menu-1', status: 'ACTIVE', employeeId: 'employee-1' }] };
    h.db.$queryRaw = async (parts) => {
      if (Array.isArray(parts) && parts.join('').includes('FoodPayrollAssignment')) return assigned ? [{ id: 'assignment-1' }] : [];
      return [];
    };
    h.db.corporateModulePermission.findMany = async () => [{ granted: true }, { granted: true }];
    h.db.foodOrder = {
      findUnique: async () => order,
      updateMany: async () => ({ count: 1 }),
    };
    h.db.consumption = { count: async () => 0 };
    h.db.reservation = { updateMany: async () => ({ count: 1 }) };
    h.db.foodOrderCancellation = { create: async ({ data }) => data };
    h.mocks['@/lib/food-services/rh-authorization'] = { hasFoodServicesRhAccess: async () => true };
    h.mocks['@/lib/cpanel/authorization'] = { hasCpanelPermission: async () => true };
    const cancellation = h.load('lib/food-services/order-cancellation.ts');
    return { h, cancellation, actor: { id: 'actor', roles: ['RH'] } };
  }
  const blocked = await scenario(true);
  await assert.rejects(blocked.cancellation.cancelFoodOrder(blocked.actor, { orderId: 'order-1', reason: 'Solicitud RH' }), /asignado a un lote de nómina activo/);
  assert.deepEqual(blocked.h.calls.writes, []);

  const allowed = await scenario(false);
  const result = await allowed.cancellation.cancelFoodOrder(allowed.actor, { orderId: 'order-1', reason: 'Solicitud RH' });
  assert.equal(result.orderId, 'order-1');
  assert.equal(result.previousStatus, 'CONFIRMED');
  assert.equal(result.newStatus, 'CANCELLED');
});

test('RH delegation cannot grant cancellation, and the permission is limited to Food Services RH', async () => {
  const h = harness({ roles: ['RH'], granted: true });
  assert.equal(h.load('lib/cpanel/delegation.ts').rhCanChange('food-services', 'cancel-food-order'), false);
  const response = await h.load('app/api/admin/cpanel/permissions/route.ts').PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ userId: 'target', moduleKey: 'food-services', actionKey: 'cancel-food-order', granted: true, reason: 'Prueba permiso' }) }));
  assert.equal(response.status, 403);
});

test('cancelled orders are immutable for employees, while both existing confirmation notices remain', async () => {
  const h = harness({ realFoodServices: true });
  h.mocks['@/lib/food-services/reservation-window'] = { getReservationWindowStatus: () => ({ isOpen: true, targetWeekStart: new Date('2099-06-08') }) };
  h.db.foodOrder = { findFirst: async () => ({ id: 'cancelled', status: 'CANCELLED' }) };
  await assert.rejects(h.load('lib/food-services/service.ts').saveWeeklyReservations('employee', []), /no puede modificarse/);
  const source = fs.readFileSync('components/food-services/employee-access.tsx', 'utf8');
  assert.match(source, /Pedido cancelado por RH/);
  assert.match(source, /confirmationStep/);
  assert.match(source, /setConfirmationStep\(2\)/);
});

test('employee read shows its cancellation and disables requests without exposing third-party orders', async () => {
  const h = harness({ realFoodServices: true });
  h.mocks['@/lib/food-services/self-service'] = { requireFoodEmployee: async () => ({ employee: { id: 'own-employee' } }) };
  h.db.employee.findUnique = async () => ({ id: 'own-employee', status: 'ACTIVE', department: {}, workShift: null });
  h.db.menuWeek = { findUnique: async () => ({ id: 'week', status: 'PUBLISHED', weekStart: new Date('2099-06-08'), days: [] }) };
  let identity;
  h.db.foodOrder = { findUnique: async query => { identity = query.where; return { id: 'own-order', status: 'CANCELLED', itemCount: 1, unitPrice: '25', totalAmount: '25', confirmedAt: new Date(), cancellation: { reason: 'Motivo RH', createdAt: new Date() } }; } };
  h.db.reservation = { findMany: async query => { assert.equal(query.where.employeeId, 'own-employee'); return []; } };
  const response = await h.load('app/api/food-services/reservations/route.ts').GET();
  const { data } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(identity, { employeeId_menuWeekId: { employeeId: 'own-employee', menuWeekId: 'week' } });
  assert.equal(data.order.status, 'CANCELLED'); assert.equal(data.order.cancellation.reason, 'Motivo RH');
  assert.equal(data.canRequest, false); assert.equal(data.isConfirmed, false);
});
