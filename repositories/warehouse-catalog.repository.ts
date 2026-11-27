import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * YF-003 V2 · Administración del catálogo de Almacén (artículos y ubicaciones) desde Platform.
 * Reglas: no se elimina nada; el código no cambia; la unidad base no cambia si hay historial; la edición nunca toca existencias;
 * inactivar exige existencia cero y nada pendiente; todo cambio queda en WarehouseCatalogAudit (append-only) con usuario y motivo.
 * La concurrencia con los movimientos se resuelve con bloqueo de fila: el catálogo usa FOR UPDATE y los movimientos FOR SHARE.
 */
export class WarehouseCatalogError extends Error {}

/** Unidades estándar admitidas para artículos nuevos (además de las que el catálogo vigente ya usa). */
export const STANDARD_UNITS: Record<string, string> = {
  PZ: "Pieza", EA: "Unidad", PAR: "Par", JGO: "Juego", CAJA: "Caja", PAQ: "Paquete", ROLLO: "Rollo",
  KG: "Kilogramo", G: "Gramo", TON: "Tonelada", L: "Litro", ML: "Mililitro",
  M: "Metro", CM: "Centímetro", MM: "Milímetro", M2: "Metro cuadrado", M3: "Metro cúbico",
};

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,49}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function requireReason(reason: string) {
  if (reason.trim().length < 8) throw new WarehouseCatalogError("Indica el motivo del cambio (mínimo 8 caracteres).");
}

export async function allowedUnits(client: typeof db | Prisma.TransactionClient = db) {
  const used = await client.inventoryItem.findMany({ distinct: ["baseUnit"], select: { baseUnit: true } });
  const all = new Map(Object.entries(STANDARD_UNITS));
  for (const u of used) if (!all.has(u.baseUnit)) all.set(u.baseUnit, "En uso en el catálogo");
  return [...all.entries()].map(([code, label]) => ({ code, label })).sort((a, b) => a.code.localeCompare(b.code));
}

async function audit(tx: Prisma.TransactionClient, entityType: "ITEM" | "LOCATION", entityId: string, action: string,
  before: Prisma.InputJsonValue | null, after: Prisma.InputJsonValue | null, reason: string, actorId: string) {
  await tx.warehouseCatalogAudit.create({ data: { entityType, entityId, action, before: before ?? Prisma.JsonNull, after: after ?? Prisma.JsonNull, reason: reason.trim(), actorId } });
}

const itemSnapshot = (i: { code: string; description: string; baseUnit: string; active: boolean }) => ({ code: i.code, description: i.description, baseUnit: i.baseUnit, active: i.active });
const locationSnapshot = (l: { code: string; name: string; active: boolean; warehouseId: string }) => ({ code: l.code, name: l.name, active: l.active, warehouseId: l.warehouseId });

// ------------------------------------------------------------------ consultas
export type ItemFilters = { search?: string; status?: "active" | "inactive" | "all"; unit?: string };

export async function listCatalogItems(filters: ItemFilters, cursor: string | null, limit: number) {
  const take = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filters.search) parts.push(Prisma.sql`(i."code" ILIKE ${"%" + filters.search + "%"} OR i."description" ILIKE ${"%" + filters.search + "%"})`);
  if (filters.status === "active") parts.push(Prisma.sql`i."active"`);
  if (filters.status === "inactive") parts.push(Prisma.sql`NOT i."active"`);
  if (filters.unit) parts.push(Prisma.sql`i."baseUnit" = ${filters.unit}`);
  if (cursor) parts.push(Prisma.sql`i."code" > ${cursor}`);
  const where = Prisma.join(parts, " AND ");
  const [rows, [count]] = await Promise.all([
    db.$queryRaw<{ id: string; code: string; description: string; baseUnit: string; active: boolean; updatedAt: Date; stock: unknown; locations: bigint; hasHistory: boolean }[]>`
      SELECT i."id", i."code", i."description", i."baseUnit", i."active", i."updatedAt",
             COALESCE((SELECT SUM(b."quantity") FROM "InventoryStockBalance" b WHERE b."itemId" = i."id"), 0) AS stock,
             (SELECT COUNT(*) FROM "InventoryStockBalance" b WHERE b."itemId" = i."id" AND b."quantity" <> 0)::bigint AS locations,
             EXISTS (SELECT 1 FROM "InventoryMovement" m WHERE m."itemId" = i."id") AS "hasHistory"
        FROM "InventoryItem" i WHERE ${where} ORDER BY i."code" LIMIT ${take + 1}`,
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "InventoryItem" i WHERE ${Prisma.join(parts.slice(0, cursor ? -1 : undefined), " AND ")}`,
  ]);
  const page = rows.slice(0, take).map(r => ({ ...r, stock: String(r.stock), locations: Number(r.locations), updatedAt: r.updatedAt.toISOString() }));
  return { rows: page, total: Number(count?.n ?? 0), nextCursor: rows.length > take ? page[page.length - 1].code : null };
}

export type LocationFilters = { warehouseId?: string; search?: string; status?: "active" | "inactive" | "all" };

export async function listCatalogLocations(filters: LocationFilters, cursor: string | null, limit: number) {
  const take = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filters.warehouseId) parts.push(Prisma.sql`l."warehouseId" = ${filters.warehouseId}`);
  if (filters.search) parts.push(Prisma.sql`(l."code" ILIKE ${"%" + filters.search + "%"} OR l."name" ILIKE ${"%" + filters.search + "%"})`);
  if (filters.status === "active") parts.push(Prisma.sql`l."active"`);
  if (filters.status === "inactive") parts.push(Prisma.sql`NOT l."active"`);
  const base = Prisma.join(parts, " AND ");
  const after = cursor ? Prisma.sql`AND (w."code" || '/' || l."code") > ${cursor}` : Prisma.empty;
  const [rows, [count]] = await Promise.all([
    db.$queryRaw<{ id: string; code: string; name: string; active: boolean; warehouseId: string; warehouseCode: string; warehouseName: string; stockLines: bigint; key: string }[]>`
      SELECT l."id", l."code", l."name", l."active", l."warehouseId", w."code" AS "warehouseCode", w."name" AS "warehouseName",
             (SELECT COUNT(*) FROM "InventoryStockBalance" b WHERE b."locationId" = l."id" AND b."quantity" <> 0)::bigint AS "stockLines",
             (w."code" || '/' || l."code") AS key
        FROM "WarehouseLocation" l JOIN "Warehouse" w ON w."id" = l."warehouseId"
       WHERE ${base} ${after} ORDER BY w."code", l."code" LIMIT ${take + 1}`,
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "WarehouseLocation" l WHERE ${base}`,
  ]);
  const page = rows.slice(0, take).map(r => ({ ...r, stockLines: Number(r.stockLines) }));
  return { rows: page.map(r => ({ id: r.id, code: r.code, name: r.name, active: r.active, warehouseId: r.warehouseId, warehouseCode: r.warehouseCode, warehouseName: r.warehouseName, stockLines: r.stockLines })), total: Number(count?.n ?? 0), nextCursor: rows.length > take ? page[page.length - 1].key : null };
}

export function listCatalogWarehouses() {
  return db.warehouse.findMany({ select: { id: true, code: true, name: true, active: true }, orderBy: { code: "asc" } });
}

export async function catalogHistory(entityType: "ITEM" | "LOCATION", entityId: string) {
  const rows = await db.warehouseCatalogAudit.findMany({ where: { entityType, entityId }, orderBy: { createdAt: "desc" }, take: 200,
    include: { actor: { select: { name: true } } } });
  return rows.map(r => ({ id: r.id, action: r.action, before: r.before, after: r.after, reason: r.reason, actor: r.actor.name, createdAt: r.createdAt.toISOString() }));
}

// ------------------------------------------------------------------ artículos
export async function createCatalogItem(input: { code: unknown; description: unknown; baseUnit: unknown; reason: unknown }, actorId: string) {
  const code = text(input.code, 50); const description = text(input.description, 300); const baseUnit = text(input.baseUnit, 10).toUpperCase();
  const reason = text(input.reason, 500);
  if (!CODE_RE.test(code)) throw new WarehouseCatalogError("Código inválido: 2 a 50 caracteres (letras, números, punto, guion, diagonal o guion bajo).");
  if (description.length < 3) throw new WarehouseCatalogError("La descripción es obligatoria (mínimo 3 caracteres).");
  requireReason(reason);
  return db.$transaction(async tx => {
    const units = await allowedUnits(tx);
    if (!units.some(u => u.code === baseUnit)) throw new WarehouseCatalogError("Unidad de medida no válida; elige una de la lista.");
    // Duplicados: el código es único sin distinguir mayúsculas; bloqueo consultivo para dos altas simultáneas del mismo código.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"catalog-item:" + code.toLowerCase()}, 0))`;
    const dup = await tx.$queryRaw<{ code: string }[]>`SELECT "code" FROM "InventoryItem" WHERE lower("code") = lower(${code}) LIMIT 1`;
    if (dup.length) throw new WarehouseCatalogError(`Ya existe el artículo ${dup[0].code}.`);
    const item = await tx.inventoryItem.create({ data: { code, description, baseUnit } });
    await audit(tx, "ITEM", item.id, "CREATE", null, itemSnapshot(item), reason, actorId);
    return item;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function lockItem(tx: Prisma.TransactionClient, id: string) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "InventoryItem" WHERE "id" = ${id} FOR UPDATE`;
  if (!row) throw new WarehouseCatalogError("El artículo no existe.");
  return tx.inventoryItem.findUniqueOrThrow({ where: { id } });
}

export async function updateCatalogItem(id: string, input: { description?: unknown; baseUnit?: unknown; reason: unknown }, actorId: string) {
  const reason = text(input.reason, 500); requireReason(reason);
  return db.$transaction(async tx => {
    const item = await lockItem(tx, id);
    const data: { description?: string; baseUnit?: string } = {};
    if (input.description !== undefined) {
      const description = text(input.description, 300);
      if (description.length < 3) throw new WarehouseCatalogError("La descripción es obligatoria (mínimo 3 caracteres).");
      if (description !== item.description) data.description = description;
    }
    if (input.baseUnit !== undefined) {
      const unit = text(input.baseUnit, 10).toUpperCase();
      if (unit !== item.baseUnit) {
        const [history] = await tx.$queryRaw<{ n: bigint }[]>`SELECT (
            (SELECT COUNT(*) FROM "InventoryMovement" WHERE "itemId" = ${id}) + (SELECT COUNT(*) FROM "InventoryCustody" WHERE "itemId" = ${id})
          + (SELECT COUNT(*) FROM "WarehouseCount" WHERE "itemId" = ${id}))::bigint AS n`;
        if (Number(history?.n ?? 0) > 0) throw new WarehouseCatalogError("La unidad base no puede cambiar: el artículo ya tiene historial (movimientos, custodias o conteos).");
        if (!(await allowedUnits(tx)).some(u => u.code === unit)) throw new WarehouseCatalogError("Unidad de medida no válida; elige una de la lista.");
        data.baseUnit = unit;
      }
    }
    if (Object.keys(data).length === 0) return { item, unchanged: true };
    const updated = await tx.inventoryItem.update({ where: { id }, data });
    await audit(tx, "ITEM", id, "UPDATE", itemSnapshot(item), itemSnapshot(updated), reason, actorId);
    return { item: updated, unchanged: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function setCatalogItemActive(id: string, active: boolean, reasonInput: unknown, actorId: string) {
  const reason = text(reasonInput, 500); requireReason(reason);
  return db.$transaction(async tx => {
    const item = await lockItem(tx, id); // espera a los movimientos en curso (FOR SHARE) y bloquea los nuevos
    if (item.active === active) return { item, unchanged: true };
    if (!active) {
      const [state] = await tx.$queryRaw<{ stock: unknown; custodies: bigint; counts: bigint }[]>`SELECT
        COALESCE((SELECT SUM(ABS("quantity")) FROM "InventoryStockBalance" WHERE "itemId" = ${id}), 0) AS stock,
        (SELECT COUNT(*) FROM "InventoryCustody" WHERE "itemId" = ${id} AND "closedAt" IS NULL AND "status" <> 'CLOSED')::bigint AS custodies,
        (SELECT COUNT(*) FROM "WarehouseCount" WHERE "itemId" = ${id} AND "status" = 'OPEN')::bigint AS counts`;
      if (Number(state.stock) !== 0) throw new WarehouseCatalogError("No se puede inactivar: el artículo tiene existencia en Almacén.");
      if (Number(state.custodies) > 0) throw new WarehouseCatalogError("No se puede inactivar: el artículo tiene custodias abiertas en Producción.");
      if (Number(state.counts) > 0) throw new WarehouseCatalogError("No se puede inactivar: el artículo tiene conteos abiertos.");
    }
    const updated = await tx.inventoryItem.update({ where: { id }, data: { active } });
    await audit(tx, "ITEM", id, active ? "ACTIVATE" : "INACTIVATE", itemSnapshot(item), itemSnapshot(updated), reason, actorId);
    return { item: updated, unchanged: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

// ------------------------------------------------------------------ ubicaciones
export async function createCatalogLocation(input: { warehouseId: unknown; code: unknown; name: unknown; reason: unknown }, actorId: string) {
  const warehouseId = text(input.warehouseId, 60); const code = text(input.code, 40).toUpperCase(); const name = text(input.name, 120);
  const reason = text(input.reason, 500);
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(code)) throw new WarehouseCatalogError("Código de ubicación inválido (letras, números, punto, guion o diagonal).");
  if (name.length < 2) throw new WarehouseCatalogError("El nombre de la ubicación es obligatorio.");
  requireReason(reason);
  return db.$transaction(async tx => {
    const [warehouse] = await tx.$queryRaw<{ active: boolean }[]>`SELECT "active" FROM "Warehouse" WHERE "id" = ${warehouseId} FOR SHARE`;
    if (!warehouse) throw new WarehouseCatalogError("El almacén no existe.");
    if (!warehouse.active) throw new WarehouseCatalogError("El almacén está inactivo.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"catalog-location:" + warehouseId + ":" + code}, 0))`;
    const dup = await tx.$queryRaw<{ code: string }[]>`SELECT "code" FROM "WarehouseLocation" WHERE "warehouseId" = ${warehouseId} AND upper("code") = ${code} LIMIT 1`;
    if (dup.length) throw new WarehouseCatalogError(`Ya existe la ubicación ${dup[0].code} en ese almacén.`);
    const location = await tx.warehouseLocation.create({ data: { warehouseId, code, name } });
    await audit(tx, "LOCATION", location.id, "CREATE", null, locationSnapshot(location), reason, actorId);
    return location;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

async function lockLocation(tx: Prisma.TransactionClient, id: string) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "WarehouseLocation" WHERE "id" = ${id} FOR UPDATE`;
  if (!row) throw new WarehouseCatalogError("La ubicación no existe.");
  return tx.warehouseLocation.findUniqueOrThrow({ where: { id } });
}

export async function updateCatalogLocation(id: string, input: { name: unknown; reason: unknown }, actorId: string) {
  const reason = text(input.reason, 500); requireReason(reason);
  const name = text(input.name, 120);
  if (name.length < 2) throw new WarehouseCatalogError("El nombre de la ubicación es obligatorio.");
  return db.$transaction(async tx => {
    const location = await lockLocation(tx, id);
    if (location.name === name) return { location, unchanged: true };
    const updated = await tx.warehouseLocation.update({ where: { id }, data: { name } });
    await audit(tx, "LOCATION", id, "UPDATE", locationSnapshot(location), locationSnapshot(updated), reason, actorId);
    return { location: updated, unchanged: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function setCatalogLocationActive(id: string, active: boolean, reasonInput: unknown, actorId: string) {
  const reason = text(reasonInput, 500); requireReason(reason);
  return db.$transaction(async tx => {
    const location = await lockLocation(tx, id);
    if (location.active === active) return { location, unchanged: true };
    if (!active) {
      const [state] = await tx.$queryRaw<{ stock: bigint; counts: bigint; transit: bigint }[]>`SELECT
        (SELECT COUNT(*) FROM "InventoryStockBalance" WHERE "locationId" = ${id} AND "quantity" <> 0)::bigint AS stock,
        (SELECT COUNT(*) FROM "WarehouseCount" WHERE "locationId" = ${id} AND "status" = 'OPEN')::bigint AS counts,
        (SELECT COUNT(*) FROM "InventoryCustody" c JOIN "InventoryMovement" m ON m."id" = c."sourceMovementId"
          WHERE m."originLocationId" = ${id} AND c."status" = 'IN_TRANSIT' AND c."closedAt" IS NULL)::bigint
        + (SELECT COUNT(*) FROM "InventoryCustody" c WHERE c."locationId" = ${id} AND c."closedAt" IS NULL AND c."status" <> 'CLOSED')::bigint AS transit`;
      if (Number(state.stock) > 0) throw new WarehouseCatalogError("No se puede inactivar: la ubicación tiene existencias. Transfiérelas primero.");
      if (Number(state.counts) > 0) throw new WarehouseCatalogError("No se puede inactivar: la ubicación tiene conteos abiertos.");
      if (Number(state.transit) > 0) throw new WarehouseCatalogError("No se puede inactivar: hay custodias pendientes ligadas a esta ubicación (entregas en tránsito o material por regresar).");
    }
    const updated = await tx.warehouseLocation.update({ where: { id }, data: { active } });
    await audit(tx, "LOCATION", id, active ? "ACTIVATE" : "INACTIVATE", locationSnapshot(location), locationSnapshot(updated), reason, actorId);
    return { location: updated, unchanged: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
