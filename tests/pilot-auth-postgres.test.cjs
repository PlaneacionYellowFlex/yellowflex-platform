const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, randomBytes, randomInt, createHash } = require('node:crypto');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('./helpers/isolated-postgres.cjs');
const { harness } = require('./helpers/isolated-auth.cjs');

test('six fictitious pilot profiles against isolated PostgreSQL', {
  skip: process.env.RUN_PILOT_AUTH_DB_TESTS !== '1',
}, async t => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const bcrypt = require('bcryptjs');
  const db = new PrismaClient({ datasourceUrl: url });
  const runId = randomUUID();
  const suffix = runId.slice(0, 8);
  const fixtures = new Map();
  const userIds = [];
  let departmentId;
  let retained = false;
  let failed = false;
  const manifestPath = path.resolve('data/qa-pilot-local-manifest.json');
  const credentialPath = path.join(os.tmpdir(), `yellowflex-pilot-${runId}.credentials.json`);
  let credentialsWritten = false;
  async function check(name, fn) {
    await t.test(name, async () => { try { await fn(); } catch (error) { failed = true; throw error; } });
  }
  async function login(fixture) {
    const user = await fixture.auth.authenticateCorporateUser(fixture.login, fixture.password);
    await fixture.auth.createCorporateSession(user.id);
    return user;
  }
  const req = data => new Request('http://127.0.0.1', { method: 'POST', body: JSON.stringify(data) });
  try {
    await assertIsolatedIdentity(db);
    assert.ok(!fs.existsSync(manifestPath), 'Ya existe un manifiesto QA: conservarlo y no duplicar perfiles');
    const spec = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/pilot-profiles.json'), 'utf8'));
    assert.equal(spec.database, 'yellowflex_restore_test');
    const department = await db.department.create({ data: { code: `QA-PILOT-${suffix}`, name: `Fictitious pilot ${runId}` } });
    departmentId = department.id;
    for (const profile of spec.profiles) {
      const password = randomBytes(24).toString('base64url');
      const pin = String(randomInt(100000, 1000000));
      const email = profile.email ? profile.email.replace('@', `+${suffix}@`) : null;
      const user = await db.user.create({ data: {
        name: `${profile.name} ${suffix}`, email, passwordHash: await bcrypt.hash(password, 12), passwordMustChange: true,
        roles: { create: profile.roles.map(role => ({ role })) },
      } });
      userIds.push(user.id);
      let employee;
      if (profile.employeeNumber) employee = await db.employee.create({ data: {
        employeeNumber: `${profile.employeeNumber}-${suffix}`, fullName: user.name, departmentId,
        corporateUserId: user.id, status: 'ACTIVE', pinHash: await bcrypt.hash(pin, 12), pinMustChange: false,
      } });
      if (profile.permissions.length) await db.corporateModulePermission.createMany({ data: profile.permissions.map(key => {
        const [moduleKey, actionKey] = key.split('/'); return { userId: user.id, moduleKey, actionKey, granted: true };
      }) });
      if (profile.purchasePermissions) await db.purchasePermission.create({ data: { userId: user.id, ...profile.purchasePermissions } });
      if (profile.warehousePermissions) await db.warehousePermission.create({ data: { userId: user.id, ...profile.warehousePermissions } });
      const h = harness();
      const cookieJar = new Map();
      h.mocks['@/lib/db'] = { db };
      h.mocks['bcryptjs'] = bcrypt;
      h.mocks['next/headers'] = { cookies: async () => ({
        get: name => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
        set: (name, value) => cookieJar.set(name, value), delete: name => cookieJar.delete(name),
      }) };
      fixtures.set(profile.key, { ...profile, id: user.id, email, employee, pin, password,
        login: profile.roles.every(role => ['PRODUCCION','EMPLEADO'].includes(role)) ? employee.employeeNumber : email,
        h, cookieJar, auth: h.load('lib/auth/corporate-auth.ts'), policy: h.load('lib/cpanel/module-access.ts'),
      });
    }
    assert.equal(fixtures.size, 6);
    for (const [key, fixture] of fixtures) {
      await check(`${key}: real bcrypt login, temporary-password API block, password change, session rotation and logout`, async () => {
        const user = await login(fixture);
        assert.equal(user.passwordMustChange, true);
        assert.equal(user.id, fixture.id);
        await assert.rejects(fixture.auth.requireCorporateUser(), fixture.auth.CorporateAuthorizationRequired);
        const token = fixture.cookieJar.get('yellowflex_corporate_session');
        const nextPassword = randomBytes(24).toString('base64url');
        const change = fixture.h.load('app/api/auth/change-password/route.ts');
        assert.equal((await change.POST(req({ currentPassword: fixture.password, newPassword: nextPassword }))).status, 200);
        assert.equal(await db.corporateSession.count({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } }), 0);
        assert.equal((await fixture.auth.requireCorporateUser()).id, fixture.id);
        await assert.rejects(fixture.auth.authenticateCorporateUser(fixture.login, fixture.password));
        fixture.password = nextPassword;
        assert.equal((await fixture.auth.authenticateCorporateUser(fixture.login, nextPassword)).passwordMustChange, false);
        await fixture.auth.destroyCorporateSession();
        assert.equal(await fixture.auth.getCurrentCorporateUser(), null);
        await login(fixture);
      });
    }
    const admin = fixtures.get('admin'), rh = fixtures.get('rh-delegado'), administrative = fixtures.get('administrativo');
    const production = fixtures.get('produccion'), warehouse = fixtures.get('warehouse'), chef = fixtures.get('chef-externo');
    await check('ADMIN governance does not create specialized purchase rights', async () => {
      assert.equal((await admin.h.load('lib/cpanel/delegation.ts').requireCpanelAdministrator()).scope, 'admin');
      assert.ok(Object.values(await admin.h.load('lib/purchases/purchase-permissions.ts').getMyPurchasePermissions()).every(value => !value));
    });
    await check('administrative own purchase rights, denied urgency/approval/RH, general Control Tower consultation', async () => {
      const p = await administrative.h.load('lib/purchases/purchase-permissions.ts').getMyPurchasePermissions();
      assert.equal(p.canRequest, true); assert.equal(p.canRequestUrgent, false); assert.equal(p.canAuthorize, false);
      await assert.rejects(administrative.policy.requireRhPermission());
      await administrative.policy.requireControlTowerAccess();
    });
    await check('Production login without email, custody operation allowed, global inventory/adjustments denied', async () => {
      assert.equal(production.email, null);
      await production.policy.requireModulePermission('warehouse', 'operate');
      const user = await production.auth.requireCorporateUser();
      assert.equal(await production.policy.hasModulePageAccess(user, 'warehouse'), false);
      assert.equal(await production.policy.hasModulePageAccess(user, 'warehouse', 'operate', 'production'), true);
      await assert.rejects(production.policy.requireModulePermission('warehouse', 'approve'));
    });
    await check('Warehouse explicit grants preserve specialized access', async () => {
      const user = await warehouse.auth.requireCorporateUser();
      assert.equal(await warehouse.policy.hasModulePageAccess(user, 'warehouse'), true);
      await warehouse.policy.requireModulePermission('warehouse', 'approve');
      await assert.rejects(warehouse.policy.requireRhPermission());
    });
    await check('external CHEF has no Employee; kitchen access allowed, audit/RH/governance/Control Tower denied', async () => {
      const user = await chef.auth.requireCorporateUser();
      assert.equal(user.employee, null);
      await chef.policy.requireChefPermission('operate');
      await assert.rejects(chef.policy.requireChefPermission('audit'));
      await assert.rejects(chef.policy.requireRhPermission());
      await assert.rejects(chef.h.load('lib/cpanel/delegation.ts').requireCpanelAdministrator());
      await assert.rejects(chef.policy.requireControlTowerAccess());
    });
    await check('delegated RH API writes real audit atomically; revocation applies to an existing Warehouse session', async () => {
      const api = rh.h.load('app/api/admin/cpanel/permissions/route.ts');
      const change = (moduleKey, actionKey, granted, userId = warehouse.id) => api.PATCH(req({ userId, moduleKey, actionKey, granted, reason: `QA-PILOT-${runId}` }));
      assert.equal((await change('warehouse', 'operate', false)).status, 200);
      await assert.rejects(warehouse.policy.requireModulePermission('warehouse', 'operate'));
      assert.equal((await change('warehouse', 'operate', true)).status, 200);
      await warehouse.policy.requireModulePermission('warehouse', 'operate');
      assert.equal(await db.corporatePermissionAudit.count({ where: { actorId: rh.id, targetId: warehouse.id, reason: `QA-PILOT-${runId}` } }), 2);
      assert.equal((await change('warehouse', 'approve', false)).status, 403);
      assert.equal((await change('warehouse', 'view', false, rh.id)).status, 403);
      assert.equal((await change('warehouse', 'view', true, admin.id)).status, 403);
      const adminApi = admin.h.load('app/api/admin/cpanel/permissions/route.ts');
      assert.equal((await adminApi.PATCH(req({ userId: rh.id, moduleKey: 'c-panel', actionKey: 'manage', granted: false, reason: `QA-PILOT-${runId}` }))).status, 200);
      await assert.rejects(rh.h.load('lib/cpanel/delegation.ts').requireCpanelAdministrator());
      assert.equal((await adminApi.PATCH(req({ userId: rh.id, moduleKey: 'c-panel', actionKey: 'manage', granted: true, reason: `QA-PILOT-${runId}` }))).status, 200);
    });
    await check('expired and inactive-account sessions are rejected by real persisted session checks', async () => {
      await db.corporateSession.updateMany({ where: { userId: chef.id }, data: { expiresAt: new Date(0) } });
      assert.equal(await chef.auth.getCurrentCorporateUser(), null);
      await login(chef);
      await db.user.update({ where: { id: chef.id }, data: { active: false } });
      assert.equal(await chef.auth.getCurrentCorporateUser(), null);
      await db.user.update({ where: { id: chef.id }, data: { active: true } });
    });
    await check('failed permission transaction rolls back both grant and audit', async () => {
      const before = await db.corporatePermissionAudit.count({ where: { actorId: admin.id } });
      await assert.rejects(db.$transaction(async tx => {
        await tx.corporatePermissionAudit.create({ data: { actorId: admin.id, targetId: warehouse.id, moduleKey: 'warehouse', actionKey: 'audit', newGranted: true, reason: `QA-ROLLBACK-${runId}` } });
        await tx.corporateModulePermission.create({ data: { userId: warehouse.id, moduleKey: 'warehouse', actionKey: 'audit', granted: true } });
        await tx.corporateModulePermission.create({ data: { userId: warehouse.id, moduleKey: 'warehouse', actionKey: 'view', granted: true } });
      }));
      assert.equal(await db.corporatePermissionAudit.count({ where: { actorId: admin.id } }), before);
      assert.equal(await db.corporateModulePermission.count({ where: { userId: warehouse.id, moduleKey: 'warehouse', actionKey: 'audit' } }), 0);
    });
    if (failed) throw new Error('Falló una comprobación: los perfiles no se conservan para navegador');
    if (process.env.KEEP_PILOT_FIXTURES === '1') {
      const credentials = [];
      for (const [key, fixture] of fixtures) {
        const password = randomBytes(24).toString('base64url');
        await db.$transaction([
          db.user.update({ where: { id: fixture.id }, data: { passwordHash: await bcrypt.hash(password, 12), passwordMustChange: true } }),
          db.corporateSession.deleteMany({ where: { userId: fixture.id } }),
        ]);
        credentials.push({ profile: key, login: fixture.login, password, pin: fixture.employee ? fixture.pin : null });
      }
      fs.writeFileSync(credentialPath, JSON.stringify(credentials, null, 2), { flag: 'wx', mode: 0o600 });
      credentialsWritten = true;
      fs.writeFileSync(manifestPath, JSON.stringify({ runId, database: 'yellowflex_restore_test', host: '127.0.0.1', port: 55432,
        credentialsFile: credentialPath, departmentId,
        profiles: [...fixtures.entries()].map(([key, f]) => ({ key, userId: f.id, login: f.login, employeeId: f.employee?.id ?? null, passwordMustChange: true })),
      }, null, 2), { flag: 'wx' });
      retained = true;
      t.diagnostic('Conservados seis perfiles ficticios locales para navegador. Credenciales guardadas fuera del repositorio, sin imprimirlas.');
    }
  } finally {
    try {
      if (!retained && (userIds.length || departmentId)) {
        await db.$transaction(async tx => {
          await tx.corporatePermissionAudit.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { targetId: { in: userIds } }] } });
          await tx.corporateModulePermission.deleteMany({ where: { userId: { in: userIds } } });
          await tx.corporateSession.deleteMany({ where: { userId: { in: userIds } } });
          await tx.employee.deleteMany({ where: { corporateUserId: { in: userIds } } });
          await tx.purchasePermission.deleteMany({ where: { userId: { in: userIds } } });
          await tx.warehousePermission.deleteMany({ where: { userId: { in: userIds } } });
          await tx.user.deleteMany({ where: { id: { in: userIds } } });
          if (departmentId) await tx.department.delete({ where: { id: departmentId } });
        });
        if (credentialsWritten) fs.unlinkSync(credentialPath);
      }
    } finally { await db.$disconnect(); }
  }
});
