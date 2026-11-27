import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { invalidBody, readJsonObject, warehouseApiError } from "@/lib/warehouse/api-error";
import { allowedUnits, createCatalogItem, listCatalogItems } from "@/repositories/warehouse-catalog.repository";

/** YF-003 V2 · Catálogo de artículos: consulta con búsqueda, filtros y paginación; alta con permiso sensible de catálogo. */
export async function GET(req: NextRequest) {
  try {
    await requireWarehouseCapability("catalog");
    const u = new URL(req.url);
    const status = u.searchParams.get("status");
    const [page, units] = await Promise.all([
      listCatalogItems({ search: u.searchParams.get("q")?.trim().slice(0, 80) || undefined,
        status: status === "active" || status === "inactive" ? status : "all", unit: u.searchParams.get("unit") || undefined },
      u.searchParams.get("cursor"), Number(u.searchParams.get("limit") ?? 50)),
      allowedUnits(),
    ]);
    return NextResponse.json({ ...page, units }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireWarehouseCapability("catalog");
    const b = await readJsonObject(req);
    if (!b) return invalidBody();
    const item = await createCatalogItem({ code: b.code, description: b.description, baseUnit: b.baseUnit, reason: b.reason }, user.id);
    return NextResponse.json({ item }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}
