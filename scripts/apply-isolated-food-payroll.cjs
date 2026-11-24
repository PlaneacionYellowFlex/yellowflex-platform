/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002 Bloque A: aplica ÚNICAMENTE la migración 20261124130000_food_payroll_core en el PostgreSQL aislado
// 127.0.0.1:55432/yellowflex_restore_test. Verifica el destino efectivo inmediatamente antes de aplicar,
// el SHA-256 del DDL revisado, el estado previo y la estructura resultante. Si ya está aplicada, solo verifica.
// Uso: node scripts/apply-isolated-food-payroll.cjs   (requiere YELLOWFLEX_TEST_DATABASE_URL en el proceso)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');

const MIGRATION = '20261124130000_food_payroll_core';
const MIGRATION_SHA256 = 'c677f7681f956b9c81cc9d04305ad93a364d5892f329f11ff24fb4fd02068e87';
const TABLES = ['FoodPayrollBatch', 'FoodPayrollBatchItem', 'FoodPayrollBatchItemService', 'FoodPayrollAssignment',
  'FoodPayrollReconciliation', 'FoodPayrollReconciliationItem', 'FoodPayrollAdjustment', 'FoodPayrollAuditEvent'];
const TRIGGERS = ['FoodPayrollBatch_guard', 'FoodPayrollBatchItem_guard', 'FoodPayrollBatchItemService_guard', 'FoodPayrollAssignment_guard',
  'FoodOrder_payroll_assignment_guard', 'Reservation_payroll_assignment_guard', 'FoodPayrollAuditEvent_append_only'];

async function structure(db) {
  const [row] = await db.$queryRawUnsafe(`SELECT
    (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])) AS tables,
    (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($2::text[])) AS triggers,
    (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'FoodPayrollAssignment_one_active_per_order'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%ACTIVE%') AS partial_index,
    (SELECT count(*)::int FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'FoodPayroll%') AS checks`, TABLES, TRIGGERS);
  return row;
}

async function main() {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    // 1. Destino efectivo (DATABASE_URL y DIRECT_URL) verificado inmediatamente antes de cualquier cambio.
    await assertIsolatedIdentity(db);
    const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try { await assertIsolatedIdentity(direct); } finally { await direct.$disconnect(); }
    console.log('Destino efectivo verificado por DATABASE_URL y DIRECT_URL: 127.0.0.1:55432/yellowflex_restore_test.');

    // 2. DDL revisado: el archivo debe ser exactamente el entregado (SHA-256).
    const file = path.resolve('prisma/migrations', MIGRATION, 'migration.sql');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(sha, MIGRATION_SHA256, 'El DDL de la migración no coincide con el revisado');
    console.log(`DDL revisado: ${MIGRATION} SHA-256 ${sha}`);

    // 3. Estado de migraciones: solo puede faltar la migración autorizada.
    const applied = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"');
    assert.ok(applied.every(r => r.finished_at || r.rolled_back_at), 'Hay una migración incompleta o fallida');
    const done = new Map(applied.filter(r => r.finished_at && !r.rolled_back_at).map(r => [r.migration_name, r.checksum]));
    const local = fs.readdirSync(path.resolve('prisma/migrations'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
    assert.equal(local.length, 30, 'Se esperaban 30 migraciones locales');
    const pending = local.filter(name => !done.has(name));
    assert.ok(pending.length === 0 || (pending.length === 1 && pending[0] === MIGRATION), `Migraciones pendientes no autorizadas: ${pending.join(', ')}`);

    if (pending.length) {
      const before = await structure(db);
      assert.equal(before.tables, 0, 'Ya existen tablas FoodPayroll: estado previo inesperado');
      assert.equal(before.triggers, 0, 'Ya existen triggers de prenómina: estado previo inesperado');
      await assertIsolatedIdentity(db); // verificación inmediatamente anterior a aplicar
      const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
        { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, encoding: 'utf8', timeout: 180000 });
      process.stdout.write((result.stdout || '').replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
      if (result.status !== 0) {
        process.stderr.write((result.stderr || '').replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
        throw new Error('prisma migrate deploy falló');
      }
      console.log(`Aplicada únicamente la migración autorizada: ${MIGRATION}`);
    } else {
      console.log(`La migración ${MIGRATION} ya estaba aplicada; solo se verifica la estructura.`);
    }

    // 4. Estructura resultante y checksum registrado.
    const after = await structure(db);
    assert.deepEqual({ tables: after.tables, triggers: after.triggers, partial_index: after.partial_index }, { tables: 8, triggers: 7, partial_index: 1 });
    assert.ok(after.checks >= 9, 'Faltan restricciones CHECK');
    const [rec] = await db.$queryRawUnsafe('SELECT checksum FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', MIGRATION);
    assert.equal(rec && rec.checksum, MIGRATION_SHA256, 'Checksum registrado distinto del archivo');
    await assertIsolatedIdentity(db);
    console.log(JSON.stringify({ migration: MIGRATION, ...after }));
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  console.error('DETENIDO: ' + String(error && error.message || error).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  process.exitCode = 1;
});
