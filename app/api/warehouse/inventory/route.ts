import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { getInventoryBalances, getInventoryTotals, listInventoryItems, listWarehouses } from "@/repositories/warehouse.repository";

/**
 * Inventario: totales por artículo y resumen. YF-003 V2: la consulta habitual lee totales de la existencia materializada;
 * el detalle artículo-ubicación se pide con ?include=balances (o paginado en /api/warehouse/reports/stock).
 */
export async function GET(request?: Request) {
  try {
    await requireWarehouseCapability("view");
    const include = request?.url ? new URL(request.url).searchParams.get("include") : null;
    const [items, warehouses, stock, balances] = await Promise.all([
      listInventoryItems(),
      listWarehouses(),
      getInventoryTotals(),
      include === "balances" ? getInventoryBalances() : Promise.resolve(null),
    ]);

    // YF-003: totales con aritmética decimal exacta; un artículo inactivo con existencia se muestra marcado (no desaparece).
    const totalsByItem = new Map<string, Prisma.Decimal>(stock.totals.map(t => [t.itemId, t.quantity]));
    const locationsByItem = new Map<string, number>(stock.totals.map(t => [t.itemId, t.locations]));

    const inventory = items.filter((item) => item.active || !(totalsByItem.get(item.id)?.isZero() ?? true)).map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      unit: item.baseUnit,
      quantity: totalsByItem.get(item.id)?.toNumber() ?? 0,
      locationCount: locationsByItem.get(item.id) ?? 0,
      active: item.active,
    })).sort((a, b) => a.code.localeCompare(b.code));

    const activeLocations = warehouses.reduce(
      (total, warehouse) => total + warehouse.locations.filter((location) => location.active).length, 0
    );
    const locations = warehouses.flatMap(w => w.locations.map(l => ({ id: l.id, code: l.code, warehouseCode: w.code, active: l.active && w.active })));

    return NextResponse.json({
      summary: {
        itemCount: inventory.length,
        locationCount: activeLocations,
        occupiedLocationCount: stock.occupiedLocationCount,
        emptyLocationCount: Math.max(activeLocations - stock.occupiedLocationCount, 0),
        balanceCount: stock.balanceCount,
      },
      inventory,
      locations,
      ...(balances ? { balances } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
