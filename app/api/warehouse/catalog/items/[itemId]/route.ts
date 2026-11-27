import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { invalidBody, readJsonObject, warehouseApiError } from "@/lib/warehouse/api-error";
import { setCatalogItemActive, updateCatalogItem } from "@/repositories/warehouse-catalog.repository";

/**
 * YF-003 V2 · Edición de un artículo: descripción, unidad base (solo sin historial) o activación/inactivación controlada.
 * El código no se modifica y nunca se tocan existencias. Siempre con motivo; queda en el historial del catálogo.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const user = await requireWarehouseCapability("catalog");
    const { itemId } = await params;
    const b = await readJsonObject(req);
    if (!b) return invalidBody();
    if (b.code !== undefined) return NextResponse.json({ error: "El código del artículo no se puede modificar." }, { status: 422 });
    if (typeof b.active === "boolean") {
      if (b.description !== undefined || b.baseUnit !== undefined) return invalidBody("Activa o inactiva el artículo en una solicitud separada.");
      const r = await setCatalogItemActive(itemId, b.active, b.reason, user.id);
      return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
    }
    if (b.description === undefined && b.baseUnit === undefined) return invalidBody("No hay cambios que registrar.");
    const r = await updateCatalogItem(itemId, { description: b.description, baseUnit: b.baseUnit, reason: b.reason }, user.id);
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}

/** No existe eliminación: se autentica y autoriza primero (sin revelar datos) y siempre responde 405. */
export async function DELETE() {
  try {
    await requireWarehouseCapability("catalog");
    return NextResponse.json({ error: "Los artículos no se eliminan; inactívalo con motivo." }, { status: 405 });
  } catch (e) { return warehouseApiError(e); }
}
