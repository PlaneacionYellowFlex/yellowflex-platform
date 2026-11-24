const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');
async function main() {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await assertIsolatedIdentity(db);
    const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try { await assertIsolatedIdentity(direct); } finally { await direct.$disconnect(); }
    console.log('Prisma DATABASE_URL y DIRECT_URL efectivos: 127.0.0.1:55432/yellowflex_restore_test; identidad verificada por ambas conexiones.');
    const applied = await db.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"');
    assert.ok(applied.every(row => row.finished_at || row.rolled_back_at), 'Hay una migración incompleta');
    const done = new Set(applied.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name));
    const local = fs.readdirSync(path.resolve('prisma/migrations'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
    const pending = local.filter(name => !done.has(name));
    const allowed = '20261104170000_operational_login_email_optional';
    assert.equal(local.length, 28);
    assert.ok(pending.length === 0 || pending.length === 1 && pending[0] === allowed, 'Migraciones pendientes no autorizadas');
    assert.ok(done.size === (pending.length ? 27 : 28));
    if (pending.length) {
      const sql = fs.readFileSync(path.join('prisma/migrations', allowed, 'migration.sql'), 'utf8').replace(/^\uFEFF/, '').trim();
      assert.equal(sql, 'ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;');
      const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, encoding: 'utf8', timeout: 90000 });
      if (result.status !== 0) throw new Error('Prisma migrate deploy local falló; revisar el estado antes de continuar');
      console.log('Aplicada únicamente la migración autorizada: ' + allowed);
    }
    const result = await db.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations, (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='email') AS email_nullable`);
    assert.deepEqual(result, [{ migrations: 28, email_nullable: 'YES' }]);
    await assertIsolatedIdentity(db);
    console.log(JSON.stringify(result[0]));
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('DETENIDO: fallo de comprobación o migración local. No se continúa con pruebas.'); process.exitCode = 1; });
