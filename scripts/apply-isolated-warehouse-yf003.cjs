/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 V2: aplica ÚNICAMENTE la migración incremental 20261125200000_warehouse_yf003_enterprise_v2 en el PostgreSQL
// aislado 127.0.0.1:55432/yellowflex_restore_test. Exige las migraciones de YF-002 (A y C2) aplicadas con su checksum,
// verifica el destino efectivo inmediatamente antes de aplicar, el SHA-256 del DDL revisado y el resultado.
// Si ya está aplicada, solo verifica. No modifica migraciones históricas.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');

const REQUIRED = [
  ['20261124130000_food_payroll_core', 'c677f7681f956b9c81cc9d04305ad93a364d5892f329f11ff24fb4fd02068e87'],
  ['20261124180000_food_payroll_reconciliation', '33844ad52c30edb6fb2e53ae2642d4e325254af07886643bd668e27c03eb6b6a'],
];
const MIGRATION = '20261125200000_warehouse_yf003_enterprise_v2';
const MIGRATION_SHA256 = '4bac6fa0360008cb73357295844d33caf4ca849160a122c39ba87506ac51cd4f';
const LOCAL_MIGRATIONS = 32;
const clean = v => String(v).replace(/postgres(ql)?:\/\/\S+/g, '<url>');
const shaOf = name => crypto.createHash('sha256').update(fs.readFileSync(path.resolve('prisma/migrations', name, 'migration.sql'))).digest('hex');

async function enumValues(db) {
  const rows = await db.$queryRawUnsafe(`SELECT e.enumlabel::text AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'WarehouseStockOperationKind' ORDER BY e.enumsortorder`);
  return rows.map(r => r.v);
}

async function main() {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await assertIsolatedIdentity(db);
    const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try { await assertIsolatedIdentity(direct); } finally { await direct.$disconnect(); }
    console.log('Destino efectivo verificado por DATABASE_URL y DIRECT_URL: 127.0.0.1:55432/yellowflex_restore_test.');

    for (const [name, sha] of REQUIRED) assert.equal(shaOf(name), sha, `Migración histórica modificada: ${name}`);
    assert.equal(shaOf(MIGRATION), MIGRATION_SHA256, 'El DDL de la migración YF-003 no coincide con el revisado');
    console.log(`DDL revisado: ${MIGRATION} SHA-256 ${MIGRATION_SHA256}`);

    const applied = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"');
    assert.ok(applied.every(r => r.finished_at || r.rolled_back_at), 'Hay una migración incompleta o fallida');
    const done = new Map(applied.filter(r => r.finished_at && !r.rolled_back_at).map(r => [r.migration_name, r.checksum]));
    for (const [name, sha] of REQUIRED) assert.equal(done.get(name), sha, `La migración ${name} no está aplicada con su checksum; este script no la aplica`);
    const local = fs.readdirSync(path.resolve('prisma/migrations'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
    assert.equal(local.length, LOCAL_MIGRATIONS, `Se esperaban ${LOCAL_MIGRATIONS} migraciones locales`);
    for (const [name, checksum] of done) {
      assert.ok(local.includes(name), 'Migración aplicada ausente en disco: ' + name);
      assert.equal(shaOf(name), checksum, 'Checksum divergente: ' + name);
    }
    const pending = local.filter(name => !done.has(name));
    assert.ok(pending.length === 0 || (pending.length === 1 && pending[0] === MIGRATION), `Migraciones pendientes no autorizadas: ${pending.join(', ')}`);

    if (pending.length) {
      console.log(`Valores previos del enum: ${(await enumValues(db)).join(', ')}`);
      await assertIsolatedIdentity(db); // verificación inmediatamente anterior a aplicar
      const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
        { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, encoding: 'utf8', timeout: 180000 });
      process.stdout.write(clean(result.stdout || ''));
      if (result.status !== 0) { process.stderr.write(clean(result.stderr || '')); throw new Error('prisma migrate deploy falló'); }
      console.log(`Aplicada únicamente la migración autorizada: ${MIGRATION}`);
    } else {
      console.log(`La migración ${MIGRATION} ya estaba aplicada; solo se verifica.`);
    }

    const values = await enumValues(db);
    for (const v of ['INTERNAL_TRANSFER', 'EXTERNAL_RECEIPT', 'OPERATIONAL_HANDOFF', 'EXTERNAL_ISSUE', 'MOVEMENT_REVERSAL', 'PRODUCTION_RECEIPT',
      'RETURN_REQUEST', 'RETURN_RECEIPT', 'COUNT_LAUNCH', 'COUNT_COMPLETE', 'RECOUNT_REQUEST', 'RECOUNT_COMPLETE', 'DISCREPANCY_UPDATE',
      'DISCREPANCY_APPROVAL', 'DISCREPANCY_REJECTION']) assert.ok(values.includes(v), `Falta el valor ${v}`);
    // Controles de integridad creados por la migración V2 (solo lectura).
    const controls = await db.$queryRawUnsafe(`SELECT
      (SELECT COUNT(*) FROM pg_constraint WHERE conname IN ('InventoryMovement_quantity_positive','InventoryMovement_shape_by_type','InventoryCustody_quantity_non_negative'))::int AS checks,
      (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('InventoryMovement_append_only','InventoryCustodyEvent_append_only','InventoryCustodyOperation_append_only','WarehouseStockOperation_append_only','WarehouseDiscrepancyEvent_append_only','WarehouseCatalogAudit_append_only','WarehouseReconciliationException_append_only') AND NOT tgisinternal AND tgenabled <> 'D')::int AS "appendOnly",
      (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('InventoryMovement_no_truncate','InventoryCustodyEvent_no_truncate','InventoryCustodyOperation_no_truncate','WarehouseStockOperation_no_truncate','WarehouseDiscrepancyEvent_no_truncate','WarehouseCatalogAudit_no_truncate','WarehouseReconciliationException_no_truncate','InventoryStockBalance_no_truncate') AND NOT tgisinternal AND tgenabled <> 'D')::int AS "noTruncate",
      (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('InventoryMovement_stock_balance','InventoryStockBalance_guard') AND NOT tgisinternal AND tgenabled <> 'D')::int AS balance,
      (SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'InventoryMovement_immutable')::int AS "legacyTrigger",
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('WarehouseDiscrepancyEvent','InventoryStockBalance','WarehouseCatalogAudit','WarehouseReconciliationException'))::int AS tables,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'InventoryCustody' AND column_name IN ('sourceMovementId','closingMovementId','parentCustodyId'))::int AS "custodyLinks",
      (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('yf_fixture_markers','yf_is_fixture','yf_append_only','yf_no_truncate','yf_stock_balance_apply','yf_stock_balance_maintain','yf_stock_balance_guard','yf_rebuild_inventory_stock_balance','yf_stock_balance_differences'))::int AS functions,
      (SELECT COUNT(*) FROM "yf_stock_balance_differences"())::int AS "balanceDifferences"`);
    assert.deepEqual(controls[0], { checks: 3, appendOnly: 7, noTruncate: 8, balance: 2, legacyTrigger: 0, tables: 4, custodyLinks: 3, functions: 9, balanceDifferences: 0 },
      'Faltan controles de integridad de la migración YF-003 V2 o la existencia materializada no cuadra con el libro mayor');
    const [rec] = await db.$queryRawUnsafe('SELECT checksum FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', MIGRATION);
    assert.equal(rec && rec.checksum, MIGRATION_SHA256, 'Checksum registrado distinto del archivo');
    await assertIsolatedIdentity(db);
    console.log(JSON.stringify({ migration: MIGRATION, warehouseStockOperationKinds: values, controles: controls[0] }));
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  console.error('DETENIDO: ' + clean(error && error.message || error));
  process.exitCode = 1;
});
