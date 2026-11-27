import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { invalidBody, readJsonObject, warehouseApiError } from "@/lib/warehouse/api-error";
import { createCatalogLocation, listCatalogLocations, listCatalogWarehouses } from "@/repositories/warehouse-catalog.repository";

/** YF-003 V2 · Ubicaciones: consulta paginada con filtros y alta con permiso sensible de catálogo. */
export async function GET(req: NextRequest) {
  try {
    await requireWarehouseCapability("catalog");
    const u = new URL(req.url);
    const status = u.searchParams.get("status");
    const [page, warehouses] = await Promise.all([
      listCatalogLocations({ warehouseId: u.searchParams.get("warehouseId") || undefined, search: u.searchParams.get("q")?.trim().slice(0, 80) || undefined,
        status: status === "active" || status === "inactive" ? status : "all" }, u.searchParams.get("cursor"), Number(u.searchParams.get("limit") ?? 50)),
      listCatalogWarehouses(),
    ]);
    return NextResponse.json({ ...page, warehouses }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireWarehouseCapability("catalog");
    const b = await readJsonObject(req);
    if (!b) return invalidBody();
    const location = await createCatalogLocation({ warehouseId: b.warehouseId, code: b.code, name: b.name, reason: b.reason }, user.id);
    return NextResponse.json({ location }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}
