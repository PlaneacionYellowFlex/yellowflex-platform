import { NextRequest, NextResponse } from "next/server";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getWarehouseCapabilities } from "@/lib/warehouse/access";
import { warehouseApiError } from "@/lib/warehouse/api-error";
import { catalogHistory } from "@/repositories/warehouse-catalog.repository";

/** YF-003 V2 · Historial de cambios del catálogo (append-only). Lo consultan quien administra el catálogo y Auditoría. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireCorporateUser();
    const caps = await getWarehouseCapabilities(user.id, undefined, user.roles);
    if (!caps.catalog && !caps.audit) throw new CorporateAuthorizationRequired("No tienes permiso para consultar el historial del catálogo.");
    const u = new URL(req.url);
    const entityType = u.searchParams.get("entityType");
    const entityId = u.searchParams.get("entityId") ?? "";
    if ((entityType !== "ITEM" && entityType !== "LOCATION") || !entityId) return NextResponse.json({ error: "Indica el registro a consultar." }, { status: 400 });
    return NextResponse.json({ rows: await catalogHistory(entityType, entityId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}
