const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./helpers/isolated-auth.cjs');

function permissions(h, entries = [], legacy = {}) {
  const grants = new Set(entries);
  h.db.corporateModulePermission.findUnique = async ({ where }) => {
    const key = where.userId_moduleKey_actionKey;
    return { granted: grants.has(`${key.moduleKey}/${key.actionKey}`) };
  };
  h.db.purchasePermission = { findUnique: async () => Object.keys(legacy).length ? legacy : null };
  h.db.warehousePermission = { findUnique: async () => Object.keys(legacy).length ? legacy : null };
  return grants;
}

for (const module of ['purchases', 'warehouse', 'food-services', 'rrhh', 'my-rh']) {
  test(`${module}: deny by default, view prerequisite, action separation, immediate revocation`, async () => {
    const h = harness({ roles: ['RH'] });
    const grants = permissions(h);
    const policy = h.load('lib/cpanel/module-access.ts');
    for (const action of ['view', 'operate', 'approve', 'audit', 'manage']) {
      await assert.rejects(policy.requireModulePermission(module, action));
    }
    grants.add(`${module}/operate`);
    await assert.rejects(policy.requireModulePermission(module, 'operate'));
    grants.add(`${module}/view`);
    assert.equal((await policy.requireModulePermission(module, 'operate')).id, 'actor');
    for (const action of ['approve', 'audit', 'manage']) await assert.rejects(policy.requireModulePermission(module, action));
    grants.delete(`${module}/operate`);
    await assert.rejects(policy.requireModulePermission(module, 'operate'));
    assert.equal((await policy.requireModulePermission(module, 'view')).id, 'actor');
    assert.deepEqual(h.calls.writes, []);
  });
}

test('purchasing grants never replace legacy rights or separation of duties', async () => {
  const h = harness({ roles: ['RH'] });
  const grants = permissions(h, ['purchases/view', 'purchases/operate', 'purchases/approve', 'purchases/manage']);
  const policy = h.load('lib/purchases/purchase-permissions.ts');
  assert.equal((await policy.getMyPurchasePermissions()).canAuthorize, false);
  const legacy = { canRequest: true, canRequestUrgent: false, canAuthorize: true, canViewAll: true, canManagePurchases: true };
  h.db.purchasePermission.findUnique = async () => legacy;
  assert.equal((await policy.getMyPurchasePermissions()).canAuthorize, true);
  assert.equal((await policy.getMyPurchasePermissions()).canRequestUrgent, false);
  await assert.rejects(policy.requirePurchaseDecisionAccess('actor'));
  assert.equal((await policy.requirePurchaseDecisionAccess('other')).id, 'actor');
  grants.delete('purchases/approve');
  assert.equal((await policy.getMyPurchasePermissions()).canAuthorize, false);
  grants.delete('purchases/manage');
  assert.equal((await policy.getMyPurchasePermissions()).canManagePurchases, false);
  grants.delete('purchases/view');
  assert.ok(Object.values(await policy.getMyPurchasePermissions()).every(value => value === false));
  const admin = harness();
  admin.db.purchasePermission = { findUnique: async () => null };
  assert.ok(Object.values(await admin.load('lib/purchases/purchase-permissions.ts').getMyPurchasePermissions()).every(value => value === false));
});

test('direct page access preserves warehouse rights, production roles, RH role, and external CHEF isolation', async () => {
  const h = harness({ roles: ['RH'] });
  permissions(h, ['warehouse/view', 'warehouse/operate', 'rrhh/view', 'food-services/view']);
  const policy = h.load('lib/cpanel/module-access.ts');
  assert.equal(await policy.hasModulePageAccess({ id: 'actor', roles: ['RH'] }, 'warehouse'), false);
  h.db.warehousePermission.findUnique = async () => ({ canViewInventory: true });
  assert.equal(await policy.hasModulePageAccess({ id: 'actor', roles: ['RH'] }, 'warehouse'), true);
  assert.equal(await policy.hasModulePageAccess({ id: 'actor', roles: ['RH'] }, 'warehouse', 'operate', 'movement'), false);
  assert.equal(await policy.hasModulePageAccess({ id: 'actor', roles: ['RH'] }, 'warehouse', 'view', 'production'), false);
  assert.equal(await policy.hasModulePageAccess({ id: 'actor', roles: ['PRODUCCION'] }, 'warehouse', 'view', 'production'), true);
  assert.equal(await policy.hasModulePageAccess({ id: 'actor', roles: ['CHEF'], employee: null }, 'rrhh'), false);
  assert.equal(await policy.hasModulePageAccess({ id: 'actor', roles: ['CHEF'], employee: null }, 'food-services', 'view', 'employee'), false);
  assert.equal(await policy.hasModulePageAccess({ id: 'actor', roles: ['CHEF'], employee: null }, 'food-services', 'view', 'chef'), true);
});

test('Control Tower general consultation requires corporate auth and rejects external CHEF-only accounts', async () => {
  for (const roles of [['EMPLEADO'], ['PRODUCCION'], ['RH'], ['DIRECCION'], ['ADMIN']]) {
    const h = harness({ roles });
    assert.equal((await h.load('lib/cpanel/module-access.ts').requireControlTowerAccess()).id, 'actor');
  }
  const h = harness({ roles: ['CHEF'] });
  const policy = h.load('lib/cpanel/module-access.ts');
  await assert.rejects(policy.requireControlTowerAccess());
  h.user.employee = { id: 'employee' };
  assert.equal((await policy.requireControlTowerAccess()).id, 'actor');
  h.store.get = () => undefined;
  await assert.rejects(policy.requireControlTowerAccess());
});

test('RH delegation is explicit and cannot change sensitive actions or govern itself', async () => {
  const h = harness({ roles: ['RH'] });
  const grants = permissions(h);
  const delegation = h.load('lib/cpanel/delegation.ts');
  await assert.rejects(delegation.requireCpanelAdministrator());
  grants.add('c-panel/manage');
  assert.equal((await delegation.requireCpanelAdministrator()).scope, 'rh');
  for (const module of ['purchases', 'warehouse', 'food-services', 'rrhh']) {
    assert.equal(delegation.rhCanChange(module, 'view'), true);
    assert.equal(delegation.rhCanChange(module, 'operate'), true);
    for (const action of ['approve', 'audit', 'manage']) assert.equal(delegation.rhCanChange(module, action), false);
  }
  const api = h.load('app/api/admin/cpanel/permissions/route.ts');
  for (const input of [
    { userId: 'actor', moduleKey: 'warehouse', actionKey: 'view' },
    { userId: 'target', moduleKey: 'warehouse', actionKey: 'approve' },
    { userId: 'target', moduleKey: 'c-panel', actionKey: 'manage' },
  ]) {
    const r = await api.PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ ...input, granted: true, reason: 'Isolated test' }) }));
    assert.equal(r.status, 403);
  }
  grants.delete('c-panel/manage');
  await assert.rejects(delegation.requireCpanelAdministrator());
  assert.deepEqual(h.calls.writes, []);
});

test('RH cannot use the legacy purchase administration API to bypass explicit delegation', async () => {
  const h = harness({ roles: ['RH'], granted: true });
  permissions(h, ['purchases/view', 'purchases/manage'], { canManagePurchases: true });
  const api = h.load('app/api/purchases/admin/permissions/route.ts');
  assert.equal((await api.GET()).status, 403);
  assert.equal((await api.PATCH(new Request('http://localhost', { method: 'PATCH', body: '{}' }))).status, 403);
  assert.deepEqual(h.calls.writes, []);
});

// Execute every in-scope API method as an authenticated user with no grants.
// Fail if a handler reaches a repository, service, or real data dependency.
function routeFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? routeFiles(file) : entry.name === 'route.ts' ? [file] : [];
  });
}
const root = path.resolve(__dirname, '..');
for (const folder of ['warehouse', 'rrhh', 'purchases/requests', 'food-services/chef', 'food-services/hr', 'hr/requests']) {
  for (const file of routeFiles(path.join(root, 'app/api', folder))) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const source = fs.readFileSync(file, 'utf8');
    for (const [, method] of source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)) {
      test(`denied before data access: ${method} ${relative}`, async () => {
        const h = harness({ roles: ['RH'] });
        permissions(h);
        const api = h.load(relative);
        const request = new Request('http://localhost?scope=all', { method, ...(method === 'GET' ? {} : { body: JSON.stringify({ decision: 'APPROVE' }) }) });
        request.nextUrl = new URL(request.url);
        const r = await api[method](request, { params: Promise.resolve({ id: 'target', custodyId: 'target', countId: 'target', itemId: 'target', documentId: 'target' }) });
        assert.equal(r.status, 403);
        assert.equal(h.calls.services, 0);
        assert.deepEqual(h.calls.writes, []);
      });
    }
  }
}

test('authorized RH reads its API; a different role with the same grants is denied', async () => {
  for (const roles of [['RH'], ['CHEF']]) {
    const h = harness({ roles });
    permissions(h, ['rrhh/view']);
    h.mocks['@/lib/rrhh/service'] = { getEmployees: async () => { h.calls.services++; return []; } };
    const r = await h.load('app/api/rrhh/employees/route.ts').GET();
    assert.equal(r.status, roles[0] === 'RH' ? 200 : 403);
    assert.equal(h.calls.services, roles[0] === 'RH' ? 1 : 0);
  }
});

test('Warehouse view grant cannot replace inventory-specific rights', async () => {
  const h = harness({ roles: ['PRODUCCION'] });
  const grants = permissions(h, ['warehouse/view']);
  let inventoryRight = false;
  h.mocks['@/repositories/warehouse.repository'] = {
    getWarehousePermission: async () => ({ canViewInventory: inventoryRight }),
    getInventoryBalances: async () => [], listInventoryItems: async () => [], listWarehouses: async () => [],
  };
  const route = h.load('app/api/warehouse/inventory/route.ts');
  assert.equal((await route.GET()).status, 403);
  inventoryRight = true;
  assert.equal((await route.GET()).status, 200);
  grants.delete('warehouse/view');
  assert.equal((await route.GET()).status, 403);
});

test('Purchases request listing retains own-record filtering', async () => {
  const h = harness({ roles: ['EMPLEADO'] });
  permissions(h, ['purchases/view', 'purchases/operate'], { canRequest: true });
  let filter;
  h.db.purchaseRequest = { findMany: async query => { filter = query.where; return []; } };
  assert.equal((await h.load('app/api/purchases/requests/route.ts').GET()).status, 200);
  assert.deepEqual(filter, { requesterId: 'actor' });
});

test('external CHEF reads previews without creating drafts and needs operate to publish', async () => {
  const h = harness({ roles: ['CHEF'] });
  const grants = permissions(h, ['food-services/view']);
  h.mocks['@/lib/food-services/chef-production-service'] = { getChefProductionSummary: async () => ({ demand: [] }) };
  h.mocks['@/lib/food-services/chef-service'] = {
    getNextMenuWeek: async () => ({}),
    publishNextMenuWeek: async () => { h.calls.writes.push('publish'); return {}; },
  };
  const route = h.load('app/api/food-services/chef/menu/route.ts');
  assert.equal((await route.GET(new Request('http://localhost?view=production'))).status, 200);
  assert.equal((await route.GET(new Request('http://localhost'))).status, 200);
  assert.equal((await route.POST()).status, 403);
  assert.deepEqual(h.calls.writes, []);
  grants.add('food-services/operate');
  assert.equal((await route.GET(new Request('http://localhost'))).status, 200);
  assert.equal((await route.POST()).status, 200);
  assert.deepEqual(h.calls.writes, ['publish']);
});

test('OEE API returns 401 anonymously, 403 with temporary password, and 200 to a corporate collaborator', async () => {
  const h = harness({ roles: ['EMPLEADO'] });
  h.mocks['@/repositories/oee.repository'] = { getOeeData: async () => { h.calls.services++; return { weeks: [] }; } };
  const route = h.load('app/api/oee/route.ts');
  h.store.get = () => undefined;
  assert.equal((await route.GET(new Request('http://localhost'))).status, 401);
  h.store.get = () => ({ value: 'token' });
  h.user.passwordMustChange = true;
  assert.equal((await route.GET(new Request('http://localhost'))).status, 403);
  h.user.passwordMustChange = false;
  assert.equal((await route.GET(new Request('http://localhost'))).status, 200);
  assert.equal(h.calls.services, 1);
});

test('PIN sessions require view and operate separately, and respect grant revocation', async () => {
  const h = harness({ roles: ['EMPLEADO'] });
  const grants = permissions(h, ['food-services/view']);
  const sessions = h.load('lib/food-services/employee-session.ts');
  await sessions.createEmployeeSession('employee');
  assert.equal((await sessions.getEmployeeSession()).id, 'food-session');
  await assert.rejects(sessions.getEmployeeSession('operate'));
  grants.add('food-services/operate');
  assert.equal((await sessions.getEmployeeSession('operate')).id, 'food-session');
  grants.delete('food-services/view');
  await assert.rejects(sessions.getEmployeeSession());
});

test('delegated RH can grant view with an audit record but cannot edit ADMIN or DIRECCION', async () => {
  const h = harness({ roles: ['RH'] });
  permissions(h, ['c-panel/manage']);
  let targetRole = 'EMPLEADO';
  const originalFind = h.db.user.findUnique;
  h.db.user.findUnique = async query => query.where.id === 'actor' ? originalFind(query)
    : { id: 'target', active: true, roles: [{ role: targetRole }] };
  h.db.corporateModulePermission.findUnique = async ({ where }) => ({ granted: where.userId_moduleKey_actionKey.moduleKey === 'c-panel' });
  h.db.corporateModulePermission.upsert = async ({ create }) => { h.calls.writes.push(create); return create; };
  h.db.corporatePermissionAudit = { create: async ({ data }) => { h.calls.writes.push(data); } };
  const api = h.load('app/api/admin/cpanel/permissions/route.ts');
  const request = () => new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ userId: 'target', moduleKey: 'warehouse', actionKey: 'view', granted: true, reason: 'Pilot test grant' }) });
  assert.equal((await api.PATCH(request())).status, 200);
  assert.equal(h.calls.writes.length, 2);
  assert.equal(h.calls.writes[1].actorId, 'actor');
  assert.equal(h.calls.writes[1].reason, 'Pilot test grant');
  for (targetRole of ['ADMIN', 'DIRECCION']) assert.equal((await api.PATCH(request())).status, 403);
  assert.equal(h.calls.writes.length, 2);
});

test('direct page boundary renders restricted UI and preserves login/password-change redirects', async () => {
  const h = harness({ roles: ['RH'] });
  permissions(h);
  const boundary = h.load('lib/cpanel/module-page-access.tsx');
  const denied = await boundary.default({ module: 'rrhh', children: 'private-content' });
  assert.equal(denied.type.name, 'Restricted');
  assert.notEqual(denied.props.children, 'private-content');
  h.user.passwordMustChange = true;
  await assert.rejects(boundary.getModulePageUser('rrhh'), /REDIRECT:\/change-password/);
  h.store.get = () => undefined;
  await assert.rejects(boundary.getModulePageUser('rrhh'), /REDIRECT:\/login/);
});

for (const file of ['change-pin/route.ts', 'consumptions/route.ts', 'reservations/route.ts', 'reservations/confirm/route.ts', 'corporate-employee-access/route.ts', 'menu/route.ts', 'employee-access/route.ts']) {
  test(`Food Services entry rejects missing active RH identity: ${file}`, async () => {
    const h = harness({ roles: ['EMPLEADO'] });
    permissions(h);
    h.mocks['@/lib/food-services/service'] = { verifyEmployeePin: async () => 'employee' };
    h.mocks['@/lib/food-services/validation'].employeeAccessSchema = { parse: value => value };
    const route = h.load(`app/api/food-services/${file}`);
    for (const method of ['GET', 'POST'].filter(method => typeof route[method] === 'function')) {
      const request = new Request('http://localhost', { method, ...(method === 'GET' ? {} : { body: '{}' }) });
      const response = await route[method](request);
      assert.equal(response.status, 403);
    }
    assert.deepEqual(h.calls.writes, []);
  });
}
