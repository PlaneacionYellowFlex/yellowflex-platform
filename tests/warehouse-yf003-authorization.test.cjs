/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 · Warehouse: autorización explícita sin atajos por rol, separación de funciones en la interfaz de páginas,
// idempotencia obligatoria y administración trazable de permisos (sin autoasignación). Arnés aislado: sin base de datos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/isolated-auth.cjs');

function setup(roles, grants = [], legacy = null) {
  const h = harness({ roles });
  const g = new Set(grants);
  h.db.corporateModulePermission.findUnique = async ({ where }) => {
    const k = where.userId_moduleKey_actionKey; return { granted: g.has(`${k.moduleKey}/${k.actionKey}`) };
  };
  let legacyRow = legacy;
  h.db.warehousePermission = { findUnique: async () => legacyRow };
  h.db.purchasePermission = { findUnique: async () => null };
  return { h, grants: g, setLegacy: v => { legacyRow = v; } };
}
const FULL_LEGACY = { canViewInventory: true, canRegisterMovement: true, canManageWarehouse: true, canApproveWarehouseAdjustments: true };
const ALL = ['warehouse/view', 'warehouse/operate', 'warehouse/approve'];
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const req = (method, body = {}, headers = {}) => new Request('http://localhost/x', { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
const ctx = { params: Promise.resolve({ id: 'target', custodyId: 'target', countId: 'target', itemId: 'target' }) };

test('capacidades: ADMIN solo consulta; DIRECCIÓN no obtiene nada por rol; cuenta inactiva no obtiene nada', async () => {
  const admin = setup(['ADMIN']);
  const caps = await admin.h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor');
  assert.deepEqual(caps, { view: true, operate: false, investigate: false, approve: false, audit: true, production: false, productionView: true, catalog: false });
  const dir = setup(['DIRECCION']);
  assert.ok(Object.values(await dir.h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor')).every(v => v === false));
  const inactive = setup(['ALMACEN'], ALL, FULL_LEGACY);
  inactive.h.user.active = false;
  assert.ok(Object.values(await inactive.h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor')).every(v => v === false));
});

test('V2 capacidad de catálogo: exige C-PANEL manage-catalog explícito y la bandera canManageCatalog; ningún rol la otorga', async () => {
  const full = setup(['EMPLEADO'], ['warehouse/view', 'warehouse/manage-catalog'], { canViewInventory: true, canManageCatalog: true });
  assert.equal((await full.h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor')).catalog, true);
  const noFlag = setup(['EMPLEADO'], ['warehouse/view', 'warehouse/manage-catalog'], { canViewInventory: true });
  assert.equal((await noFlag.h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor')).catalog, false);
  const noGrant = setup(['EMPLEADO'], ['warehouse/view'], { canViewInventory: true, canManageCatalog: true });
  assert.equal((await noGrant.h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor')).catalog, false);
  const noView = setup(['EMPLEADO'], ['warehouse/manage-catalog'], { canManageCatalog: true });
  assert.equal((await noView.h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor')).catalog, false);
  for (const role of ['ADMIN', 'DIRECCION', 'RH', 'ALMACEN']) {
    assert.equal((await setup([role]).h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor')).catalog, false, role);
  }
});

test('capacidades: cada una exige C-PANEL y permiso operativo; revocar cualquiera retira el acceso de inmediato', async () => {
  const { h, grants, setLegacy } = setup(['EMPLEADO'], ALL, FULL_LEGACY);
  const cap = () => h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor');
  assert.deepEqual(await cap(), { view: true, operate: true, investigate: true, approve: true, audit: false, production: false, productionView: false, catalog: false });
  grants.delete('warehouse/approve');
  assert.equal((await cap()).approve, false);
  grants.add('warehouse/approve'); setLegacy({ ...FULL_LEGACY, canApproveWarehouseAdjustments: false });
  assert.equal((await cap()).approve, false);
  setLegacy(FULL_LEGACY); grants.delete('warehouse/view');
  assert.ok(Object.values(await cap()).every(v => v === false), 'sin Ver no hay ninguna capacidad');
  grants.add('warehouse/view'); grants.delete('warehouse/operate');
  const c = await cap();
  assert.equal(c.operate, false); assert.equal(c.investigate, false); assert.equal(c.view, true);
});

test('capacidades de Producción: rol PRODUCCION o DIRECCION más concesión explícita; ADMIN no opera', async () => {
  for (const role of ['PRODUCCION', 'DIRECCION']) {
    const { h } = setup([role], ['warehouse/view', 'warehouse/operate']);
    const c = await h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor', undefined, [role]);
    assert.equal(c.production, true); assert.equal(c.productionView, true); assert.equal(c.operate, false);
  }
  const { h } = setup(['ADMIN'], ['warehouse/view', 'warehouse/operate']);
  assert.equal((await h.load('lib/warehouse/capabilities.ts').getWarehouseCapabilities('actor')).production, false);
});

const writeRoutes = [
  ['app/api/warehouse/movements/route.ts', 'POST'], ['app/api/warehouse/movements/transfers/route.ts', 'POST'],
  ['app/api/warehouse/movements/handoffs/route.ts', 'POST'], ['app/api/warehouse/counts/route.ts', 'POST'],
  ['app/api/warehouse/counts/[countId]/complete/route.ts', 'POST'], ['app/api/warehouse/returns/[custodyId]/receive/route.ts', 'POST'],
  ['app/api/warehouse/discrepancies/[id]/route.ts', 'PATCH'], ['app/api/warehouse/discrepancies/[id]/recounts/route.ts', 'POST'],
  ['app/api/warehouse/recounts/[id]/complete/route.ts', 'POST'], ['app/api/warehouse/discrepancies/[id]/approve/route.ts', 'POST'],
  ['app/api/warehouse/custodies/[custodyId]/consume/route.ts', 'POST'], ['app/api/warehouse/custodies/[custodyId]/receive/route.ts', 'POST'],
  ['app/api/warehouse/custodies/[custodyId]/return/route.ts', 'POST'],
];
for (const roles of [['ADMIN'], ['DIRECCION'], ['ADMIN', 'DIRECCION']]) {
  test(`sin atajos por rol: ${roles.join('+')} sin concesiones no escribe en ninguna API de Warehouse`, async () => {
    for (const [file, method] of writeRoutes) {
      const { h } = setup(roles);
      const r = await h.load(file)[method](req(method, { quantity: 1 }, { 'Idempotency-Key': UUID }), ctx);
      assert.equal(r.status, 403, `${method} ${file}`);
      assert.equal(h.calls.services, 0); assert.deepEqual(h.calls.writes, []);
    }
  });
}

test('aprobar ajustes exige C-PANEL Aprobar y permiso operativo de aprobación; operar no basta', async () => {
  const approve = 'app/api/warehouse/discrepancies/[id]/approve/route.ts';
  const op = setup(['ADMIN'], ['warehouse/view', 'warehouse/operate'], { ...FULL_LEGACY, canApproveWarehouseAdjustments: false });
  assert.equal((await op.h.load(approve).POST(req('POST'), ctx)).status, 403);
  assert.equal(op.h.calls.services, 0);
  const ok = setup(['EMPLEADO'], ALL, FULL_LEGACY);
  ok.h.mocks['@/repositories/warehouse-discrepancies.repository'] = { approveDiscrepancyAdjustmentOnce: async () => { ok.h.calls.services++; return { response: { movement: { id: 'target', movementFolio: 'AJ-1' } }, replayed: false }; } };
  assert.equal((await ok.h.load(approve).POST(req('POST', {}, { 'Idempotency-Key': UUID }), ctx)).status, 201);
  assert.equal(ok.h.calls.services, 1);
});

test('toda operación que cambia inventario o expedientes exige Idempotency-Key antes de leer datos', async () => {
  const FULL = ['warehouse/view', 'warehouse/operate', 'warehouse/approve'];
  const routes = [
    ['app/api/warehouse/movements/route.ts', 'POST', ['EMPLEADO']], ['app/api/warehouse/movements/handoffs/route.ts', 'POST', ['EMPLEADO']],
    ['app/api/warehouse/movements/issues/route.ts', 'POST', ['EMPLEADO']], ['app/api/warehouse/movements/[movementId]/reverse/route.ts', 'POST', ['EMPLEADO']],
    ['app/api/warehouse/counts/route.ts', 'POST', ['EMPLEADO']], ['app/api/warehouse/counts/[countId]/complete/route.ts', 'POST', ['EMPLEADO']],
    ['app/api/warehouse/discrepancies/[id]/route.ts', 'PATCH', ['EMPLEADO']], ['app/api/warehouse/discrepancies/[id]/recounts/route.ts', 'POST', ['EMPLEADO']],
    ['app/api/warehouse/recounts/[id]/complete/route.ts', 'POST', ['EMPLEADO']], ['app/api/warehouse/discrepancies/[id]/approve/route.ts', 'POST', ['EMPLEADO']],
    ['app/api/warehouse/discrepancies/[id]/reject/route.ts', 'POST', ['EMPLEADO']], ['app/api/warehouse/returns/[custodyId]/receive/route.ts', 'POST', ['EMPLEADO']],
    ['app/api/warehouse/custodies/[custodyId]/receive/route.ts', 'POST', ['PRODUCCION']], ['app/api/warehouse/custodies/[custodyId]/return/route.ts', 'POST', ['PRODUCCION']],
  ];
  for (const [file, method, roles] of routes) {
    const { h } = setup(roles, FULL, FULL_LEGACY);
    const r = await h.load(file)[method](req(method, { itemId: 'i', quantity: 1 }), ctx);
    assert.equal(r.status, 400, file);
    assert.equal((await r.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal(h.calls.services, 0);
  }
});

test('páginas de Warehouse aplican la misma política que las APIs (ADMIN no entra a formularios de operación)', async () => {
  const admin = setup(['ADMIN']);
  const policy = admin.h.load('lib/cpanel/module-access.ts');
  const user = { id: 'actor', roles: ['ADMIN'] };
  assert.equal(await policy.hasModulePageAccess(user, 'warehouse'), true);
  assert.equal(await policy.hasModulePageAccess(user, 'warehouse', 'operate', 'movement'), false);
  assert.equal(await policy.hasModulePageAccess(user, 'warehouse', 'operate', 'production'), false);
  assert.equal(await policy.hasModulePageAccess(user, 'warehouse', 'view', 'production'), true);
  const op = setup(['EMPLEADO'], ALL, FULL_LEGACY);
  assert.equal(await op.h.load('lib/cpanel/module-access.ts').hasModulePageAccess({ id: 'actor', roles: ['EMPLEADO'] }, 'warehouse', 'operate', 'movement'), true);
});

test('nadie modifica sus propios permisos C-PANEL de ningún módulo, ni siendo ADMIN', async () => {
  const { h } = setup(['ADMIN']);
  const api = h.load('app/api/admin/cpanel/permissions/route.ts');
  for (const moduleKey of ['warehouse', 'purchases', 'food-services', 'c-panel']) {
    for (const actionKey of ['view', 'approve']) {
      const r = await api.PATCH(req('PATCH', { userId: 'actor', moduleKey, actionKey, granted: true, reason: 'Autoasignación de prueba' }));
      assert.equal(r.status, 403, `${moduleKey}/${actionKey}`);
    }
  }
  assert.deepEqual(h.calls.writes, []);
});

test('permisos operativos de Almacén: sensibles solo ADMIN, ordinarios también RH delegado; nunca sobre sí mismo, auditados y sin escritura si no cambian', async () => {
  const route = 'app/api/admin/cpanel/warehouse-permissions/route.ts';
  const rh = setup(['RH'], ['c-panel/manage']);
  const rhr = await rh.h.load(route).PATCH(req('PATCH', { userId: 'target', flag: 'canApproveWarehouseAdjustments', granted: true, reason: 'Delegado RH' }));
  assert.equal(rhr.status, 403); assert.deepEqual(rh.h.calls.writes, []);
  // YF-003 Enterprise: RH con delegación expresa administra permisos ORDINARIOS de cuentas no protegidas, con auditoría.
  const rhOriginal = rh.h.db.user.findUnique;
  let targetRoles = [{ role: 'EMPLEADO' }];
  rh.h.db.user.findUnique = async q => q.where.id === 'target' ? { id: 'target', active: true, roles: targetRoles } : rhOriginal(q);
  rh.h.db.$queryRaw = async () => [];
  rh.h.db.warehousePermission.upsert = async ({ create }) => { rh.h.calls.writes.push({ upsert: create }); return create; };
  rh.h.db.corporatePermissionAudit = { create: async ({ data }) => { rh.h.calls.writes.push({ audit: data }); } };
  rh.setLegacy(null);
  const rhOk = await rh.h.load(route).PATCH(req('PATCH', { userId: 'target', flag: 'canRegisterMovement', granted: true, reason: 'Alta operativa' }));
  assert.equal(rhOk.status, 200);
  assert.equal(rh.h.calls.writes.find(w => w.audit)?.audit.actionKey, 'operativo:canRegisterMovement');
  rh.h.calls.writes.length = 0; targetRoles = [{ role: 'DIRECCION' }];
  const rhProtected = await rh.h.load(route).PATCH(req('PATCH', { userId: 'target', flag: 'canViewInventory', granted: true, reason: 'Cuenta protegida' }));
  assert.equal(rhProtected.status, 403); assert.deepEqual(rh.h.calls.writes, []);
  const rhSelf = await rh.h.load(route).PATCH(req('PATCH', { userId: 'actor', flag: 'canViewInventory', granted: true, reason: 'Autoasignación RH' }));
  assert.equal(rhSelf.status, 403);

  const { h, setLegacy } = setup(['ADMIN']);
  let targetActive = true;
  const original = h.db.user.findUnique;
  h.db.user.findUnique = async q => q.where.id === 'target' ? { id: 'target', active: targetActive } : original(q);
  h.db.$queryRaw = async () => [];
  h.db.warehousePermission.upsert = async ({ create, update }) => { h.calls.writes.push({ upsert: create, update }); return create; };
  h.db.corporatePermissionAudit = { create: async ({ data }) => { h.calls.writes.push({ audit: data }); } };
  const api = h.load(route);
  const self = await api.PATCH(req('PATCH', { userId: 'actor', flag: 'canApproveWarehouseAdjustments', granted: true, reason: 'Autoasignación' }));
  assert.equal(self.status, 403); assert.deepEqual(h.calls.writes, []);

  setLegacy(null);
  const ok = await api.PATCH(req('PATCH', { userId: 'target', flag: 'canApproveWarehouseAdjustments', granted: true, reason: 'Autorización de Dirección' }));
  assert.equal(ok.status, 200);
  const audit = h.calls.writes.find(w => w.audit)?.audit;
  assert.deepEqual({ actorId: audit.actorId, targetId: audit.targetId, moduleKey: audit.moduleKey, actionKey: audit.actionKey, oldGranted: audit.oldGranted, newGranted: audit.newGranted, reason: audit.reason },
    { actorId: 'actor', targetId: 'target', moduleKey: 'warehouse', actionKey: 'operativo:canApproveWarehouseAdjustments', oldGranted: null, newGranted: true, reason: 'Autorización de Dirección' });

  h.calls.writes.length = 0; setLegacy({ ...FULL_LEGACY });
  const same = await api.PATCH(req('PATCH', { userId: 'target', flag: 'canApproveWarehouseAdjustments', granted: true, reason: 'Sin cambio real' }));
  assert.equal(same.status, 200); assert.deepEqual(h.calls.writes, []);

  targetActive = false; setLegacy(null);
  const inactive = await api.PATCH(req('PATCH', { userId: 'target', flag: 'canViewInventory', granted: true, reason: 'Cuenta inactiva' }));
  assert.equal(inactive.status, 422); assert.deepEqual(h.calls.writes, []);

  const bad = await api.PATCH(req('PATCH', { userId: 'target', flag: 'canDeleteEverything', granted: true, reason: 'Permiso inexistente' }));
  assert.equal(bad.status, 422);
});
