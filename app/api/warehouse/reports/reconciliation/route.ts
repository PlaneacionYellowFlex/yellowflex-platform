import { NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { warehouseApiError } from "@/lib/warehouse/api-error";
import { reconcile } from "@/repositories/warehouse-reporting.repository";

/** Reconciliación de solo lectura entre movimientos, existencias, custodias y expedientes (auditoría). No corrige nada. */
export async function GET() {
  try {
    await requireWarehouseCapability("audit");
    return NextResponse.json(await reconcile(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return warehouseApiError(error); }
}
