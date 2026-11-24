const assert = require('node:assert/strict');
function isolatedUrl(value = process.env.YELLOWFLEX_TEST_DATABASE_URL) {
  assert.ok(typeof value === 'string' && value.length, 'Falta la URL exclusiva de pruebas');
  let url;
  try { url = new URL(value); } catch { throw new Error('URL de prueba inválida'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' && url.port === '55432' && url.pathname === '/yellowflex_restore_test' && !url.search && !url.hash && url.username && url.password, 'Destino de prueba rechazado');
  return value;
}
function configureIsolatedConnection() {
  const value = isolatedUrl();
  // Child-process environment only. Never write .env or Windows persistent settings.
  process.env.DATABASE_URL = value;
  process.env.DIRECT_URL = value;
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) assert.equal(isolatedUrl(process.env[key]), value);
  return value;
}
async function assertIsolatedIdentity(db) {
  const rows = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe("SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port, (SELECT count(*)::int FROM pg_foreign_server) AS foreign_servers");
  });
  assert.deepEqual(rows, [{ database: 'yellowflex_restore_test', host: '127.0.0.1', port: 55432, foreign_servers: 0 }], 'Identidad local no verificada');
}
module.exports = { isolatedUrl, configureIsolatedConnection, assertIsolatedIdentity };
