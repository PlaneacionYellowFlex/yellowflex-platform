import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getInventoryBalances, getWarehousePermission, listInventoryItems, listWarehouses } from "@/repositories/warehouse.repository";

async function requireWarehouseInventoryAccess() {
  const user = await requireCorporateUser();
  if (user.roles.some((role) => role === "ADMIN" || role === "DIRECCION")) return user;
  const permission = await getWarehousePermission(user.id);
  if (!permission?.canViewInventory) {
    throw new CorporateAuthorizationRequired("No tienes permiso para consultar el inventario de Almacén.");
  }
  return user;
}

export async function GET() {
  try {
    await requireWarehouseInventoryAccess();
    const [items, warehouses, balances] = await Promise.all([
      listInventoryItems(),
      listWarehouses(),
      getInventoryBalances(),
    ]);

    const totalsByItem = new Map<string, number>();
    const locationsByItem = new Map<string, number>();
    for (const balance of balances) {
      totalsByItem.set(balance.itemId, (totalsByItem.get(balance.itemId) ?? 0) + balance.quantity);
      locationsByItem.set(balance.itemId, (locationsByItem.get(balance.itemId) ?? 0) + 1);
    }

    const inventory = items.filter((item) => item.active).map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      unit: item.baseUnit,
      quantity: totalsByItem.get(item.id) ?? 0,
      locationCount: locationsByItem.get(item.id) ?? 0,
    })).sort((a, b) => a.code.localeCompare(b.code));

    const activeLocations = warehouses.reduce(
      (total, warehouse) => total + warehouse.locations.filter((location) => location.active).length, 0
    );
    const occupiedLocations = new Set(
      balances.filter((balance) => balance.quantity !== 0).map((balance) => balance.locationId)
    ).size;

    return NextResponse.json({
      summary: {
        itemCount: inventory.length,
        locationCount: activeLocations,
        occupiedLocationCount: occupiedLocations,
        emptyLocationCount: Math.max(activeLocations - occupiedLocations, 0),
        balanceCount: balances.length,
      },
      inventory,
      balances,
    });
  } catch (error) {
    return apiError(error);
  }
}
