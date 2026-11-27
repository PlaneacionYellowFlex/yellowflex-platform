/* eslint-disable @typescript-eslint/no-require-imports */
// YF-003 V2 · Diagnóstico y vinculación de custodias históricas con sus movimientos (entrega que las abrió y regreso que las cerró).
// Por omisión SOLO LEE y reporta. Con --aplicar vincula únicamente los casos INEQUÍVOCOS y solo en PostgreSQL aislado
// (127.0.0.1:55432/yellowflex_restore_test). Nunca crea custodias, nunca modifica ni elimina movimientos y nunca "adivina":
// los casos ambiguos y los huérfanos se reportan para revisión humana (o excepción documentada en la reconciliación).
// Uso: node --require ./tests/helpers/server-only-register.cjs --import tsx scripts/warehouse-custody-link.cjs [--aplicar] [--salida archivo.json] [--marcador QA-...]
const { writeFileSync } = require('node:fs');
const { configureIsolatedConnection, assertIsolatedIdentity } = require('../tests/helpers/isolated-postgres.cjs');

const APPLY = process.argv.includes('--aplicar');
const outIdx = process.argv.indexOf('--salida');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : null;
const mkIdx = process.argv.indexOf('--marcador');
/** Opcional: limita el análisis a artículos cuyo código empieza con el marcador (pruebas con datos sintéticos). */
const SCOPE = mkIdx > 0 ? process.argv[mkIdx + 1] : null;
const SCOPE_SQL = `AND ($1::text IS NULL OR EXISTS (SELECT 1 FROM "InventoryItem" si WHERE si."id" = c."itemId" AND left(si."code", length($1::text)) = $1::text))`;
const WINDOW_SECONDS = 120;

/** Candidatos de entrega para custodias de origen sin vínculo: mismo artículo y cantidad original, referencia igual y ventana de tiempo. */
const SOURCE_CANDIDATES = `
  WITH c AS (
    SELECT c."id", c."folio", c."itemId", c."referenceNumber", c."enteredAt", c."status"::text AS status, c."quantity" AS current,
           (SELECT e."quantity" FROM "InventoryCustodyEvent" e WHERE e."custodyId" = c."id" AND e."type" = 'CREATED' ORDER BY e."occurredAt", e."createdAt" LIMIT 1) AS original,
           (SELECT e."reason" FROM "InventoryCustodyEvent" e WHERE e."custodyId" = c."id" AND e."type" = 'TRANSFERRED' ORDER BY e."occurredAt", e."createdAt" LIMIT 1) AS "transferReason"
      FROM "InventoryCustody" c WHERE c."sourceMovementId" IS NULL AND c."parentCustodyId" IS NULL ${SCOPE_SQL})
  SELECT c."id" AS "custodyId", c."folio" AS "custodyFolio", c.status, c.original::text AS "originalQuantity", m."id" AS "movementId", m."folio" AS "movementFolio",
         (c."transferReason" IS NOT NULL AND position(m."folio" in c."transferReason") > 0) AS "folioEnEvento"
    FROM c LEFT JOIN "InventoryMovement" m
      ON m."type" = 'OPERATIONAL_HANDOFF' AND m."itemId" = c."itemId"
     AND NOT EXISTS (SELECT 1 FROM "InventoryCustody" x WHERE x."sourceMovementId" = m."id")
     AND ( (c."transferReason" IS NOT NULL AND position(m."folio" in c."transferReason") > 0)
        OR (c.original IS NOT NULL AND m."quantity" = c.original AND m."referenceNumber" IS NOT DISTINCT FROM c."referenceNumber"
            AND abs(extract(epoch FROM (m."occurredAt" - c."enteredAt"))) <= ${WINDOW_SECONDS}) )
   ORDER BY c."folio", m."folio"`;

/** Candidatos de regreso para custodias cerradas por devolución sin vínculo de cierre. */
const CLOSING_CANDIDATES = `
  WITH c AS (
    SELECT c."id", c."folio", c."itemId", c."closedAt",
           (SELECT e."quantity" FROM "InventoryCustodyEvent" e WHERE e."custodyId" = c."id" AND e."type" = 'RETURNED' ORDER BY e."occurredAt" DESC, e."createdAt" DESC LIMIT 1) AS returned
      FROM "InventoryCustody" c
     WHERE c."closingMovementId" IS NULL AND c."closedAt" IS NOT NULL
       AND EXISTS (SELECT 1 FROM "InventoryCustodyEvent" e WHERE e."custodyId" = c."id" AND e."type" = 'RETURNED') ${SCOPE_SQL})
  SELECT c."id" AS "custodyId", c."folio" AS "custodyFolio", c.returned::text AS "returnedQuantity", m."id" AS "movementId", m."folio" AS "movementFolio"
    FROM c LEFT JOIN "InventoryMovement" m
      ON m."type" = 'OPERATIONAL_RETURN' AND m."itemId" = c."itemId" AND m."quantity" = c.returned
     AND abs(extract(epoch FROM (m."occurredAt" - c."closedAt"))) <= ${WINDOW_SECONDS}
     AND NOT EXISTS (SELECT 1 FROM "InventoryCustody" x WHERE x."closingMovementId" = m."id")
   ORDER BY c."folio", m."folio"`;

function classify(rows) {
  const byCustody = new Map(); const byMovement = new Map();
  for (const r of rows) {
    if (!byCustody.has(r.custodyId)) byCustody.set(r.custodyId, { ...r, candidates: [] });
    if (r.movementId) {
      byCustody.get(r.custodyId).candidates.push({ movementId: r.movementId, movementFolio: r.movementFolio, folioEnEvento: r.folioEnEvento ?? false });
      byMovement.set(r.movementId, (byMovement.get(r.movementId) ?? 0) + 1);
    }
  }
  const unambiguous = []; const ambiguous = []; const orphans = [];
  for (const c of byCustody.values()) {
    const { candidates } = c;
    const custody = { custodyId: c.custodyId, custodyFolio: c.custodyFolio, status: c.status, originalQuantity: c.originalQuantity, returnedQuantity: c.returnedQuantity };
    if (candidates.length === 0) orphans.push(custody);
    else if (candidates.length === 1 && byMovement.get(candidates[0].movementId) === 1) unambiguous.push({ ...custody, movementId: candidates[0].movementId, movementFolio: candidates[0].movementFolio, evidencia: candidates[0].folioEnEvento ? 'folio del movimiento en el evento de transferencia' : 'artículo, cantidad, referencia y hora' });
    else ambiguous.push({ ...custody, candidates });
  }
  return { unambiguous, ambiguous, orphans };
}

(async () => {
  const url = configureIsolatedConnection();
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasourceUrl: url });
  const report = { alcance: SCOPE ? `artículos ${SCOPE}*` : 'todo el inventario', modo: APPLY ? 'APLICAR (solo inequívocos)' : 'DIAGNÓSTICO (solo lectura)', generado: new Date().toISOString(), ventanaSegundos: WINDOW_SECONDS };
  try {
    await assertIsolatedIdentity(db);
    const source = classify(await db.$queryRawUnsafe(SOURCE_CANDIDATES, SCOPE));
    const closing = classify(await db.$queryRawUnsafe(CLOSING_CANDIDATES, SCOPE));
    const handoffsWithout = await db.$queryRawUnsafe(`SELECT m."folio", i."code" AS item, m."quantity"::text AS quantity, m."occurredAt",
        EXISTS (SELECT 1 FROM "WarehouseReconciliationException" e WHERE e."checkCode" = 'R3' AND e."subjectType" = 'MOVEMENT' AND e."subjectId" = m."id") AS documentada
      FROM "InventoryMovement" m JOIN "InventoryItem" i ON i."id" = m."itemId"
     WHERE m."type" = 'OPERATIONAL_HANDOFF' AND NOT EXISTS (SELECT 1 FROM "InventoryCustody" c WHERE c."sourceMovementId" = m."id")
       AND ($1::text IS NULL OR left(i."code", length($1::text)) = $1::text) ORDER BY m."occurredAt"`, SCOPE);
    report.entrega = { inequivocos: source.unambiguous.length, ambiguos: source.ambiguous.length, huerfanos: source.orphans.length, detalle: source };
    report.cierre = { inequivocos: closing.unambiguous.length, ambiguos: closing.ambiguous.length, sinCandidato: closing.orphans.length, detalle: closing };
    report.entregasSinCustodia = { total: handoffsWithout.length, documentadas: handoffsWithout.filter(h => h.documentada).length, detalle: handoffsWithout };
    if (APPLY) {
      const applied = await db.$transaction(async tx => {
        let s = 0; let c = 0;
        for (const u of source.unambiguous) s += await tx.$executeRawUnsafe(`UPDATE "InventoryCustody" SET "sourceMovementId" = $1 WHERE "id" = $2 AND "sourceMovementId" IS NULL`, u.movementId, u.custodyId);
        for (const u of closing.unambiguous) c += await tx.$executeRawUnsafe(`UPDATE "InventoryCustody" SET "closingMovementId" = $1 WHERE "id" = $2 AND "closingMovementId" IS NULL`, u.movementId, u.custodyId);
        return { entrega: s, cierre: c };
      });
      report.aplicado = applied;
    }
    report.nota = 'No se crean custodias ni se modifican movimientos. Ambiguos y huérfanos requieren revisión; una entrega histórica sin custodia se documenta como excepción (R3) desde la reconciliación.';
    const text = JSON.stringify(report, null, 2);
    if (OUT) writeFileSync(OUT, text);
    console.log(JSON.stringify({ modo: report.modo, entrega: { inequivocos: report.entrega.inequivocos, ambiguos: report.entrega.ambiguos, huerfanos: report.entrega.huerfanos },
      cierre: { inequivocos: report.cierre.inequivocos, ambiguos: report.cierre.ambiguos, sinCandidato: report.cierre.sinCandidato },
      entregasSinCustodia: { total: report.entregasSinCustodia.total, documentadas: report.entregasSinCustodia.documentadas }, aplicado: report.aplicado ?? null }));
  } finally { await db.$disconnect(); }
})().catch(e => { console.error('DETENIDO: ' + String(e && e.message || e).replace(/postgres(ql)?:\/\/\S+/g, '<url>')); process.exitCode = 1; });
