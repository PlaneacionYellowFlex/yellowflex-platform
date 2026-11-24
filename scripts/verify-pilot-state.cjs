const fs = require('node:fs');
const assert = require('node:assert/strict');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');
async function main() {
 const url = configureIsolatedConnection();
 const { PrismaClient } = require('@prisma/client');
 const db = new PrismaClient({ datasourceUrl: url });
 try {
  await assertIsolatedIdentity(db);
  const m = JSON.parse(fs.readFileSync('data/qa-pilot-local-manifest.json', 'utf8'));
  assert.equal(m.database, 'yellowflex_restore_test');
  const ids = m.profiles.map(p => p.userId);
  const state = await db.$transaction(async tx => {
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const chef = m.profiles.find(p => p.key === 'chef-externo');
   return {
    profiles: await tx.user.count({ where: { id: { in: ids }, active: true } }),
    temporaryPasswords: await tx.user.count({ where: { id: { in: ids }, passwordMustChange: true } }),
    openSessions: await tx.corporateSession.count({ where: { userId: { in: ids } } }),
    linkedEmployees: await tx.employee.count({ where: { corporateUserId: { in: ids } } }),
    externalChefEmployees: await tx.employee.count({ where: { corporateUserId: chef.userId } }),
    warehouseTestActorsRemaining: await tx.user.count({ where: { OR: [{ name: { startsWith: 'QA-IDEMPOTENCY-' } }, { name: { startsWith: 'QA-TRANSFER-' } }] } }),
    warehouseTestItemsRemaining: await tx.inventoryItem.count({ where: { OR: [{ code: { startsWith: 'QA-IDEMPOTENCY-' } }, { code: { startsWith: 'QA-WH-TRANSFER-' } }] } }),
    manualItem: await tx.inventoryItem.count({ where: { id: m.warehouseFixture.itemId, code: m.warehouseFixture.itemCode } }),
    manualCustody: await tx.inventoryCustody.count({ where: { id: m.warehouseFixture.custodyId, status: 'IN_TRANSIT' } }),
   };
  });
  assert.deepEqual(state, { profiles: 6, temporaryPasswords: 6, openSessions: 0, linkedEmployees: 4, externalChefEmployees: 0, warehouseTestActorsRemaining: 0, warehouseTestItemsRemaining: 0, manualItem: 1, manualCustody: 1 });
  assert.ok(fs.existsSync(m.credentialsFile), 'Falta el archivo privado de credenciales QA');
  console.log(JSON.stringify(state));
 } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('DETENIDO: estado QA no coincide con lo esperado.'); process.exitCode = 1; });
