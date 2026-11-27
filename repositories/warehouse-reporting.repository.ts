import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * YF-003 · Consultas de SOLO LECTURA: Kardex, búsqueda de movimientos, indicadores y reconciliación.
 * Todas las cantidades viajan como texto decimal exacto (sin punto flotante) y nunca se suman unidades distintas.
 * Ninguna función de este archivo escribe en la base de datos.
 */
type Client = typeof db | Prisma.TransactionClient;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export type MovementCursor = { occurredAt: string; createdAt: string; id: string };
export const encodeCursor = (c: MovementCursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
export function decodeCursor(raw: string | null): MovementCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as MovementCursor;
    if (typeof c.id !== "string" || Number.isNaN(Date.parse(c.occurredAt)) || Number.isNaN(Date.parse(c.createdAt))) return null;
    return c;
  } catch { return null; }
}

export type MovementFilters = {
  itemId?: string | null; locationId?: string | null; type?: string | null; actorId?: string | null;
  reference?: string | null; from?: Date | null; to?: Date | null;
};

const MOVEMENT_TYPES = ["INITIAL_BALANCE", "EXTERNAL_RECEIPT", "EXTERNAL_ISSUE", "INTERNAL_TRANSFER", "OPERATIONAL_HANDOFF", "OPERATIONAL_RETURN", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];
export const isMovementType = (v: string) => MOVEMENT_TYPES.includes(v);

function whereFor(f: MovementFilters) {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.itemId) parts.push(Prisma.sql`m."itemId" = ${f.itemId}`);
  if (f.locationId) parts.push(Prisma.sql`(m."originLocationId" = ${f.locationId} OR m."destinationLocationId" = ${f.locationId})`);
  if (f.type) parts.push(Prisma.sql`m."type"::text = ${f.type}`);
  if (f.actorId) parts.push(Prisma.sql`m."actorId" = ${f.actorId}`);
  if (f.reference) parts.push(Prisma.sql`(m."referenceNumber" ILIKE ${"%" + f.reference + "%"} OR m."folio" ILIKE ${"%" + f.reference + "%"})`);
  if (f.from) parts.push(Prisma.sql`m."occurredAt" >= ${f.from}`);
  if (f.to) parts.push(Prisma.sql`m."occurredAt" < ${f.to}`);
  return Prisma.join(parts, " AND ");
}

type MovementRow = {
  id: string; folio: string; type: string; quantity: unknown; unit: string; occurredAt: Date; createdAt: Date;
  itemId: string; itemCode: string; itemDescription: string; originCode: string | null; destinationCode: string | null;
  referenceType: string | null; referenceNumber: string | null; notes: string | null; actorName: string | null; reversedBy: string | null;
};

/**
 * Búsqueda de movimientos con paginación por cursor (orden estable: fecha, creación, id — sin duplicados ni omisiones entre
 * páginas aunque se registren movimientos nuevos mientras se consulta).
 */
export async function searchMovements(filters: MovementFilters, cursor: MovementCursor | null, limit: number, client: Client = db) {
  const take = Math.min(Math.max(Math.trunc(limit) || 100, 1), 1000);
  const after = cursor
    ? Prisma.sql`AND (m."occurredAt", m."createdAt", m."id") < (${new Date(cursor.occurredAt)}, ${new Date(cursor.createdAt)}, ${cursor.id})`
    : Prisma.empty;
  const rows = await client.$queryRaw<MovementRow[]>`
    SELECT m."id", m."folio", m."type"::text AS "type", m."quantity", m."unit", m."occurredAt", m."createdAt",
           m."itemId", i."code" AS "itemCode", i."description" AS "itemDescription",
           o."code" AS "originCode", d."code" AS "destinationCode", m."referenceType", m."referenceNumber", m."notes",
           u."name" AS "actorName",
           (SELECT r."folio" FROM "InventoryMovement" r WHERE r."referenceType" = 'REVERSO' AND r."referenceNumber" = m."folio" LIMIT 1) AS "reversedBy"
      FROM "InventoryMovement" m
      JOIN "InventoryItem" i ON i."id" = m."itemId"
      LEFT JOIN "WarehouseLocation" o ON o."id" = m."originLocationId"
      LEFT JOIN "WarehouseLocation" d ON d."id" = m."destinationLocationId"
      LEFT JOIN "User" u ON u."id" = m."actorId"
     WHERE ${whereFor(filters)} ${after}
     ORDER BY m."occurredAt" DESC, m."createdAt" DESC, m."id" DESC
     LIMIT ${take + 1}`;
  const page = rows.slice(0, take).map(r => ({ ...r, quantity: str(r.quantity) as string, occurredAt: r.occurredAt.toISOString(), createdAt: r.createdAt.toISOString() }));
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > take && last ? encodeCursor({ occurredAt: last.occurredAt, createdAt: last.createdAt, id: last.id }) : null };
}

export async function countMovements(filters: MovementFilters, client: Client = db) {
  const [r] = await client.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "InventoryMovement" m WHERE ${whereFor(filters)}`;
  return Number(r?.n ?? 0);
}

/**
 * Kardex de un artículo: cada movimiento con su efecto (+/−) y el saldo acumulado. Sin ubicación, el saldo es la existencia
 * total controlada en Almacén (las transferencias internas suman cero). Con ubicación, el saldo de esa ubicación.
 * El material entregado a Producción sale del saldo de Almacén y se reporta como custodia aparte.
 */
export async function kardex(itemId: string, locationId: string | null, cursor: { seq: number } | null, limit: number, client: Client = db) {
  const take = Math.min(Math.max(Math.trunc(limit) || 200, 1), 2000);
  const delta = locationId
    ? Prisma.sql`(CASE WHEN m."destinationLocationId" = ${locationId} THEN m."quantity" ELSE 0 END) - (CASE WHEN m."originLocationId" = ${locationId} THEN m."quantity" ELSE 0 END)`
    : Prisma.sql`(CASE WHEN m."destinationLocationId" IS NOT NULL THEN m."quantity" ELSE 0 END) - (CASE WHEN m."originLocationId" IS NOT NULL THEN m."quantity" ELSE 0 END)`;
  const scope = locationId ? Prisma.sql`AND (m."originLocationId" = ${locationId} OR m."destinationLocationId" = ${locationId})` : Prisma.empty;
  const rows = await client.$queryRaw<(MovementRow & { seq: bigint; delta: unknown; balance: unknown })[]>`
    WITH k AS (
      SELECT m.*, ${delta} AS "delta",
             ROW_NUMBER() OVER (ORDER BY m."occurredAt", m."createdAt", m."id") AS "seq"
        FROM "InventoryMovement" m WHERE m."itemId" = ${itemId} ${scope}
    ), b AS (
      SELECT k.*, SUM(k."delta") OVER (ORDER BY k."seq") AS "balance" FROM k
    )
    SELECT b."id", b."folio", b."type"::text AS "type", b."quantity", b."unit", b."occurredAt", b."createdAt", b."seq", b."delta", b."balance",
           o."code" AS "originCode", d."code" AS "destinationCode", b."referenceType", b."referenceNumber", b."notes", u."name" AS "actorName",
           (SELECT r."folio" FROM "InventoryMovement" r WHERE r."referenceType" = 'REVERSO' AND r."referenceNumber" = b."folio" LIMIT 1) AS "reversedBy"
      FROM b
      LEFT JOIN "WarehouseLocation" o ON o."id" = b."originLocationId"
      LEFT JOIN "WarehouseLocation" d ON d."id" = b."destinationLocationId"
      LEFT JOIN "User" u ON u."id" = b."actorId"
     WHERE b."seq" > ${cursor?.seq ?? 0}
     ORDER BY b."seq"
     LIMIT ${take + 1}`;
  const page = rows.slice(0, take).map(r => ({
    id: r.id, seq: Number(r.seq), folio: r.folio, type: r.type, quantity: str(r.quantity) as string, delta: str(r.delta) as string,
    balance: str(r.balance) as string, unit: r.unit, occurredAt: r.occurredAt.toISOString(), originCode: r.originCode, destinationCode: r.destinationCode,
    referenceType: r.referenceType, referenceNumber: r.referenceNumber, notes: r.notes, actorName: r.actorName, reversedBy: r.reversedBy,
  }));
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > take && last ? last.seq : null };
}

/**
 * Existencias por artículo y ubicación (YF-003 V2: desde la existencia materializada que mantiene el disparador del libro
 * mayor en la misma transacción). Incluye artículos o ubicaciones inactivos que aún tienen saldo.
 */
export async function stockByLocation(client: Client = db) {
  const rows = await client.$queryRaw<{ itemId: string; itemCode: string; itemDescription: string; unit: string; itemActive: boolean;
    locationId: string; locationCode: string; locationActive: boolean; warehouseCode: string; quantity: unknown }[]>`
    SELECT b."itemId", i."code" AS "itemCode", i."description" AS "itemDescription", i."baseUnit" AS "unit", i."active" AS "itemActive",
           b."locationId", l."code" AS "locationCode", (l."active" AND w."active") AS "locationActive", w."code" AS "warehouseCode", b."quantity"
      FROM "InventoryStockBalance" b JOIN "InventoryItem" i ON i."id" = b."itemId"
      JOIN "WarehouseLocation" l ON l."id" = b."locationId" JOIN "Warehouse" w ON w."id" = l."warehouseId"
     WHERE b."quantity" <> 0
     ORDER BY i."code", w."code", l."code"`;
  return rows.map(r => ({ ...r, quantity: str(r.quantity) as string }));
}

export type StockFilters = { itemId?: string | null; locationId?: string | null; search?: string | null; includeInactive?: boolean };

/**
 * Consulta habitual de existencias: filtrada y paginada por cursor estable (código de artículo, id de ubicación).
 * Lee la existencia materializada; nunca recorre el libro mayor completo.
 */
export async function stockPage(filters: StockFilters, cursor: { itemCode: string; locationId: string } | null, limit: number, client: Client = db) {
  const take = Math.min(Math.max(Math.trunc(limit) || 200, 1), 2000);
  const parts: Prisma.Sql[] = [Prisma.sql`b."quantity" <> 0`];
  if (filters.itemId) parts.push(Prisma.sql`b."itemId" = ${filters.itemId}`);
  if (filters.locationId) parts.push(Prisma.sql`b."locationId" = ${filters.locationId}`);
  // Búsqueda: primero los artículos y ubicaciones que coinciden (catálogos pequeños) y después sus saldos por índice,
  // en lugar de evaluar el texto contra cada fila artículo-ubicación.
  const like = filters.search ? "%" + filters.search + "%" : null;
  if (like) parts.push(Prisma.sql`(b."itemId", b."locationId") IN (SELECT k."itemId", k."locationId" FROM keys k)`);
  if (cursor) parts.push(Prisma.sql`(i."code", b."locationId") > (${cursor.itemCode}, ${cursor.locationId})`);
  const keys = like ? Prisma.sql`WITH mi AS MATERIALIZED (SELECT "id" FROM "InventoryItem" WHERE "code" ILIKE ${like} OR "description" ILIKE ${like}),
         ml AS MATERIALIZED (SELECT "id" FROM "WarehouseLocation" WHERE "code" ILIKE ${like}),
         keys AS MATERIALIZED (SELECT s."itemId", s."locationId" FROM "InventoryStockBalance" s WHERE s."itemId" IN (SELECT "id" FROM mi) AND s."quantity" <> 0
                    UNION SELECT s."itemId", s."locationId" FROM "InventoryStockBalance" s WHERE s."locationId" IN (SELECT "id" FROM ml) AND s."quantity" <> 0)` : Prisma.empty;
  const rows = await client.$queryRaw<{ itemId: string; itemCode: string; itemDescription: string; unit: string; itemActive: boolean;
    locationId: string; locationCode: string; locationActive: boolean; warehouseCode: string; quantity: unknown }[]>`
    ${keys}
    SELECT b."itemId", i."code" AS "itemCode", i."description" AS "itemDescription", i."baseUnit" AS "unit", i."active" AS "itemActive",
           b."locationId", l."code" AS "locationCode", (l."active" AND w."active") AS "locationActive", w."code" AS "warehouseCode", b."quantity"
      FROM "InventoryStockBalance" b JOIN "InventoryItem" i ON i."id" = b."itemId"
      JOIN "WarehouseLocation" l ON l."id" = b."locationId" JOIN "Warehouse" w ON w."id" = l."warehouseId"
     WHERE ${Prisma.join(parts, " AND ")}
     ORDER BY i."code", b."locationId"
     LIMIT ${take + 1}`;
  const page = rows.slice(0, take).map(r => ({ ...r, quantity: str(r.quantity) as string }));
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > take && last ? Buffer.from(JSON.stringify({ itemCode: last.itemCode, locationId: last.locationId })).toString("base64url") : null };
}

export function decodeStockCursor(raw: string | null) {
  if (!raw) return null;
  try { const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); return typeof c.itemCode === "string" && typeof c.locationId === "string" ? c as { itemCode: string; locationId: string } : null; }
  catch { return null; }
}

/** Totales por artículo (todas las ubicaciones de Almacén) desde la existencia materializada. */
export async function stockTotalsByItem(client: Client = db) {
  const rows = await client.$queryRaw<{ itemId: string; quantity: unknown; locations: bigint }[]>`
    SELECT "itemId", SUM("quantity") AS quantity, COUNT(*) FILTER (WHERE "quantity" <> 0)::bigint AS locations
      FROM "InventoryStockBalance" GROUP BY "itemId"`;
  return new Map(rows.map(r => [r.itemId, { quantity: str(r.quantity) as string, locations: Number(r.locations) }]));
}

/**
 * Indicadores deterministas del tablero (fuente: libro mayor, custodias, conteos y expedientes). Las cantidades se agrupan
 * por unidad de medida; nunca se suman kilogramos con piezas.
 */
export async function dashboardIndicators(client: Client = db, now = new Date()) {
  const days90 = new Date(now.getTime() - 90 * 86400000);
  const [catalog] = await client.$queryRaw<{ items: bigint; locations: bigint }[]>`
    SELECT (SELECT COUNT(*) FROM "InventoryItem" WHERE "active")::bigint AS items,
           (SELECT COUNT(*) FROM "WarehouseLocation" l JOIN "Warehouse" w ON w."id" = l."warehouseId" WHERE l."active" AND w."active")::bigint AS locations`;
  const stockByUnit = await client.$queryRaw<{ unit: string; quantity: unknown; items: bigint }[]>`
    WITH s AS (SELECT "itemId", SUM("quantity") AS q FROM "InventoryStockBalance" GROUP BY "itemId" HAVING SUM("quantity") <> 0)
    SELECT i."baseUnit" AS unit, SUM(s.q) AS quantity, COUNT(*)::bigint AS items FROM s JOIN "InventoryItem" i ON i."id" = s."itemId"
     GROUP BY i."baseUnit" ORDER BY i."baseUnit"`;
  const custodyByStatus = await client.$queryRaw<{ status: string; unit: string; quantity: unknown; n: bigint; oldest: Date | null }[]>`
    SELECT c."status"::text AS status, c."unit", SUM(c."quantity") AS quantity, COUNT(*)::bigint AS n, MIN(c."enteredAt") AS oldest
      FROM "InventoryCustody" c WHERE c."closedAt" IS NULL AND c."status" <> 'CLOSED'
     GROUP BY c."status", c."unit" ORDER BY c."status", c."unit"`;
  const [counts] = await client.$queryRaw<{ open: bigint; oldestOpen: Date | null; done90: bigint; exact90: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE "status" = 'OPEN')::bigint AS open, MIN("launchedAt") FILTER (WHERE "status" = 'OPEN') AS "oldestOpen",
           COUNT(*) FILTER (WHERE "status" = 'COMPLETED' AND "countedAt" >= ${days90})::bigint AS done90,
           COUNT(*) FILTER (WHERE "status" = 'COMPLETED' AND "countedAt" >= ${days90} AND "difference" = 0)::bigint AS exact90
      FROM "WarehouseCount"`;
  const [disc] = await client.$queryRaw<{ open: bigint; oldest: Date | null; awaiting: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE d."status" <> 'CLOSED')::bigint AS open,
           MIN(d."createdAt") FILTER (WHERE d."status" <> 'CLOSED') AS oldest,
           COUNT(*) FILTER (WHERE d."status" <> 'CLOSED' AND d."classification" = 'REAL'
             AND COALESCE(d."cause", '') <> '' AND COALESCE(d."resolution", '') <> ''
             AND EXISTS (SELECT 1 FROM "WarehouseDiscrepancyRecount" r WHERE r."discrepancyId" = d."id" AND r."status" = 'COMPLETED'
                          AND r."completedAt" > COALESCE((SELECT MAX(e."createdAt") FROM "WarehouseDiscrepancyEvent" e
                                                          WHERE e."discrepancyId" = d."id" AND e."type" = 'ADJUSTMENT_REJECTED'), 'epoch'))
             AND NOT EXISTS (SELECT 1 FROM "WarehouseDiscrepancyRecount" r WHERE r."discrepancyId" = d."id" AND r."status" = 'OPEN'))::bigint AS awaiting
      FROM "WarehouseDiscrepancy" d`;
  const [idle] = await client.$queryRaw<{ n: bigint }[]>`
    WITH s AS (SELECT "itemId" FROM "InventoryStockBalance" GROUP BY "itemId" HAVING SUM("quantity") > 0)
    SELECT COUNT(*)::bigint AS n FROM s WHERE NOT EXISTS (
      SELECT 1 FROM "InventoryMovement" m WHERE m."itemId" = s."itemId" AND m."occurredAt" >= ${days90})`;
  const done90 = Number(counts?.done90 ?? 0);
  return {
    generatedAt: now.toISOString(),
    activeItems: Number(catalog?.items ?? 0),
    activeLocations: Number(catalog?.locations ?? 0),
    stockByUnit: stockByUnit.map(r => ({ unit: r.unit, quantity: str(r.quantity), items: Number(r.items) })),
    custodyByStatus: custodyByStatus.map(r => ({ status: r.status, unit: r.unit, quantity: str(r.quantity), count: Number(r.n), oldest: r.oldest?.toISOString() ?? null })),
    openCounts: Number(counts?.open ?? 0),
    oldestOpenCount: counts?.oldestOpen?.toISOString() ?? null,
    openDiscrepancies: Number(disc?.open ?? 0),
    oldestOpenDiscrepancy: disc?.oldest?.toISOString() ?? null,
    adjustmentsAwaitingDecision: Number(disc?.awaiting ?? 0),
    countAccuracy90d: done90 > 0 ? { exact: Number(counts?.exact90 ?? 0), completed: done90, percent: Math.round((Number(counts?.exact90 ?? 0) / done90) * 1000) / 10 } : null,
    itemsWithoutMovement90d: Number(idle?.n ?? 0),
  };
}

export type ReconciliationFinding = { check: string; severity: "CRITICO" | "ALTO" | "INFO"; count: number; sample: unknown[] };

/**
 * Reconciliación de SOLO LECTURA entre libro mayor, custodias y expedientes. Nunca corrige: solo reporta.
 * Invariantes:
 *  R1 existencia por artículo y ubicación ≥ 0
 *  R2 todo movimiento con cantidad > 0 y forma válida para su tipo (incluye históricos previos a las restricciones)
 *  R3 entregado a Producción − devuelto − consumido = saldo abierto en custodia (por artículo)
 *  R4 custodias abiertas con cantidad > 0; cerradas con cantidad 0
 *  R5 un movimiento se revierte a lo sumo una vez
 *  R6 expediente REAL cerrado ⇒ aprobado; ajuste vinculado coincide con la cantidad aprobada
 *  R7 toda entrega tiene su custodia vinculada (o una excepción histórica documentada) y viceversa
 *  R8 existencia materializada = libro mayor, sin ninguna diferencia
 */
export async function reconcile(client: Client = db) {
  const findings: ReconciliationFinding[] = [];
  const push = (check: string, severity: ReconciliationFinding["severity"], rows: unknown[]) =>
    findings.push({ check, severity, count: rows.length, sample: rows.slice(0, 20) });

  push("R1 existencia negativa por artículo y ubicación", "CRITICO", (await client.$queryRaw<unknown[]>`
    WITH f AS (
      SELECT "itemId", "destinationLocationId" AS loc, "quantity" AS q FROM "InventoryMovement" WHERE "destinationLocationId" IS NOT NULL
      UNION ALL SELECT "itemId", "originLocationId", -"quantity" FROM "InventoryMovement" WHERE "originLocationId" IS NOT NULL
    )
    SELECT i."code" AS item, l."code" AS location, SUM(f.q)::text AS quantity
      FROM f JOIN "InventoryItem" i ON i."id" = f."itemId" JOIN "WarehouseLocation" l ON l."id" = f.loc
     GROUP BY i."code", l."code" HAVING SUM(f.q) < 0`));

  push("R2 movimiento con cantidad o forma inválida", "CRITICO", (await client.$queryRaw<unknown[]>`
    SELECT "folio", "type"::text AS type, "quantity"::text AS quantity FROM "InventoryMovement"
     WHERE "quantity" <= 0
        OR ("type" IN ('INITIAL_BALANCE','EXTERNAL_RECEIPT','ADJUSTMENT_IN','OPERATIONAL_RETURN') AND ("originLocationId" IS NOT NULL OR "destinationLocationId" IS NULL))
        OR ("type" IN ('EXTERNAL_ISSUE','ADJUSTMENT_OUT','OPERATIONAL_HANDOFF') AND ("originLocationId" IS NULL OR "destinationLocationId" IS NOT NULL))
        OR ("type" = 'INTERNAL_TRANSFER' AND ("originLocationId" IS NULL OR "destinationLocationId" IS NULL OR "originLocationId" = "destinationLocationId"))
     LIMIT 200`));

  // R3: las entregas históricas sin custodia DOCUMENTADAS como excepción autorizada (R3/MOVEMENT) se descuentan y se reportan
  // aparte; no se fabrica ninguna custodia ni se altera el historial.
  push("R3 custodia no cuadra con entregas, devoluciones y consumos", "CRITICO", (await client.$queryRaw<unknown[]>`
    WITH h AS (SELECT "itemId", SUM("quantity") q FROM "InventoryMovement" WHERE "type" = 'OPERATIONAL_HANDOFF' GROUP BY "itemId"),
         r AS (SELECT "itemId", SUM("quantity") q FROM "InventoryMovement" WHERE "type" = 'OPERATIONAL_RETURN' GROUP BY "itemId"),
         c AS (SELECT cu."itemId", SUM(e."quantity") q FROM "InventoryCustodyEvent" e JOIN "InventoryCustody" cu ON cu."id" = e."custodyId"
                WHERE e."type" IN ('CONSUMED','CONSUMED_IN_TEST') GROUP BY cu."itemId"),
         o AS (SELECT "itemId", SUM("quantity") q FROM "InventoryCustody" WHERE "closedAt" IS NULL AND "status" <> 'CLOSED' GROUP BY "itemId"),
         x AS (SELECT m."itemId", SUM(m."quantity") q FROM "WarehouseReconciliationException" e JOIN "InventoryMovement" m ON m."id" = e."subjectId"
                WHERE e."checkCode" = 'R3' AND e."subjectType" = 'MOVEMENT' GROUP BY m."itemId"),
         ids AS (SELECT "itemId" FROM h UNION SELECT "itemId" FROM r UNION SELECT "itemId" FROM c UNION SELECT "itemId" FROM o)
    SELECT i."code" AS item, COALESCE(h.q,0)::text AS entregado, COALESCE(r.q,0)::text AS devuelto, COALESCE(c.q,0)::text AS consumido,
           COALESCE(o.q,0)::text AS "enCustodia", COALESCE(x.q,0)::text AS documentado,
           (COALESCE(h.q,0) - COALESCE(r.q,0) - COALESCE(c.q,0) - COALESCE(o.q,0) - COALESCE(x.q,0))::text AS diferencia
      FROM ids JOIN "InventoryItem" i ON i."id" = ids."itemId"
      LEFT JOIN h ON h."itemId" = ids."itemId" LEFT JOIN r ON r."itemId" = ids."itemId"
      LEFT JOIN c ON c."itemId" = ids."itemId" LEFT JOIN o ON o."itemId" = ids."itemId" LEFT JOIN x ON x."itemId" = ids."itemId"
     WHERE COALESCE(h.q,0) - COALESCE(r.q,0) - COALESCE(c.q,0) - COALESCE(o.q,0) - COALESCE(x.q,0) <> 0`));

  push("R4 custodia con estado y cantidad incongruentes", "ALTO", (await client.$queryRaw<unknown[]>`
    SELECT "folio", "status"::text AS status, "quantity"::text AS quantity FROM "InventoryCustody"
     WHERE ("status" <> 'CLOSED' AND "closedAt" IS NULL AND "quantity" <= 0) OR (("status" = 'CLOSED' OR "closedAt" IS NOT NULL) AND "quantity" <> 0)
     LIMIT 200`));

  push("R5 movimiento revertido más de una vez", "CRITICO", (await client.$queryRaw<unknown[]>`
    SELECT "referenceNumber" AS original, COUNT(*)::int AS reversos FROM "InventoryMovement"
     WHERE "referenceType" = 'REVERSO' GROUP BY "referenceNumber" HAVING COUNT(*) > 1`));

  push("R6 expediente cerrado incongruente con su ajuste", "ALTO", (await client.$queryRaw<unknown[]>`
    SELECT d."folio", d."classification", d."approvedQuantity"::text AS aprobado, m."quantity"::text AS ajuste
      FROM "WarehouseDiscrepancy" d LEFT JOIN "InventoryMovement" m ON m."id" = d."movementId"
     WHERE d."status" = 'CLOSED' AND d."classification" = 'REAL'
       AND (d."approvedById" IS NULL OR COALESCE(d."approvedQuantity", 0) <> COALESCE(m."quantity", 0))`));

  // R7: vínculo explícito entrega ↔ custodia. Entregas sin custodia vinculada (excepto excepciones documentadas) y custodias
  // de origen sin movimiento de entrega vinculado (históricas sin vincular: ver script de vinculación).
  push("R7 entrega sin custodia vinculada", "ALTO", (await client.$queryRaw<unknown[]>`
    SELECT m."id" AS "movementId", m."folio", i."code" AS item, m."quantity"::text AS quantity, m."occurredAt" FROM "InventoryMovement" m JOIN "InventoryItem" i ON i."id" = m."itemId"
     WHERE m."type" = 'OPERATIONAL_HANDOFF'
       AND NOT EXISTS (SELECT 1 FROM "InventoryCustody" c WHERE c."sourceMovementId" = m."id")
       AND NOT EXISTS (SELECT 1 FROM "WarehouseReconciliationException" e WHERE e."checkCode" = 'R3' AND e."subjectType" = 'MOVEMENT' AND e."subjectId" = m."id")
     ORDER BY m."occurredAt" LIMIT 200`));
  push("R7 custodia sin movimiento de entrega vinculado", "ALTO", (await client.$queryRaw<unknown[]>`
    SELECT c."folio", c."status"::text AS status, c."quantity"::text AS quantity FROM "InventoryCustody" c
     WHERE c."sourceMovementId" IS NULL AND c."parentCustodyId" IS NULL ORDER BY c."createdAt" LIMIT 200`));
  // R8: existencia materializada idéntica al libro mayor (diferencia exacta; cualquier escritura fuera del disparador aparece aquí).
  push("R8 existencia materializada distinta del libro mayor", "CRITICO", (await client.$queryRaw<unknown[]>`
    SELECT d."itemId", d."locationId", d.ledger::text AS "libroMayor", d.materialized::text AS materializada FROM "yf_stock_balance_differences"() d LIMIT 200`));
  const documented = await client.$queryRaw<unknown[]>`
    SELECT e."checkCode", m."folio", m."quantity"::text AS quantity, e."reason", u."name" AS "documentadoPor", e."createdAt"
      FROM "WarehouseReconciliationException" e LEFT JOIN "InventoryMovement" m ON m."id" = e."subjectId" LEFT JOIN "User" u ON u."id" = e."actorId"
     ORDER BY e."createdAt" DESC LIMIT 200`;
  findings.push({ check: "Excepciones históricas documentadas (no alteran el historial)", severity: "INFO", count: documented.length, sample: documented.slice(0, 20) });

  const [totals] = await client.$queryRaw<{ movements: bigint; custodies: bigint; discrepancies: bigint }[]>`
    SELECT (SELECT COUNT(*) FROM "InventoryMovement")::bigint AS movements, (SELECT COUNT(*) FROM "InventoryCustody")::bigint AS custodies,
           (SELECT COUNT(*) FROM "WarehouseDiscrepancy")::bigint AS discrepancies`;
  return {
    soloLectura: true,
    generatedAt: new Date().toISOString(),
    totals: { movements: Number(totals?.movements ?? 0), custodies: Number(totals?.custodies ?? 0), discrepancies: Number(totals?.discrepancies ?? 0) },
    consistent: findings.every(f => f.severity === "INFO" || f.count === 0),
    findings,
  };
}
