/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002 Bloques B, C1 y C2 — APIs de prenómina y conciliación: cada ruta exige acceso RH de Food Services y la
// acción C-PANEL específica antes de tocar datos. ADMIN no obtiene acceso implícito aunque tenga las concesiones.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/isolated-auth.cjs');

function grant(h, entries) {
  const grants = new Set(entries);
  h.db.corporateModulePermission.findUnique = async ({ where }) => {
    const k = where.userId_moduleKey_actionKey; return { granted: grants.has(`${k.moduleKey}/${k.actionKey}`) };
  };
}
function services(h) {
  const hit = name => async () => { h.calls.services++; h.calls.writes.push(name); return name === 'createFoodPayrollBatch' ? { status: 201, replayed: false, body: { batchId: 'b1' } }
    : name === 'downloadFoodPayrollExport' ? { fileName: 'Prenomina_x.xlsx', fileSha256: 'a'.repeat(64), body: Buffer.from('xlsx') } : { ok: true }; };
  h.mocks['@/lib/food-services/payroll-batch-service'] = { previewFoodPayrollBatch: hit('previewFoodPayrollBatch'), createFoodPayrollBatch: hit('createFoodPayrollBatch') };
  h.mocks['@/lib/food-services/payroll-batch-mass'] = { previewFoodPayrollPeriod: hit('previewFoodPayrollPeriod'),
    createFoodPayrollPeriodBatch: async () => { h.calls.services++; h.calls.writes.push('createFoodPayrollPeriodBatch'); return { status: 201, replayed: false, body: { batchId: 'b2' } }; } };
  h.mocks['@/lib/food-services/payroll-batch-operations'] = Object.fromEntries(['getPayrollCapabilities', 'listFoodPayrollCandidates', 'listFoodPayrollBatches',
    'getFoodPayrollBatch', 'voidFoodPayrollBatch', 'exportFoodPayrollBatch', 'downloadFoodPayrollExport'].map(n => [n, hit(n)]));
  const file = name => async () => { h.calls.services++; h.calls.writes.push(name); return { fileName: `${name}.xlsx`, fileSha256: 'b'.repeat(64), body: Buffer.from('xlsx'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }; };
  h.mocks['@/lib/food-services/payroll-reconciliation'] = {
    ...Object.fromEntries(['getFoodPayrollReconciliation', 'previewReconciliation', 'voidReconciliation', 'closeFoodPayrollBatch', 'listFoodPayrollAdjustments',
      'resolveFoodPayrollAdjustment'].map(n => [n, hit(n)])),
    confirmReconciliation: async () => { h.calls.services++; h.calls.writes.push('confirmReconciliation'); return { status: 201, replayed: false, body: { reconciliationId: 'r1' } }; },
    downloadReconciliationTemplate: file('downloadReconciliationTemplate'), downloadReconciliationEvidence: file('downloadReconciliationEvidence'),
    exportFoodPayrollControlReport: file('exportFoodPayrollControlReport'),
  };
}
const B = 'app/api/food-services/hr/payroll';
const cases = [
  { file: `${B}/candidates/route.ts`, method: 'GET', action: 'create-payroll-batch', service: 'listFoodPayrollCandidates', status: 200 },
  { file: `${B}/preview/route.ts`, method: 'POST', action: 'create-payroll-batch', service: 'previewFoodPayrollBatch', status: 200 },
  { file: `${B}/batches/route.ts`, method: 'POST', action: 'create-payroll-batch', service: 'createFoodPayrollBatch', status: 201 },
  { file: `${B}/batches/route.ts`, method: 'GET', action: 'view-payroll-batches', service: 'listFoodPayrollBatches', status: 200 },
  { file: `${B}/period/preview/route.ts`, method: 'POST', action: 'create-payroll-batch', service: 'previewFoodPayrollPeriod', status: 200 },
  { file: `${B}/period/batches/route.ts`, method: 'POST', action: 'create-payroll-batch', service: 'createFoodPayrollPeriodBatch', status: 201 },
  { file: `${B}/batches/[id]/route.ts`, method: 'GET', action: 'view-payroll-batches', service: 'getFoodPayrollBatch', status: 200 },
  { file: `${B}/batches/[id]/void/route.ts`, method: 'POST', action: 'void-payroll-batch', service: 'voidFoodPayrollBatch', status: 200 },
  { file: `${B}/batches/[id]/export/route.ts`, method: 'POST', action: 'export-payroll-batch', service: 'exportFoodPayrollBatch', status: 200 },
  { file: `${B}/batches/[id]/export/route.ts`, method: 'GET', action: 'view-payroll-batches', service: 'downloadFoodPayrollExport', status: 200 },
  // YF-002-C2: conciliación, ajustes, cierre y reportes de control.
  { file: `${B}/batches/[id]/reconciliation/route.ts`, method: 'GET', action: 'view-payroll-reconciliations', service: 'getFoodPayrollReconciliation', status: 200 },
  { file: `${B}/batches/[id]/reconciliation/route.ts`, method: 'POST', action: 'register-payroll-reconciliation', service: 'confirmReconciliation', status: 201 },
  { file: `${B}/batches/[id]/reconciliation/preview/route.ts`, method: 'POST', action: 'register-payroll-reconciliation', service: 'previewReconciliation', status: 200 },
  { file: `${B}/batches/[id]/reconciliation/template/route.ts`, method: 'GET', action: 'register-payroll-reconciliation', service: 'downloadReconciliationTemplate', status: 200, binary: true },
  { file: `${B}/batches/[id]/reconciliation/void/route.ts`, method: 'POST', action: 'register-payroll-reconciliation', service: 'voidReconciliation', status: 200 },
  { file: `${B}/batches/[id]/reconciliation/evidence/route.ts`, method: 'GET', action: 'view-payroll-reconciliations', service: 'downloadReconciliationEvidence', status: 200, binary: true },
  { file: `${B}/batches/[id]/close/route.ts`, method: 'POST', action: 'close-payroll-batch', service: 'closeFoodPayrollBatch', status: 200 },
  { file: `${B}/batches/[id]/control-report/route.ts`, method: 'GET', action: 'export-payroll-control', service: 'exportFoodPayrollControlReport', status: 200, binary: true },
  { file: `${B}/adjustments/route.ts`, method: 'GET', action: 'view-payroll-reconciliations', service: 'listFoodPayrollAdjustments', status: 200 },
  { file: `${B}/adjustments/[id]/resolve/route.ts`, method: 'POST', action: 'manage-payroll-adjustments', service: 'resolveFoodPayrollAdjustment', status: 200 },
];
const otherActions = ['create-payroll-batch', 'view-payroll-batches', 'void-payroll-batch', 'export-payroll-batch',
  'view-payroll-reconciliations', 'register-payroll-reconciliation', 'manage-payroll-adjustments', 'close-payroll-batch', 'export-payroll-control'];
const call = (api, method) => api[method](new Request('http://localhost/x?weekFrom=2026-11-02', { method, headers: { 'Idempotency-Key': 'qa-key-12345678' },
  ...(method === 'GET' ? {} : { body: JSON.stringify({ reason: 'QA motivo' }) }) }), { params: Promise.resolve({ id: 'batch-1' }) });

for (const c of cases) {
  test(`${c.method} ${c.file.replace(B, 'payroll')}: exige ${c.action}`, async () => {
    // RH con acceso al módulo pero sin la acción específica (con todas las demás): 403 sin tocar datos.
    let h = harness({ roles: ['RH'] }); services(h);
    grant(h, ['food-services/view', 'food-services/manage', ...otherActions.filter(a => a !== c.action).map(a => `food-services/${a}`)]);
    let r = await call(h.load(c.file), c.method);
    assert.equal(r.status, 403); assert.equal(h.calls.services, 0);
    // ADMIN con todas las concesiones: 403 (sin acceso implícito a acciones sensibles de nómina).
    h = harness({ roles: ['ADMIN'] }); services(h);
    grant(h, ['food-services/view', 'food-services/manage', ...otherActions.map(a => `food-services/${a}`)]);
    r = await call(h.load(c.file), c.method);
    assert.equal(r.status, 403); assert.equal(h.calls.services, 0);
    // RH autorizado: llega exactamente al servicio esperado.
    h = harness({ roles: ['RH'] }); services(h);
    grant(h, ['food-services/view', 'food-services/manage', `food-services/${c.action}`]);
    r = await call(h.load(c.file), c.method);
    assert.equal(r.status, c.status); assert.deepEqual(h.calls.writes, [c.service]);
    if (c.service === 'downloadFoodPayrollExport') {
      assert.equal(r.headers.get('X-File-SHA256'), 'a'.repeat(64));
      assert.match(r.headers.get('Content-Disposition'), /Prenomina_x\.xlsx/);
    }
    if (c.binary) {
      assert.equal(r.headers.get('X-File-SHA256'), 'b'.repeat(64));
      assert.match(r.headers.get('Content-Disposition'), new RegExp(`${c.service}\\.xlsx`));
    }
  });
}

test('CHEF con todas las concesiones: no consulta, concilia, ajusta, cierra ni exporta control (403 sin tocar datos)', async () => {
  for (const c of cases.filter(x => x.file.includes('/reconciliation') || x.file.includes('/close') || x.file.includes('/control-report') || x.file.includes('/adjustments'))) {
    const h = harness({ roles: ['CHEF'] }); services(h);
    grant(h, ['food-services/view', 'food-services/manage', ...otherActions.map(a => `food-services/${a}`)]);
    const r = await call(h.load(c.file), c.method);
    assert.equal(r.status, 403, c.file); assert.equal(h.calls.services, 0);
  }
});

test('capabilities: requiere acceso RH de Food Services', async () => {
  let h = harness({ roles: ['RH'] }); services(h); grant(h, []);
  assert.equal((await h.load(`${B}/capabilities/route.ts`).GET()).status, 403); assert.equal(h.calls.services, 0);
  h = harness({ roles: ['RH'] }); services(h); grant(h, ['food-services/view', 'food-services/manage']);
  assert.equal((await h.load(`${B}/capabilities/route.ts`).GET()).status, 200); assert.deepEqual(h.calls.writes, ['getPayrollCapabilities']);
});

test('catálogo C-PANEL: acciones de prenómina exclusivas de Food Services y RH', () => {
  const h = harness();
  const catalog = h.load('lib/cpanel/permission-catalog.ts');
  for (const a of otherActions) { assert.ok(catalog.cpanelActions.includes(a)); assert.equal(catalog.isFoodRhOnlyAction(a), true); }
  assert.equal(catalog.isFoodRhOnlyAction('view'), false);
});
