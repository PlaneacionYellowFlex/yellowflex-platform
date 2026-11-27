import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export type WarehouseMovementFilters = {
  itemId?: string;
  locationId?: string;
  limit?: number;
};

export type WarehouseInventoryBalance = {
  itemId: string;
  itemCode: string;
  itemDescription: string;
  baseUnit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  quantity: number;
  /** YF-003: true si el artículo o la ubicación están inactivos pero conservan existencia (no se ocultan). */
  inactive?: boolean;
};

export async function getWarehousePermission(userId: string) {
  return db.warehousePermission.findUnique({ where: { userId } });
}

export async function listInventoryItems() {
  return db.inventoryItem.findMany({
    orderBy: [{ active: "desc" }, { code: "asc" }],
  });
}

export async function getInventoryItemById(id: string) {
  return db.inventoryItem.findUnique({ where: { id } });
}

export async function getInventoryItemByCode(code: string) {
  return db.inventoryItem.findUnique({ where: { code } });
}

export async function listWarehouses() {
  return db.warehouse.findMany({
    include: {
      locations: {
        orderBy: [{ active: "desc" }, { code: "asc" }],
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function getWarehouseById(id: string) {
  return db.warehouse.findUnique({
    where: { id },
    include: {
      locations: {
        orderBy: [{ active: "desc" }, { code: "asc" }],
      },
    },
  });
}

export async function getWarehouseLocationById(id: string) {
  return db.warehouseLocation.findUnique({
    where: { id },
    include: { warehouse: true },
  });
}

export async function listInventoryMovements(
  filters: WarehouseMovementFilters = {},
) {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);

  return db.inventoryMovement.findMany({
    where: {
      ...(filters.itemId ? { itemId: filters.itemId } : {}),
      ...(filters.locationId
        ? {
            OR: [
              { originLocationId: filters.locationId },
              { destinationLocationId: filters.locationId },
            ],
          }
        : {}),
    },
    include: {
      item: true,
      originLocation: { include: { warehouse: true } },
      destinationLocation: { include: { warehouse: true } },
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function getInventoryMovementById(id: string) {
  return db.inventoryMovement.findUnique({
    where: { id },
    include: {
      item: true,
      originLocation: { include: { warehouse: true } },
      destinationLocation: { include: { warehouse: true } },
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

export async function getInventoryMovementByFolio(folio: string) {
  return db.inventoryMovement.findUnique({
    where: { folio },
    include: {
      item: true,
      originLocation: { include: { warehouse: true } },
      destinationLocation: { include: { warehouse: true } },
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

/**
 * YF-003 V2 · Existencias por artículo y ubicación desde la existencia materializada (InventoryStockBalance), que el
 * disparador del libro mayor mantiene en la misma transacción de cada movimiento (reconciliación R8 exacta).
 * Solo filas con existencia distinta de cero; artículos o ubicaciones inactivos con existencia se devuelven marcados.
 */
export async function getInventoryBalances(itemId?: string): Promise<
  WarehouseInventoryBalance[]
> {
  const rows = await db.$queryRaw<{
    itemId: string; itemCode: string; itemDescription: string; baseUnit: string; itemActive: boolean;
    warehouseId: string; warehouseCode: string; warehouseName: string; warehouseActive: boolean;
    locationId: string; locationCode: string; locationName: string; locationActive: boolean; quantity: Prisma.Decimal;
  }[]>`
    SELECT b."itemId", i."code" AS "itemCode", i."description" AS "itemDescription", i."baseUnit", i."active" AS "itemActive",
           w."id" AS "warehouseId", w."code" AS "warehouseCode", w."name" AS "warehouseName", w."active" AS "warehouseActive",
           l."id" AS "locationId", l."code" AS "locationCode", l."name" AS "locationName", l."active" AS "locationActive", b."quantity"
      FROM "InventoryStockBalance" b
      JOIN "InventoryItem" i ON i."id" = b."itemId"
      JOIN "WarehouseLocation" l ON l."id" = b."locationId"
      JOIN "Warehouse" w ON w."id" = l."warehouseId"
     WHERE b."quantity" <> 0 ${itemId ? Prisma.sql`AND b."itemId" = ${itemId}` : Prisma.empty}
     ORDER BY i."code", w."code", l."code"`;
  return rows.map((r) => {
    const inactive = !r.itemActive || !r.locationActive || !r.warehouseActive;
    return {
      itemId: r.itemId, itemCode: r.itemCode, itemDescription: r.itemDescription, baseUnit: r.baseUnit,
      warehouseId: r.warehouseId, warehouseCode: r.warehouseCode, warehouseName: r.warehouseName,
      locationId: r.locationId, locationCode: r.locationCode, locationName: r.locationName,
      quantity: new Prisma.Decimal(r.quantity).toNumber(),
      ...(inactive ? { inactive: true } : {}),
    };
  });
}

/**
 * YF-003 V2 · Totales por artículo para la consulta habitual del inventario (sin traer cada fila artículo-ubicación).
 * Exactos (Decimal) y leídos de la existencia materializada.
 */
export async function getInventoryTotals() {
  const [rows, [occupied]] = await Promise.all([
    db.$queryRaw<{ itemId: string; quantity: Prisma.Decimal; locations: bigint }[]>`
      SELECT "itemId", SUM("quantity") AS quantity, COUNT(*)::bigint AS locations
        FROM "InventoryStockBalance" WHERE "quantity" <> 0 GROUP BY "itemId"`,
    db.$queryRaw<{ locations: bigint; lines: bigint }[]>`
      SELECT COUNT(DISTINCT "locationId")::bigint AS locations, COUNT(*)::bigint AS lines FROM "InventoryStockBalance" WHERE "quantity" <> 0`,
  ]);
  return {
    totals: rows.map(r => ({ itemId: r.itemId, quantity: new Prisma.Decimal(r.quantity), locations: Number(r.locations) })),
    occupiedLocationCount: Number(occupied?.locations ?? 0),
    balanceCount: Number(occupied?.lines ?? 0),
  };
}

export async function getInventoryBalancesByItem(
  itemId: string,
): Promise<WarehouseInventoryBalance[]> {
  return getInventoryBalances(itemId);
}

export async function getInventoryTotalByItem(itemId: string) {
  const balances = await getInventoryBalancesByItem(itemId);

  return balances.reduce(
    (total, balance) => total.plus(balance.quantity),
    new Prisma.Decimal(0),
  ).toNumber();
}
