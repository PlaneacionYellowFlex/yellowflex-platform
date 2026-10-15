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

export async function getInventoryBalances(): Promise<
  WarehouseInventoryBalance[]
> {
  const [items, locations, incoming, outgoing] = await Promise.all([
    db.inventoryItem.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        description: true,
        baseUnit: true,
      },
    }),
    db.warehouseLocation.findMany({
      where: {
        active: true,
        warehouse: { active: true },
      },
      select: {
        id: true,
        code: true,
        name: true,
        warehouse: {
          select: { id: true, code: true, name: true },
        },
      },
    }),
    db.inventoryMovement.groupBy({
      by: ["itemId", "destinationLocationId"],
      where: { destinationLocationId: { not: null } },
      _sum: { quantity: true },
    }),
    db.inventoryMovement.groupBy({
      by: ["itemId", "originLocationId"],
      where: { originLocationId: { not: null } },
      _sum: { quantity: true },
    }),
  ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const locationById = new Map(
    locations.map((location) => [location.id, location]),
  );
  const balances = new Map<string, number>();

  for (const movement of incoming) {
    if (!movement.destinationLocationId) continue;

    const key = `${movement.itemId}:${movement.destinationLocationId}`;
    const current = balances.get(key) ?? 0;
    const quantity = movement._sum.quantity?.toNumber() ?? 0;
    balances.set(key, current + quantity);
  }

  for (const movement of outgoing) {
    if (!movement.originLocationId) continue;

    const key = `${movement.itemId}:${movement.originLocationId}`;
    const current = balances.get(key) ?? 0;
    const quantity = movement._sum.quantity?.toNumber() ?? 0;
    balances.set(key, current - quantity);
  }

  const result: WarehouseInventoryBalance[] = [];

  for (const [key, quantity] of balances.entries()) {
    const separatorIndex = key.indexOf(":");
    const itemId = key.slice(0, separatorIndex);
    const locationId = key.slice(separatorIndex + 1);
    const item = itemById.get(itemId);
    const location = locationById.get(locationId);

    if (!item || !location) continue;

    result.push({
      itemId: item.id,
      itemCode: item.code,
      itemDescription: item.description,
      baseUnit: item.baseUnit,
      warehouseId: location.warehouse.id,
      warehouseCode: location.warehouse.code,
      warehouseName: location.warehouse.name,
      locationId: location.id,
      locationCode: location.code,
      locationName: location.name,
      quantity,
    });
  }

  return result.sort((a, b) => {
    const itemComparison = a.itemCode.localeCompare(b.itemCode);
    if (itemComparison !== 0) return itemComparison;

    const warehouseComparison = a.warehouseCode.localeCompare(
      b.warehouseCode,
    );
    if (warehouseComparison !== 0) return warehouseComparison;

    return a.locationCode.localeCompare(b.locationCode);
  });
}

export async function getInventoryBalancesByItem(
  itemId: string,
): Promise<WarehouseInventoryBalance[]> {
  const balances = await getInventoryBalances();
  return balances.filter((balance) => balance.itemId === itemId);
}

export async function getInventoryTotalByItem(itemId: string) {
  const balances = await getInventoryBalancesByItem(itemId);

  return balances.reduce(
    (total, balance) => total + balance.quantity,
    0,
  );
}
