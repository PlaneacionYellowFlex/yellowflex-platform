/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 · Diagnóstico de SOLO LECTURA de piezas de prueba en Almacén (antecedente: 22-001-005, A-1-1 → A-1-18).
// No modifica nada: transacción READ ONLY, destino QA aislado verificado (127.0.0.1:55432/yellowflex_restore_test).
// Uso: node scripts/warehouse-diagnostico-piezas-prueba.cjs [codigo=22-001-005] [origen=A-1-1] [destino=A-1-18]
const assert = require('node:assert/strict');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');

const [code = '22-001-005', originCode = 'A-1-1', targetCode = 'A-1-18'] = process.argv.slice(2);
const TEST_HINT = /(prueba|test|qa|ficticio|ficticia|simulad|demo)/i;
const n = v => (v === null || v === undefined ? null : Number(v));

(async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await assertIsolatedIdentity(db);
    const report = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const item = await tx.inventoryItem.findUnique({ where: { code } });
      if (!item) return { item: null };
      const movements = await tx.inventoryMovement.findMany({
        where: { itemId: item.id }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
        include: { originLocation: { select: { code: true } }, destinationLocation: { select: { code: true } }, actor: { select: { name: true } } },
      });
      const balances = new Map();
      for (const m of movements) {
        if (m.destinationLocation) balances.set(m.destinationLocation.code, (balances.get(m.destinationLocation.code) || 0) + Number(m.quantity));
        if (m.originLocation) balances.set(m.originLocation.code, (balances.get(m.originLocation.code) || 0) - Number(m.quantity));
      }
      const custodies = await tx.inventoryCustody.findMany({
        where: { itemId: item.id }, orderBy: { enteredAt: 'asc' },
        include: { custodianArea: { select: { code: true } }, events: { orderBy: { occurredAt: 'asc' }, select: { type: true, quantity: true, occurredAt: true, notes: true } } },
      });
      const counts = await tx.warehouseCount.findMany({
        where: { itemId: item.id }, orderBy: { launchedAt: 'asc' },
        include: { location: { select: { code: true } }, discrepancy: { include: { recounts: { select: { folio: true, status: true, countedQuantity: true, difference: true } } } } },
      });
      return { item, movements, balances: [...balances.entries()].map(([location, quantity]) => ({ location, quantity: Math.round(quantity * 1000) / 1000 })), custodies, counts };
    });
    await assertIsolatedIdentity(db);

    if (!report.item) {
      console.log(JSON.stringify({ itemCode: code, found: false, conclusion: `El artículo ${code} no existe en QA: no hay piezas que conciliar con ese código.` }, null, 2));
      return;
    }
    const at = loc => report.balances.find(b => b.location === loc)?.quantity ?? 0;
    const relevant = report.movements.filter(m => [m.originLocation?.code, m.destinationLocation?.code].some(c => c === originCode || c === targetCode));
    const transfers = relevant.filter(m => m.type === 'INTERNAL_TRANSFER' && m.originLocation?.code === originCode && m.destinationLocation?.code === targetCode);
    const testLike = report.movements.filter(m => TEST_HINT.test(`${m.referenceType || ''} ${m.referenceNumber || ''} ${m.notes || ''}`));
    const openCustody = report.custodies.filter(c => !c.closedAt);
    const openCounts = report.counts.filter(c => c.status === 'OPEN' || (c.discrepancy && c.discrepancy.status !== 'CLOSED'));
    const target = at(targetCode);
    const conclusion = transfers.length === 0
      ? `No hay transferencias ${originCode} → ${targetCode} del artículo ${code}: el antecedente no se confirma en QA. No ejecutar ajustes.`
      : target <= 0
        ? `Existencia teórica en ${targetCode}: ${target}. Las piezas ya no figuran en esa ubicación; revisar movimientos posteriores antes de cualquier acción.`
        : `Existencia teórica en ${targetCode}: ${target} ${report.item.baseUnit}. Confirmar físicamente y, si son ficticias, conciliar con el procedimiento controlado (conteo → diferencia REAL → reconteo → aprobación por tercero).`;
    const out = {
      itemCode: code, found: true, item: { id: report.item.id, description: report.item.description, unit: report.item.baseUnit, active: report.item.active },
      theoreticalBalances: report.balances, originBalance: at(originCode), targetBalance: target,
      transfersOriginToTarget: transfers.map(m => ({ folio: m.folio, quantity: n(m.quantity), occurredAt: m.occurredAt, actor: m.actor.name, reference: [m.referenceType, m.referenceNumber].filter(Boolean).join(' '), notes: m.notes })),
      movementsAtLocations: relevant.map(m => ({ folio: m.folio, type: m.type, quantity: n(m.quantity), from: m.originLocation?.code ?? null, to: m.destinationLocation?.code ?? null, occurredAt: m.occurredAt, actor: m.actor.name, notes: m.notes })),
      movementsMarkedAsTest: testLike.map(m => ({ folio: m.folio, type: m.type, quantity: n(m.quantity), notes: m.notes, reference: [m.referenceType, m.referenceNumber].filter(Boolean).join(' ') })),
      openCustodies: openCustody.map(c => ({ folio: c.folio, status: c.status, quantity: n(c.quantity), area: c.custodianArea.code, events: c.events.map(e => `${e.type} ${n(e.quantity)}`) })),
      countsAndDiscrepancies: report.counts.map(c => ({ folio: c.folio, location: c.location.code, status: c.status, expected: n(c.expectedQuantity), counted: n(c.countedQuantity), difference: n(c.difference),
        discrepancy: c.discrepancy ? { folio: c.discrepancy.folio, status: c.discrepancy.status, classification: c.discrepancy.classification, recounts: c.discrepancy.recounts.map(r => `${r.folio} ${r.status}`) } : null })),
      openWork: openCounts.map(c => c.folio),
      conclusion,
      note: 'Diagnóstico de solo lectura. No se modificó ningún registro.',
    };
    assert.ok(out);
    console.log(JSON.stringify(out, null, 2));
  } finally { await db.$disconnect(); }
})().catch(error => {
  console.error('DETENIDO: ' + String(error && error.message || error).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  process.exitCode = 1;
});
