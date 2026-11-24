const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/isolated-auth.cjs');

test('temporary passwords block every corporate guard, including ADMIN and delegated paths', async () => {
  for (const roles of [['ADMIN'], ['RH'], ['CHEF'], ['EMPLEADO']]) {
    const h = harness({ roles, temporary: true, granted: true });
    const auth = h.load('lib/auth/corporate-auth.ts');
    await assert.rejects(auth.requireCorporateUser(), auth.CorporateAuthorizationRequired);
    await assert.rejects(auth.requireCorporateRole(roles), auth.CorporateAuthorizationRequired);
    await assert.rejects(h.load('lib/cpanel/authorization.ts').requireCpanelPermission('food-services', 'manage'), auth.CorporateAuthorizationRequired);
    await assert.rejects(h.load('lib/cpanel/delegation.ts').requireCpanelAdministrator(), auth.CorporateAuthorizationRequired);
    await assert.rejects(h.load('lib/purchases/purchase-permissions.ts').requirePurchasePermission('canRequest'), auth.CorporateAuthorizationRequired);
    assert.equal(h.calls.permissionReads, 0);
    assert.deepEqual(h.calls.writes, []);
  }
});

test('current session remains available for page redirects; guards recheck password state', async () => {
  const h = harness({ temporary: true });
  const auth = h.load('lib/auth/corporate-auth.ts');
  assert.equal((await auth.getCurrentCorporateUser()).passwordMustChange, true);
  assert.equal((await auth.requireCorporatePasswordChangeUser()).id, 'actor');
  h.user.passwordMustChange = false;
  assert.equal((await auth.requireCorporateUser()).id, 'actor');
  h.user.passwordMustChange = true;
  await assert.rejects(auth.requireCorporateUser(), auth.CorporateAuthorizationRequired);
});

test('login still accepts temporary passwords for the change flow and preserves identifier rules', async () => {
  for (const roles of [['ADMIN'], ['CHEF'], ['EMPLEADO'], ['PRODUCCION'], ['EMPLEADO', 'RH']]) {
    const h = harness({ roles, temporary: true });
    h.db.user.findUnique = async () => h.user;
    h.db.user.findFirst = async () => h.user;
    const auth = h.load('lib/auth/corporate-auth.ts');
    const operational = roles.every(role => ['EMPLEADO', 'PRODUCCION'].includes(role));
    const identifier = operational ? '0123' : 'test@example.invalid';
    assert.equal((await auth.authenticateCorporateUser(identifier, 'valid-password')).passwordMustChange, true);
    await assert.rejects(auth.authenticateCorporateUser(operational ? 'test@example.invalid' : '0123', 'valid-password'), auth.CorporateLoginError);
    await assert.rejects(auth.authenticateCorporateUser(identifier, 'wrong'), auth.CorporateLoginError);
    assert.deepEqual(h.calls.writes, []);
  }
});

test('password-change exception still requires an active, unexpired session', async () => {
  const h = harness({ temporary: true });
  const auth = h.load('lib/auth/corporate-auth.ts');
  h.store.get = () => undefined;
  await assert.rejects(auth.requireCorporatePasswordChangeUser(), auth.CorporateAuthenticationRequired);
  h.store.get = () => ({ value: 'token' });
  h.user.active = false;
  await assert.rejects(auth.requireCorporatePasswordChangeUser(), auth.CorporateAuthenticationRequired);
  h.user.active = true;
  h.db.corporateSession.findUnique = async () => ({ id: 'expired', expiresAt: new Date(0), user: h.user });
  await assert.rejects(auth.requireCorporatePasswordChangeUser(), auth.CorporateAuthenticationRequired);
});

test('temporary user can change password and log out; invalid passwords write nothing', async () => {
  const h = harness({ temporary: true });
  const route = h.load('app/api/auth/change-password/route.ts');
  const request = (currentPassword, newPassword) => new Request('http://localhost', {
    method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
  });
  assert.equal((await route.POST(request('wrong', 'new-password-long-enough'))).status, 401);
  assert.equal((await route.POST(request('valid-password', 'short'))).status, 422);
  assert.equal((await route.POST(request('valid-password', 'valid-password'))).status, 422);
  assert.deepEqual(h.calls.writes, []);
  assert.equal((await route.POST(request('valid-password', 'new-password-long-enough'))).status, 200);
  assert.equal(h.user.passwordMustChange, false);
  assert.ok(h.calls.writes.includes('sessions deleted'));
  assert.ok(h.calls.writes.includes('session created'));
  h.user.passwordMustChange = true;
  assert.equal((await h.load('app/api/auth/logout/route.ts').POST()).status, 200);
});

test('PIN sessions cannot bypass a linked account password change, including existing sessions', async () => {
  const h = harness({ temporary: true });
  const session = h.load('lib/food-services/employee-session.ts');
  const auth = h.load('lib/auth/corporate-auth.ts');
  await assert.rejects(session.createEmployeeSession('employee'), auth.CorporateAuthorizationRequired);
  await assert.rejects(session.getEmployeeSession(), auth.CorporateAuthorizationRequired);
  assert.deepEqual(h.calls.writes, []);
  h.user.passwordMustChange = false;
  await session.createEmployeeSession('employee');
  assert.equal((await session.getEmployeeSession()).id, 'food-session');
  h.user.passwordMustChange = true;
  await assert.rejects(session.getEmployeeSession(), auth.CorporateAuthorizationRequired);
});

test('PIN-only employees need an explicit corporate permission owner', async () => {
  const h = harness({ temporary: true, employeeLinked: false });
  const session = h.load('lib/food-services/employee-session.ts');
  const auth = h.load('lib/auth/corporate-auth.ts');
  await assert.rejects(session.createEmployeeSession('employee'), auth.CorporateAuthorizationRequired);
  await assert.rejects(session.getEmployeeSession(), auth.CorporateAuthorizationRequired);
  assert.deepEqual(h.calls.writes, []);
});

test('external CHEF creation retains existing validation and ADMIN-only authorization', async () => {
  const permissions = { canRequest: false, canRequestUrgent: false, canAuthorize: false, canViewAll: false, canManagePurchases: false };
  const input = { name: 'External chef', email: 'Chef@example.invalid', employeeId: null, roles: ['CHEF'], purchasePermissions: permissions };
  const request = body => new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });
  const h = harness();
  const route = h.load('app/api/admin/corporate-access/route.ts');
  assert.equal((await route.POST(request(input))).status, 201);
  const created = h.calls.writes.find(value => value && value.email);
  assert.equal(created.email, 'chef@example.invalid');
  assert.equal(created.passwordMustChange, true);
  assert.deepEqual(created.roles.create, [{ role: 'CHEF' }]);
  assert.ok(!h.calls.writes.includes('employee updated'));
  for (const roles of [['RH'], ['ADMIN'], ['EMPLEADO'], ['CHEF', 'RH'], ['CHEF', 'ADMIN']]) {
    assert.equal((await route.POST(request({ ...input, roles }))).status, 422);
  }
  assert.equal((await route.POST(request({ ...input, email: 'invalid' }))).status, 422);
  assert.equal((await route.POST(request({ ...input, roles: [] }))).status, 422);
  assert.equal((await route.POST(request({ ...input, employeeId: 'unavailable' }))).status, 409);
  assert.equal((await route.POST(request({ ...input, purchasePermissions: { ...permissions, canRequestUrgent: true } }))).status, 422);
  h.db.user.findUnique = async () => ({ id: 'existing' });
  assert.equal((await route.POST(request(input))).status, 409);
  for (const roles of [['RH'], ['CHEF']]) {
    const denied = harness({ roles });
    assert.equal((await denied.load('app/api/admin/corporate-access/route.ts').POST(request(input))).status, 403);
    assert.deepEqual(denied.calls.writes, []);
  }
});

for (const [roles, granted, temporary, allowed] of [
  [['ADMIN'], false, false, true], [['RH'], true, false, true], [['RH'], false, false, false],
  [['CHEF'], true, false, false], [['DIRECCION'], true, false, false], [['ADMIN'], true, true, false],
]) {
  test(`Food Services RH page policy and all API methods: ${roles}, grant=${granted}, temporary=${temporary}`, async () => {
    const h = harness({ roles, granted, temporary });
    const policy = h.load('lib/food-services/rh-authorization.ts');
    if (!temporary) assert.equal(await policy.hasFoodServicesRhAccess({ id: 'actor', roles }), allowed);
    for (const [file, methods] of [
      ['billing/route.ts', ['GET']], ['billing/export/route.ts', ['GET', 'POST']],
      ['extraordinary/route.ts', ['GET', 'POST', 'PATCH']],
    ]) {
      const route = h.load(`app/api/food-services/hr/${file}`);
      for (const method of methods) {
        const response = await route[method](new Request('http://localhost?weekId=week', {
          method, ...(method === 'GET' ? {} : { body: JSON.stringify({ id: 'record' }) }),
        }));
        assert.equal(response.status, allowed ? (file === 'billing/export/route.ts' ? 200 : method === 'POST' ? 201 : 200) : 403);
      }
    }
    assert.equal(h.calls.services, allowed ? 6 : 0);
    if (roles.includes('ADMIN') || temporary || roles.includes('CHEF')) assert.equal(h.calls.permissionReads, 0);
  });
}
