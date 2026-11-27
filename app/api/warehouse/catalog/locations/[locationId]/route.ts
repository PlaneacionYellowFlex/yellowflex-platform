import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { invalidBody, readJsonObject, warehouseApiError } from "@/lib/warehouse/api-error";
import { setCatalogLocationActive, updateCatalogLocation } from "@/repositories/warehouse-catalog.repository";

/** YF-003 V2 · Edición de una ubicación (nombre) o activación/inactivación controlada. El código y el almacén no cambian. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ locationId: string }> }) {
  try {
    const user = await requireWarehouseCapability("catalog");
    const { locationId } = await params;
    const b = await readJsonObject(req);
    if (!b) return invalidBody();
    if (b.code !== undefined || b.warehouseId !== undefined) return NextResponse.json({ error: "El código y el almacén de la ubicación no se pueden modificar." }, { status: 422 });
    if (typeof b.active === "boolean") {
      if (b.name !== undefined) return invalidBody("Activa o inactiva la ubicación en una solicitud separada.");
      return NextResponse.json(await setCatalogLocationActive(locationId, b.active, b.reason, user.id), { headers: { "Cache-Control": "no-store" } });
    }
    if (b.name === undefined) return invalidBody("No hay cambios que registrar.");
    return NextResponse.json(await updateCatalogLocation(locationId, { name: b.name, reason: b.reason }, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}

/** No existe eliminación: se autentica y autoriza primero (sin revelar datos) y siempre responde 405. */
export async function DELETE() {
  try {
    await requireWarehouseCapability("catalog");
    return NextResponse.json({ error: "Las ubicaciones no se eliminan; inactívala con motivo." }, { status: 405 });
  } catch (e) { return warehouseApiError(e); }
}
