import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { getWarehouseCapabilities } from "@/lib/warehouse/access";

/** YF-003: capacidades efectivas del usuario en Warehouse, para mostrar cada acceso con su estado (no concede nada). */
export async function GET() {
  try {
    const user = await requireCorporateUser();
    const capabilities = await getWarehouseCapabilities(user.id, undefined, user.roles);
    if (!capabilities.view && !capabilities.productionView) throw new CorporateAuthorizationRequired("No tienes permiso para consultar Almacén.");
    return NextResponse.json({ capabilities }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
