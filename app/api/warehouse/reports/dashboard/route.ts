import { NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { warehouseApiError } from "@/lib/warehouse/api-error";
import { dashboardIndicators } from "@/repositories/warehouse-reporting.repository";

/** Indicadores deterministas del tablero de Almacén (solo lectura). */
export async function GET() {
  try {
    await requireWarehouseCapability("view");
    return NextResponse.json(await dashboardIndicators(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return warehouseApiError(error); }
}
