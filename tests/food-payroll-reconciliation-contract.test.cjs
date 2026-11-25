/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002-C2 — contrato puro de conciliación: importes estrictos, lectura del Excel, comparación, token y resoluciones.
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const c = require('../lib/food-services/payroll-reconciliation-contract.ts');

const SECRET = 'unit-test-secret-0123456789abcdef0123456789';
const batch = { id: 'batch-1', payrollReference: 'Q23-NOV' };
const expected = [
  { employeeId: 'e1', employeeNumber: '00123', employeeName: 'Ada', orderCount: 2, expectedCents: 15050 },
  { employeeId: 'e2', employeeNumber: 'B-7', employeeName: 'Beto', orderCount: 1, expectedCents: 4225 },
  { employeeId: 'e3', employeeNumber: 'C-9', employeeName: 'Ceci', orderCount: 1, expectedCents: 6200 },
];
const row = (n, applied, extra = {}) => ({ row: n, reference: batch.payrollReference, batchId: batch.id, employeeNumber: '', name: '',
  expected: { kind: 'missing' }, applied: c.parseAmountCell(applied), note: '', ...extra });

test('importes: cero explícito, vacío como faltante y formatos inválidos', () => {
  assert.deepEqual(c.parseAmountCell(0), { kind: 'ok', cents: 0 });
  assert.deepEqual(c.parseAmountCell('0'), { kind: 'ok', cents: 0 });
  assert.deepEqual(c.parseAmountCell(null), { kind: 'missing' });
  assert.deepEqual(c.parseAmountCell('   '), { kind: 'missing' });
  assert.deepEqual(c.parseAmountCell(150.5), { kind: 'ok', cents: 15050 });
  assert.deepEqual(c.parseAmountCell(0.1 + 0.2), { kind: 'ok', cents: 30 });
  assert.deepEqual(c.parseAmountCell('$1,234.50'), { kind: 'ok', cents: 123450 });
  for (const bad of [-1, '-1', '12.345', 12.345, 'abc', '1,2', '1.2.3', Number.NaN, Infinity, new Date(), 1e12]) {
    assert.equal(c.parseAmountCell(bad).kind, 'invalid', String(bad));
  }
});

test('comparación: completo, parcial, cero, superior y totales exactos en centavos', () => {
  const r = c.compareReconciliation(batch, expected, [
    row(2, '150.50', { employeeNumber: '00123' }), row(3, 0, { employeeNumber: 'B-7' }), row(4, 70, { employeeNumber: 'C-9' }),
  ]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map(x => [x.employeeNumber, x.result, x.differenceCents]), [['00123', 'COMPLETE', 0], ['B-7', 'NOT_APPLIED', -4225], ['C-9', 'OVER_APPLIED', 800]]);
  assert.equal(r.totals.expectedCents, 25475); assert.equal(r.totals.appliedCents, 22050); assert.equal(r.totals.coveredCents, 21250);
  assert.equal(r.totals.pendingRecoveryCents, 4225); assert.equal(r.totals.pendingRefundCents, 800);
  const p = c.compareReconciliation(batch, expected, [row(2, 100, { employeeNumber: '00123' }), row(3, 42.25, { employeeNumber: 'B-7' }), row(4, 62, { employeeNumber: 'C-9' })]);
  assert.equal(p.rows[0].result, 'PARTIAL'); assert.equal(p.totals.partial, 1);
});

test('comparación: faltantes, desconocidos, duplicados, referencia, lote, esperado y ceros a la izquierda', () => {
  const r = c.compareReconciliation(batch, expected, [
    row(2, 150.5, { employeeNumber: '123' }),                           // ceros a la izquierda: advertencia, coincide
    row(3, 10, { employeeNumber: 'X-1' }),                              // desconocido
    row(4, 10, { employeeNumber: '00123' }),                            // duplicado
    row(5, 10, { employeeNumber: 'B-7', reference: 'OTRA' }),           // referencia ajena
    row(6, '', { employeeNumber: 'C-9', batchId: 'otro', expected: { kind: 'ok', cents: 1 } }), // lote, esperado y vacío
    row(7, 5, {}),                                                      // sin número
  ]);
  const codes = r.errors.map(e => e.code).sort();
  assert.deepEqual(codes, ['AMOUNT_MISSING', 'BATCH_MISMATCH', 'DUPLICATE_EMPLOYEE', 'EMPLOYEE_NUMBER_MISSING', 'EXPECTED_MISMATCH', 'REFERENCE_MISMATCH', 'UNKNOWN_EMPLOYEE']);
  assert.deepEqual(r.warnings.map(w => w.code), ['MATCHED_IGNORING_ZEROS']);
  assert.equal(r.missing.length, 0);
  const m = c.compareReconciliation(batch, expected, [row(2, 150.5, { employeeNumber: '00123' })]);
  assert.deepEqual(m.missing.map(x => x.employeeNumber), ['B-7', 'C-9']);
  assert.equal(m.errors.filter(e => e.code === 'EMPLOYEE_MISSING').length, 2);
});

test('digest estable y sensible a cualquier cambio de importe', () => {
  const a = c.compareReconciliation(batch, expected, [row(2, 150.5, { employeeNumber: '00123' }), row(3, 0, { employeeNumber: 'B-7' }), row(4, 62, { employeeNumber: 'C-9' })]);
  const b = c.compareReconciliation(batch, expected, [row(4, 62, { employeeNumber: 'C-9' }), row(2, 150.5, { employeeNumber: '00123' }), row(3, 0, { employeeNumber: 'B-7' })].map((x, i) => ({ ...x, row: [4, 2, 3][i] })));
  assert.equal(a.digest, b.digest);
  const d = c.compareReconciliation(batch, expected, [row(2, 150.49, { employeeNumber: '00123' }), row(3, 0, { employeeNumber: 'B-7' }), row(4, 62, { employeeNumber: 'C-9' })]);
  assert.notEqual(a.digest, d.digest);
});

test('plantilla y lectura: ida y vuelta, columnas por nombre, estructura inválida', async () => {
  const tpl = await c.buildReconciliationTemplate(batch, expected, { generatedAt: new Date('2026-11-24T12:00:00Z'), generatedBy: 'RH QA' });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(tpl);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Conciliación', 'Instrucciones', 'Control']);
  const ws = wb.getWorksheet('Conciliación');
  assert.equal(ws.getRow(2).getCell(3).value, '00123'); // texto: conserva ceros a la izquierda
  const parsedEmpty = await c.parseReconciliationWorkbook(tpl);
  assert.equal(parsedEmpty.length, 3); assert.ok(parsedEmpty.every(p => p.applied.kind === 'missing'));
  ws.getRow(2).getCell(7).value = 150.5; ws.getRow(3).getCell(7).value = 0; ws.getRow(4).getCell(7).value = { formula: 'F4', result: 62 };
  ws.getRow(3).getCell(8).value = 'Sin descuento en Q23';
  const filled = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await c.parseReconciliationWorkbook(filled);
  const r = c.compareReconciliation(batch, expected, parsed);
  assert.deepEqual(r.errors, []); assert.equal(r.totals.complete, 2); assert.equal(r.totals.notApplied, 1);
  assert.equal(r.rows.find(x => x.employeeNumber === 'B-7').note, 'Sin descuento en Q23');
  // Columnas reordenadas: se identifican por encabezado.
  const wb2 = new ExcelJS.Workbook(); const s2 = wb2.addWorksheet('Conciliacion');
  s2.addRow(['Importe aplicado por Nómina', 'No. colaborador', 'Referencia de prenómina']);
  s2.addRow([150.5, '00123', 'Q23-NOV']);
  const p2 = await c.parseReconciliationWorkbook(Buffer.from(await wb2.xlsx.writeBuffer()));
  assert.equal(p2[0].employeeNumber, '00123'); assert.deepEqual(p2[0].applied, { kind: 'ok', cents: 15050 });
  const wb3 = new ExcelJS.Workbook(); wb3.addWorksheet('Conciliación').addRow(['No. colaborador', 'Importe esperado']);
  await assert.rejects(c.parseReconciliationWorkbook(Buffer.from(await wb3.xlsx.writeBuffer())), e => e.code === 'STRUCTURE_INVALID');
  await assert.rejects(c.parseReconciliationWorkbook(Buffer.from('a,b,c')), e => e.code === 'FILE_FORMAT');
  await assert.rejects(c.parseReconciliationWorkbook(Buffer.alloc(c.RECONCILIATION_MAX_FILE_BYTES + 1, 0x50)), e => e.code === 'FILE_TOO_LARGE');
});

test('token: firma, alteración, dominio separado, expiración y huellas', () => {
  const now = Date.now();
  const payload = { k: 'RC', v: 1, a: 'u1', b: 'batch-1', f: 'a'.repeat(64), d: 'b'.repeat(64), s: 'c'.repeat(64), iat: now, exp: now + 60000 };
  const t = c.signReconciliationToken(payload, SECRET);
  assert.equal(c.verifyReconciliationToken(t, SECRET).expired, false);
  assert.throws(() => c.verifyReconciliationToken(`${t}x`, SECRET), e => e.code === 'PREVIEW_INVALID');
  assert.throws(() => c.verifyReconciliationToken(t, `${SECRET}-otro`), e => e.code === 'PREVIEW_INVALID');
  assert.equal(c.verifyReconciliationToken(c.signReconciliationToken({ ...payload, exp: now - 1 }, SECRET), SECRET).expired, true);
  assert.throws(() => c.signReconciliationToken(payload, 'corto'), e => e.code === 'PREVIEW_SECRET_MISSING');
  // Un token de prenómina (otro dominio de firma) no sirve como token de conciliación.
  const p = require('../lib/food-services/payroll-batch-contract.ts');
  const other = p.signPreviewToken({ v: 1, a: 'u1', r: 'Q', iat: now, exp: now + 1000, d: 'x', e: [] }, SECRET);
  assert.throws(() => c.verifyReconciliationToken(other, SECRET), e => e.code === 'PREVIEW_INVALID');
  const h1 = c.reconciliationRequestHash({ actorId: 'u1', batchId: 'b', fileSha256: 'f', digest: 'd', externalReference: null });
  assert.notEqual(h1, c.reconciliationRequestHash({ actorId: 'u2', batchId: 'b', fileSha256: 'f', digest: 'd', externalReference: null }));
  assert.notEqual(h1, c.reconciliationRequestHash({ actorId: 'u1', batchId: 'b', fileSha256: 'g', digest: 'd', externalReference: null }));
  const s1 = c.reconciliationStateTag({ id: 'b', status: 'EXPORTED' }, []);
  assert.notEqual(s1, c.reconciliationStateTag({ id: 'b', status: 'EXPORTED' }, [{ id: 'r1', voidedAt: new Date() }]));
});

test('resoluciones: tipos por ajuste, importes, condonación y corrección completas, referencia obligatoria', () => {
  assert.equal(c.validateResolution('PARTIAL', 1050, 'RECOVERED', 600, 'Q24'), 450);
  assert.equal(c.validateResolution('NOT_APPLIED', 4225, 'WAIVED', 4225, undefined), 0);
  assert.equal(c.validateResolution('OVER_APPLIED', -800, 'REFUNDED', 800, 'TRF'), 0);
  assert.equal(c.validateResolution('OVER_APPLIED', -800, 'CORRECTED', 800, 'EVID'), 0);
  const bad = fn => assert.throws(fn, e => e.code === 'RESOLUTION_INVALID');
  bad(() => c.validateResolution('PARTIAL', 1050, 'REFUNDED', 100, 'X1'));
  bad(() => c.validateResolution('OVER_APPLIED', -800, 'RECOVERED', 100, 'X1'));
  bad(() => c.validateResolution('PARTIAL', 1050, 'RECOVERED', 1051, 'Q24'));
  bad(() => c.validateResolution('PARTIAL', 1050, 'RECOVERED', 0, 'Q24'));
  bad(() => c.validateResolution('PARTIAL', 1050, 'WAIVED', 100, undefined));
  bad(() => c.validateResolution('PARTIAL', 1050, 'CORRECTED', 100, 'EV1'));
  bad(() => c.validateResolution('PARTIAL', 1050, 'RECOVERED', 100, undefined));
  bad(() => c.validateResolution('PARTIAL', 1050, 'RECOVERED', 100, ' x '));
});
