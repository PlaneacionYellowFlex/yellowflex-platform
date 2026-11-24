const test = require('node:test');
const assert = require('node:assert/strict');
const { isolatedUrl, configureIsolatedConnection } = require('./helpers/isolated-postgres.cjs');
test('isolated database guard rejects nonlocal hosts, wrong ports/databases, parameters and missing credentials', () => {
  for (const value of ['', 'not-a-url', 'postgresql://u:p@prod.supabase.com:5432/postgres',
    'postgresql://u:p@localhost:55432/yellowflex_restore_test', 'postgresql://u:p@127.0.0.1:5432/yellowflex_restore_test',
    'postgresql://u:p@127.0.0.1:55432/postgres', 'postgresql://u:p@127.0.0.1:55432/yellowflex_idempotencia_test',
    'postgresql://u:p@127.0.0.1:55432/yellowflex_restore_test?host=prod', 'postgresql://u@127.0.0.1:55432/yellowflex_restore_test']) {
    assert.throws(() => isolatedUrl(value));
  }
});
test('isolated connection cannot inherit Prisma production variables', () => {
  const names = ['YELLOWFLEX_TEST_DATABASE_URL','DATABASE_URL','DIRECT_URL'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    const url = 'postgresql://qa:fictional@127.0.0.1:55432/yellowflex_restore_test';
    process.env.YELLOWFLEX_TEST_DATABASE_URL = url;
    process.env.DATABASE_URL = 'postgresql://qa:fictional@prod.invalid:5432/postgres';
    process.env.DIRECT_URL = process.env.DATABASE_URL;
    assert.equal(configureIsolatedConnection(), url);
    assert.equal(process.env.DATABASE_URL, url);
    assert.equal(process.env.DIRECT_URL, url);
  } finally {
    for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
  }
});
