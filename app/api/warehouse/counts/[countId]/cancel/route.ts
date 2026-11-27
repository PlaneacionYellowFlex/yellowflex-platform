import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { invalidBody, readJsonObject, warehouseApiError } from "@/lib/warehouse/api-error";
import { cancelWarehouseCount } from "@/repositories/warehouse-counts.repository";

/** YF-003: cancelación con motivo de un conteo abierto (p. ej. desactualizado). No borra el conteo; repetirla responde 409. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ countId: string }> }) {
  try {
    const user = await requireWarehouseCapability("operate");
    const { countId } = await params;
    const b = await readJsonObject(req);
    if (!b) return invalidBody();
    const result = await cancelWarehouseCount({ id: countId, reason: typeof b.reason === "string" ? b.reason : "", actorId: user.id });
    return NextResponse.json(result);
  } catch (e) { return warehouseApiError(e); }
}
