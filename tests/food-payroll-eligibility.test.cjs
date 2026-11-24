/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadEligibility() {
  const file = path.resolve(__dirname, '../lib/food-services/payroll-eligibility.ts');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

const { evaluateFoodPayrollEligibility, getFoodPayrollOrderEligibility } = loadEligibility();
const weekStart = new Date('2026-11-09T00:00:00.000Z');
const eligibleOrder = () => ({
  id: 'order-1', status: 'CONFIRMED', payrollStatus: 'PENDING', employeeId: 'employee-1',
  employee: { id: 'employee-1', employeeNumber: 'E-100', fullName: 'Ada Lovelace', status: 'ACTIVE' },
  menuWeekId: 'week-1', menuWeek: { id: 'week-1', weekStart }, itemCount: 2,
  unitPrice: '42.50', totalAmount: '85.00', payrollAssignments: [], isExtraordinary: false,
  reservations: [0, 1].map((day) => ({ id: `reservation-${day}`, foodOrderId: 'order-1', employeeId: 'employee-1', status: 'ACTIVE',
    menuItem: { menuDay: { menuWeekId: 'week-1', serviceDate: new Date(`2026-11-${String(9 + day).padStart(2, '0')}T00:00:00.000Z`) } } })),
});

test('acepta pedido ordinario consistente y conserva separada la semana del periodo de nómina', () => {
  const result = evaluateFoodPayrollEligibility(eligibleOrder(), '2026-11-P2');
  assert.equal(result.eligible, true);
  assert.equal(result.serviceWeekStart, weekStart);
  assert.equal(result.payrollPeriod, '2026-11-P2');
  assert.equal(result.historicalUnitPrice, '42.50');
  assert.equal(result.committedAmount, '85.00');
});

test('rechaza pedidos cancelados, UNVERIFIED y con asignación vigente', () => {
  const cancelled = eligibleOrder(); cancelled.status = 'CANCELLED';
  assert.ok(evaluateFoodPayrollEligibility(cancelled, '2026-11').reasons.includes('ORDER_CANCELLED'));
  const unverified = eligibleOrder(); unverified.payrollStatus = 'UNVERIFIED';
  assert.ok(evaluateFoodPayrollEligibility(unverified, '2026-11').reasons.includes('ORDER_UNVERIFIED'));
  const assigned = eligibleOrder(); assigned.payrollAssignments = [{ status: 'ACTIVE' }];
  assert.ok(evaluateFoodPayrollEligibility(assigned, '2026-11').reasons.includes('ACTIVE_ASSIGNMENT_EXISTS'));
});

test('usa precio histórico del pedido y rechaza cantidad o total inconsistentes', () => {
  const historical = eligibleOrder(); historical.unitPrice = { toString: () => '42.50' };
  const accepted = evaluateFoodPayrollEligibility(historical, '2026-11');
  assert.equal(accepted.historicalUnitPrice, '42.50');
  assert.equal('menuItem' in historical, false);
  const quantity = eligibleOrder(); quantity.itemCount = 3;
  assert.ok(evaluateFoodPayrollEligibility(quantity, '2026-11').reasons.includes('RESERVATION_COUNT_MISMATCH'));
  const amount = eligibleOrder(); amount.totalAmount = '84.99';
  assert.ok(evaluateFoodPayrollEligibility(amount, '2026-11').reasons.includes('TOTAL_AMOUNT_MISMATCH'));
});

test('rechaza relaciones y estados de reservas incoherentes', () => {
  const order = eligibleOrder();
  order.reservations[0].foodOrderId = 'other-order';
  order.reservations[1].employeeId = 'other-employee';
  order.reservations[0].status = 'CANCELLED';
  order.reservations[1].menuItem.menuDay.menuWeekId = 'other-week';
  const reasons = evaluateFoodPayrollEligibility(order, '2026-11').reasons;
  for (const reason of ['RESERVATION_ORDER_MISMATCH', 'RESERVATION_EMPLOYEE_MISMATCH', 'RESERVATION_NOT_ACTIVE', 'RESERVATION_WEEK_MISMATCH']) {
    assert.ok(reasons.includes(reason), `Expected ${reason}`);
  }
});

test('excluye servicios extraordinarios y periodos de nómina inválidos', () => {
  const extraordinary = eligibleOrder(); extraordinary.isExtraordinary = true;
  assert.ok(evaluateFoodPayrollEligibility(extraordinary, '2026-11').reasons.includes('EXTRAORDINARY_SERVICE'));
  assert.ok(evaluateFoodPayrollEligibility(eligibleOrder(), ' ').reasons.includes('PAYROLL_PERIOD_INVALID'));
});

test('rechaza empleado inactivo y pedido ordinario sin reservas', () => {
  const inactive = eligibleOrder(); inactive.employee.status = 'INACTIVE';
  assert.ok(evaluateFoodPayrollEligibility(inactive, '2026-11').reasons.includes('EMPLOYEE_INACTIVE'));
  const empty = eligibleOrder(); empty.reservations = [];
  const reasons = evaluateFoodPayrollEligibility(empty, '2026-11').reasons;
  assert.ok(reasons.includes('RESERVATIONS_REQUIRED'));
  assert.ok(reasons.includes('RESERVATION_COUNT_MISMATCH'));
});

test('rechaza cantidad no positiva, precios no positivos y precisión monetaria inválida', () => {
  for (const itemCount of [0, -1]) {
    const order = eligibleOrder(); order.itemCount = itemCount;
    assert.ok(evaluateFoodPayrollEligibility(order, '2026-11').reasons.includes('ITEM_COUNT_INVALID'));
  }
  for (const unitPrice of ['0', '-1', '42.501', null]) {
    const order = eligibleOrder(); order.unitPrice = unitPrice;
    assert.ok(evaluateFoodPayrollEligibility(order, '2026-11').reasons.includes('UNIT_PRICE_INVALID'));
  }
  for (const totalAmount of ['0', '-1', '85.001', null]) {
    const order = eligibleOrder(); order.totalAmount = totalAmount;
    assert.ok(evaluateFoodPayrollEligibility(order, '2026-11').reasons.includes('TOTAL_AMOUNT_INVALID'));
  }
});

test('rechaza fechas inválidas/fuera de semana y reserva de otro empleado', () => {
  const invalidDate = eligibleOrder(); invalidDate.reservations[0].menuItem.menuDay.serviceDate = new Date('invalid');
  assert.ok(evaluateFoodPayrollEligibility(invalidDate, '2026-11').reasons.includes('RESERVATION_DATE_OUTSIDE_WEEK'));
  const outside = eligibleOrder(); outside.reservations[0].menuItem.menuDay.serviceDate = new Date('2026-11-16T00:00:00Z');
  assert.ok(evaluateFoodPayrollEligibility(outside, '2026-11').reasons.includes('RESERVATION_DATE_OUTSIDE_WEEK'));
  const otherEmployee = eligibleOrder(); otherEmployee.reservations[0].employeeId = 'other';
  assert.ok(evaluateFoodPayrollEligibility(otherEmployee, '2026-11').reasons.includes('RESERVATION_EMPLOYEE_MISMATCH'));
});

test('el periodo conserva el contrato de almacenamiento sin imponer formato funcional no definido', () => {
  assert.equal(evaluateFoodPayrollEligibility(eligibleOrder(), 'periodo legado').eligible, true);
  assert.ok(evaluateFoodPayrollEligibility(eligibleOrder(), 'x'.repeat(41)).reasons.includes('PAYROLL_PERIOD_INVALID'));
});

test('capa de consulta incluye estado de asignación vigente y no escribe', async () => {
  const calls = [];
  const client = { foodOrder: { findUnique: async (args) => { calls.push(args); return eligibleOrder(); } } };
  const result = await getFoodPayrollOrderEligibility(client, 'order-1', '2026-11-P2');
  assert.equal(result.eligible, true);
  assert.deepEqual(calls[0].where, { id: 'order-1' });
  assert.deepEqual(calls[0].include.payrollAssignments.where, { status: 'ACTIVE' });
  assert.equal(calls.length, 1);
});
