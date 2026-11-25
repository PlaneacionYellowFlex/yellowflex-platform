/* eslint-disable @typescript-eslint/no-require-imports */
// YF-002-C2: aplica ÚNICAMENTE la migración incremental 20261124180000_food_payroll_reconciliation en el
// PostgreSQL aislado 127.0.0.1:55432/yellowflex_restore_test. Exige la migración del Bloque A ya aplicada con su
// checksum original (no la modifica ni la reaplica), verifica el destino efectivo inmediatamente antes de aplicar,
// el SHA-256 del DDL revisado, el estado previo y la estructura resultante. Si ya está aplicada, solo verifica.
// Uso: node scripts/apply-isolated-food-payroll-c2.cjs   (requiere YELLOWFLEX_TEST_DATABASE_URL en el proceso)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');

const BASE = '20261124130000_food_payroll_core';
const BASE_SHA256 = 'c677f7681f956b9c81cc9d04305ad93a364d5892f329f11ff24fb4fd02068e87';
const MIGRATION = '20261124180000_food_payroll_reconciliation';
const MIGRATION_SHA256 = '33844ad52c30edb6fb2e53ae2642d4e325254af07886643bd668e27c03eb6b6a';
const LOCAL_MIGRATIONS = 31;
const TABLES = ['FoodPayrollBatch', 'FoodPayrollBatchItem', 'FoodPayrollBatchItemService', 'FoodPayrollAssignment',
  'FoodPayrollReconciliation', 'FoodPayrollReconciliationEmployee', 'FoodPayrollReconciliationItem', 'FoodPayrollAdjustment', 'FoodPayrollAuditEvent'];
const TRIGGERS = ['FoodPayrollBatch_guard', 'FoodPayrollBatchItem_guard', 'FoodPayrollBatchItemService_guard', 'FoodPayrollAssignment_guard',
  'FoodOrder_payroll_assignment_guard', 'Reservation_payroll_assignment_guard', 'FoodPayrollAuditEvent_append_only',
  'FoodPayrollReconciliation_guard', 'FoodPayrollReconciliationEmployee_guard', 'FoodPayrollReconciliationItem_guard', 'FoodPayrollAdjustment_guard'];
const PARTIAL = ['FoodPayrollAssignment_one_active_per_order', 'FoodPayrollReconciliation_one_active_per_batch',
  'FoodPayrollAdjustment_one_root_per_employee', 'FoodPayrollAdjustment_one_successor'];
const clean = v => String(v).replace(/postgres(ql)?:\/\/\S+/g, '<url>');

async function structure(db) {
  const [row] = await db.$queryRawUnsafe(`SELECT
    (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])) AS tables,
    (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($2::text[])) AS triggers,
    (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($3::text[]) AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%') AS partial_indexes,
    (SELECT count(*)::int FROM pg_proc WHERE proname = 'food_payroll_employee_covered') AS coverage_function,
    (SELECT count(*)::int FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'FoodPayroll%') AS checks,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'FoodPayrollBatch' AND column_name = 'closedAt') AS close_column`, TABLES, TRIGGERS, PARTIAL);
  return row;
}

async function main() {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    // 1. Destino efectivo (DATABASE_URL y DIRECT_URL) verificado antes de cualquier cambio.
    await assertIsolatedIdentity(db);
    const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try { await assertIsolatedIdentity(direct); } finally { await direct.$disconnect(); }
    console.log('Destino efectivo verificado por DATABASE_URL y DIRECT_URL: 127.0.0.1:55432/yellowflex_restore_test.');

    // 2. DDL revisados: migración base intacta y migración C2 exactamente la entregada (SHA-256).
    const shaOf = name => crypto.createHash('sha256').update(fs.readFileSync(path.resolve('prisma/migrations', name, 'migration.sql'))).digest('hex');
    assert.equal(shaOf(BASE), BASE_SHA256, 'La migración del Bloque A fue modificada');
    assert.equal(shaOf(MIGRATION), MIGRATION_SHA256, 'El DDL de la migración C2 no coincide con el revisado');
    console.log(`DDL revisados: ${BASE} SHA-256 ${BASE_SHA256}; ${MIGRATION} SHA-256 ${MIGRATION_SHA256}`);

    // 3. Estado de migraciones: el Bloque A aplicado con su checksum; solo puede faltar la migración C2.
    const applied = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"');
    assert.ok(applied.every(r => r.finished_at || r.rolled_back_at), 'Hay una migración incompleta o fallida');
    const done = new Map(applied.filter(r => r.finished_at && !r.rolled_back_at).map(r => [r.migration_name, r.checksum]));
    assert.equal(done.get(BASE), BASE_SHA256, 'La migración del Bloque A no está aplicada con su checksum original; este script no la aplica');
    const local = fs.readdirSync(path.resolve('prisma/migrations'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
    assert.equal(local.length, LOCAL_MIGRATIONS, `Se esperaban ${LOCAL_MIGRATIONS} migraciones locales`);
    const pending = local.filter(name => !done.has(name));
    assert.ok(pending.length === 0 || (pending.length === 1 && pending[0] === MIGRATION), `Migraciones pendientes no autorizadas: ${pending.join(', ')}`);

    if (pending.length) {
      const before = await structure(db);
      assert.equal(before.close_column, 0, 'El lote ya tiene columnas de cierre: estado previo inesperado');
      const [counts] = await db.$queryRawUnsafe(`SELECT (SELECT count(*)::int FROM "FoodPayrollReconciliation") AS r,
        (SELECT count(*)::int FROM "FoodPayrollReconciliationItem") AS i, (SELECT count(*)::int FROM "FoodPayrollAdjustment") AS a`);
      assert.deepEqual(counts, { r: 0, i: 0, a: 0 }, 'Existen conciliaciones o ajustes previos: estado inesperado');
      await assertIsolatedIdentity(db); // verificación inmediatamente anterior a aplicar
      const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
        { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, encoding: 'utf8', timeout: 180000 });
      process.stdout.write(clean(result.stdout || ''));
      if (result.status !== 0) {
        process.stderr.write(clean(result.stderr || ''));
        throw new Error('prisma migrate deploy falló');
      }
      console.log(`Aplicada únicamente la migración autorizada: ${MIGRATION}`);
    } else {
      console.log(`La migración ${MIGRATION} ya estaba aplicada; solo se verifica la estructura.`);
    }

    // 4. Estructura resultante y checksums registrados.
    const after = await structure(db);
    assert.deepEqual({ tables: after.tables, triggers: after.triggers, partial_indexes: after.partial_indexes, coverage_function: after.coverage_function, close_column: after.close_column },
      { tables: 9, triggers: 11, partial_indexes: 4, coverage_function: 1, close_column: 1 });
    assert.ok(after.checks >= 18, 'Faltan restricciones CHECK');
    for (const [name, sha] of [[BASE, BASE_SHA256], [MIGRATION, MIGRATION_SHA256]]) {
      const [rec] = await db.$queryRawUnsafe('SELECT checksum FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', name);
      assert.equal(rec && rec.checksum, sha, `Checksum registrado distinto del archivo: ${name}`);
    }
    await assertIsolatedIdentity(db);
    console.log(JSON.stringify({ migration: MIGRATION, ...after }));
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  console.error('DETENIDO: ' + clean(error && error.message || error));
  process.exitCode = 1;
});
