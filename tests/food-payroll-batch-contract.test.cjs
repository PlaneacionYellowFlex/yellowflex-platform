/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002 Bloque A — contrato puro: huellas, token firmado, idempotencia, importes y referencia libre.
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/food-services/payroll-batch-contract.ts');

const SECRET = 'unit-test-secret-0123456789abcdef0123456789';
const order = () => ({
  id: 'o1', status: 'CONFIRMED', payrollStatus: 'PENDING', employeeId: 'e1', menuWeekId: 'w1', itemCount: 2,
  unitPrice: '35.50', totalAmount: '71.00', confirmedAt: new Date('2026-11-10T12:00:00Z'), createdAt: new Date('2026-11-10T12:00:00Z'),
  employee: { id: 'e1', employeeNumber: 'E-1', fullName: 'Ada', status: 'ACTIVE', departmentId: 'd1', workShiftId: 's1' },
  menuWeek: { id: 'w1', weekStart: new Date('2026-11-09T00:00:00Z') },
  reservations: [{ id: 'r2', status: 'ACTIVE', foodOrderId: 'o1', employeeId: 'e1', menuItemId: 'm2' }, { id: 'r1', status: 'ACTIVE', foodOrderId: 'o1', employeeId: 'e1', menuItemId: 'm1' }],
  payrollAssignments: [],
});

test('importes exactos en centavos', () => {
  assert.equal(c.toCents('35.5'), 3550); assert.equal(c.toCents('0.07'), 7); assert.equal(c.toCents(12), 1200);
  assert.equal(c.toCents('1.005'), null); assert.equal(c.toCents('-1'), null); assert.equal(c.toCents('abc'), null);
  assert.equal(c.centsToDecimal(21575), '215.75'); assert.equal(c.centsToDecimal(5), '0.05');
  assert.equal(c.toCents({ toString: () => '18.00' }), 1800, 'acepta Prisma.Decimal');
});

test('JSON canónico independiente del orden de claves', () => {
  assert.equal(c.canonicalJson({ b: 1, a: [2, { d: 1, c: 0 }] }), c.canonicalJson({ a: [2, { c: 0, d: 1 }], b: 1 }));
});

test('huella del pedido: estable ante el orden de reservas y sensible a cada dato del cargo', () => {
  const base = c.orderFingerprint(order());
  const reordered = order(); reordered.reservations.reverse();
  assert.equal(c.orderFingerprint(reordered), base);
  const variants = [
    o => { o.unitPrice = '35.51'; }, o => { o.totalAmount = '71.01'; }, o => { o.itemCount = 3; }, o => { o.status = 'CANCELLED'; },
    o => { o.payrollStatus = 'EXPORTED'; }, o => { o.employee.status = 'INACTIVE'; }, o => { o.employee.fullName = 'Otra'; },
    o => { o.menuWeek.weekStart = new Date('2026-11-16T00:00:00Z'); }, o => { o.reservations[0].status = 'CANCELLED'; },
    o => { o.payrollAssignments = [{ status: 'ACTIVE' }]; }, o => { o.employee.departmentId = 'd2'; },
  ];
  for (const change of variants) { const o = order(); change(o); assert.notEqual(c.orderFingerprint(o), base); }
  assert.match(base, /^[0-9a-f]{64}$/);
});

test('selección explícita: ordena y rechaza duplicados', () => {
  assert.deepEqual(c.normalizeOrderIds(['b', 'a', 'c']), ['a', 'b', 'c']);
  assert.throws(() => c.normalizeOrderIds(['a', 'b', 'a']), err => err.code === 'DUPLICATE_ORDER');
  assert.throws(() => c.previewRequestSchema.parse({ payrollReference: 'X', orderIds: [] }));
  assert.throws(() => c.previewRequestSchema.parse({ payrollReference: 'X', orderIds: ['a'], extra: 1 }), 'contrato estricto');
});

test('referencia de prenómina libre: cualquier formato de 1 a 40 caracteres, sin calendario', () => {
  for (const ref of ['2026-11-P2', 'Quincena 2 nov', 'NOM/45', 'A', 'x'.repeat(40)]) assert.equal(c.payrollReferenceSchema.parse(ref), ref);
  assert.equal(c.payrollReferenceSchema.parse('  Nómina extra  '), 'Nómina extra');
  assert.throws(() => c.payrollReferenceSchema.parse('   ')); assert.throws(() => c.payrollReferenceSchema.parse('x'.repeat(41)));
});

test('token de vista previa firmado: alteración, expiración y secreto obligatorio', () => {
  const payload = { v: c.FOOD_PAYROLL_CONTRACT_VERSION, a: 'u1', r: 'REF', iat: Date.now(), exp: Date.now() + 60000, d: 'f'.repeat(64), e: [['o1', 'a'.repeat(32), 'E']] };
  const token = c.signPreviewToken(payload, SECRET);
  const v = c.verifyPreviewToken(token, SECRET);
  assert.equal(v.expired, false); assert.deepEqual(v.e, payload.e); assert.equal(v.a, 'u1');
  const [body, mac] = token.split('.');
  const forged = Buffer.from(Buffer.from(body, 'base64url').toString().replace('"u1"', '"u2"')).toString('base64url');
  assert.throws(() => c.verifyPreviewToken(`${forged}.${mac}`, SECRET), err => err.code === 'PREVIEW_INVALID');
  assert.throws(() => c.verifyPreviewToken(token, SECRET + 'x'), err => err.code === 'PREVIEW_INVALID');
  assert.throws(() => c.verifyPreviewToken('abc', SECRET), err => err.code === 'PREVIEW_INVALID');
  assert.equal(c.verifyPreviewToken(c.signPreviewToken({ ...payload, exp: Date.now() - 1 }, SECRET), SECRET).expired, true, 'expirado pero con firma válida');
  assert.throws(() => c.signPreviewToken(payload, 'corto'), err => err.code === 'PREVIEW_SECRET_MISSING');
});

test('huella de idempotencia: actor, versión, selección ordenada, revisados, referencia y digest', () => {
  const base = { actorId: 'u1', payrollReference: 'REF', orderIds: ['b', 'a'], reviewedInactiveOrderIds: [], selectionDigest: 'd'.repeat(64) };
  const h = c.idempotencyRequestHash(base);
  assert.equal(c.idempotencyRequestHash({ ...base, orderIds: ['a', 'b'] }), h, 'el orden de la selección no altera la huella');
  for (const change of [{ actorId: 'u2' }, { payrollReference: 'REF2' }, { orderIds: ['a'] }, { reviewedInactiveOrderIds: ['a'] }, { selectionDigest: 'e'.repeat(64) }]) {
    assert.notEqual(c.idempotencyRequestHash({ ...base, ...change }), h);
  }
  assert.equal(c.selectionDigest([['b', '2'], ['a', '1']]), c.selectionDigest([['a', '1'], ['b', '2']]));
  assert.ok(c.idempotencyKeySchema.parse('7d1c3a8e-0f4b-4a9e-9b8f-2f6b1c0a9e11'));
  assert.throws(() => c.idempotencyKeySchema.parse('corta')); assert.throws(() => c.idempotencyKeySchema.parse('con espacios dentro'));
});
