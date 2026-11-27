/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute production modules with a closed default dependency list: no Prisma client,
// environment file or network dependency is loaded. The isolated PostgreSQL suite
// explicitly injects its separately verified local client and real bcrypt.
function harness({ roles = ['ADMIN'], temporary = false, granted = false, employeeLinked = true, realFoodServices = false } = {}) {
  const root = path.resolve(__dirname, '../..');
  const cache = new Map();
  const calls = { writes: [], services: 0, permissionReads: 0 };
  const user = { id: 'actor', name: 'Test', email: 'test@example.invalid', active: true,
    passwordMustChange: temporary, passwordHash: 'hash', roles: roles.map(role => ({ role })), employee: null };
  const store = { get: () => ({ value: 'test-token' }), set() {}, delete() {} };
  const db = {
    corporateSession: {
      findUnique: async () => ({ id: 'session', expiresAt: new Date(Date.now() + 60000), user }),
      deleteMany: async () => { calls.writes.push('sessions deleted'); },
      create: async () => { calls.writes.push('session created'); },
    },
    user: {
      findUnique: async ({ where }) => where.id === 'actor' ? user : null,
      create: async ({ data }) => { calls.writes.push(data); return { id: 'new-user' }; },
      update: async ({ data }) => { calls.writes.push(data); Object.assign(user, data); },
    },
    employee: {
      findUnique: async () => ({ corporateUser: employeeLinked ? user : null }),
      update: async () => { calls.writes.push('employee updated'); },
    },
    foodAccessSession: {
      findFirst: async () => ({ id: 'food-session', employee: { id: 'employee' } }),
      create: async () => { calls.writes.push('food session created'); },
    },
    corporateModulePermission: { findUnique: async () => { calls.permissionReads++; return { granted }; } },
    $transaction: async operation => typeof operation === 'function' ? operation(db) : Promise.all(operation),
  };
  const service = async () => { calls.services++; return { id: 'record' }; };
  const mocks = {
    'server-only': {},
    'next/navigation': { redirect: location => { throw new Error(`REDIRECT:${location}`); } },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/components/cpanel-access-restricted': { __esModule: true, default: function Restricted() {} },
    'next/headers': { cookies: async () => store },
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    'bcryptjs': { compare: async password => password === 'valid-password', hash: async () => 'new-hash' },
    '@/lib/db': { db },
    '@/lib/food-services/hr-billing-service': { getHrBillingSummary: service },
    '@/lib/food-services/payroll-export': { exportFoodPayroll: async () => { calls.services++; return { body: 'export', fileName: 'test.xlsx' }; } },
    '@/lib/food-services/billing-export-service': { buildFoodServicesBillingExport: async () => { calls.services++; return { body: 'export', fileName: 'test.xlsx' }; } },
    '@/lib/food-services/extraordinary-service': {
      getExtraordinaryFoodServices: service, createExtraordinaryFoodService: service, cancelExtraordinaryFoodService: service,
    },
    '@/lib/food-services/validation': {
      extraordinaryFoodServiceSchema: { parse: value => value }, cancelExtraordinaryFoodServiceSchema: { parse: value => value },
    },
  };
  const allowed = new Set([
    'lib/warehouse-quantity.ts', 'lib/warehouse-movement-idempotency.ts', 'lib/cpanel/module-access.ts', 'lib/auth/corporate-auth.ts', 'lib/cpanel/authorization.ts', 'lib/cpanel/delegation.ts',
    'lib/cpanel/permission-catalog.ts', 'lib/food-services/rh-authorization.ts',
    'lib/food-services/self-service.ts', 'lib/food-services/reference-date.ts', 'lib/food-services/employee-session.ts', 'lib/purchases/purchase-permissions.ts',
    'app/api/auth/change-password/route.ts', 'app/api/auth/logout/route.ts',
    'app/api/admin/corporate-access/route.ts', 'app/api/food-services/hr/billing/route.ts',
    // YF-003: política central de Warehouse y administración de permisos operativos de Almacén.
    'lib/warehouse/access.ts', 'lib/warehouse/capabilities.ts', 'lib/warehouse/api-error.ts', 'lib/warehouse/folio.ts', 'app/api/admin/cpanel/warehouse-permissions/route.ts',
    'app/api/food-services/hr/billing/export/route.ts', 'app/api/food-services/hr/extraordinary/route.ts',
  ]);
  function load(file) {
    assert.ok(allowed.has(file) || realFoodServices && /^lib\/food-services\/[^/]+\.ts$/.test(file) || /^(app\/api\/(warehouse|rrhh|purchases|food-services|hr)\/.*route\.ts|app\/api\/oee\/route\.ts|app\/api\/admin\/cpanel\/permissions\/route\.ts|lib\/cpanel\/module-page-access\.tsx)$/.test(file), `Unexpected production dependency: ${file}`);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const source = readFileSync(path.join(root, file), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    function isolatedRequire(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id === '@/lib/api-response') return { apiError: error => {
        const auth = load('lib/auth/corporate-auth.ts');
        const status = error instanceof auth.CorporateAuthenticationRequired || error instanceof auth.CorporateLoginError ? 401
          : error instanceof auth.CorporateAuthorizationRequired ? 403 : 422;
        return Response.json({ error: error.message }, { status });
      } };
      if (realFoodServices && id.startsWith('@/lib/food-services/')) return load(`${id.slice(2)}.ts`);
      if (id === '@prisma/client') return { WarehouseCountType: { CYCLE: 'CYCLE', SURPRISE: 'SURPRISE' }, Prisma: { Decimal: class Decimal {}, PrismaClientKnownRequestError: class KnownError {} } };
      if (id.startsWith('@/engines/') || id.startsWith('@/repositories/') || id.startsWith('@/lib/rrhh/') || id.startsWith('@/lib/food-services/') && !['@/lib/food-services/rh-authorization', '@/lib/food-services/employee-session', '@/lib/food-services/self-service', '@/lib/food-services/reference-date'].includes(id) || ['@/lib/purchases/purchase-storage', '@/lib/purchases/purchase-document-status', '@/lib/purchases/purchase-folio'].includes(id)) {
        return new Proxy({}, { get: (_, name) => { if (name === '__esModule') return true; return function UnexpectedDataAccess() { calls.services++; throw new Error(`Unexpected data access: ${id}.${String(name)}`); }; } });
      }
      if (id === '@/lib/hr/request-config') return { HR_REQUEST_TYPES: {}, isHrRequestType: () => true };
      if (id === '@/lib/warehouse-idempotency') return { operationIdentity: () => null, isSerializationConflict: () => false, isUniqueConflict: () => false };
      if (['node:crypto', 'crypto', 'zod'].includes(id)) return require(id);
      if (id.startsWith('@/')) return load(`${id.slice(2)}.ts`);
      throw new Error(`Unexpected dependency: ${id}`);
    }
    new Function('require', 'module', 'exports', output)(isolatedRequire, mod, mod.exports);
    return mod.exports;
  }
  return { load, calls, user, store, db, mocks };
}


module.exports = { harness };
