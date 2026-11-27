import { NextRequest } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { completeWarehouseCountOnce, parseCountedQuantity } from "@/repositories/warehouse-counts.repository";

export async function POST(req: NextRequest, { params }: { params: Promise<{ countId: string }> }) {
  try {
    // Autorización antes de leer el cuerpo. El bloqueo del conteo y su estado OPEN impiden un doble cierre.
    const user = await requireWarehouseCapability("operate");
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { countId } = await params;
    const b = await readJsonObject(req);
    if (!b) return invalidBody();
    const counted = parseCountedQuantity(b.countedQuantity);
    const notes = typeof b.notes === "string" ? b.notes.trim() : "";
    const result = await completeWarehouseCountOnce(
      { id: countId, countedQuantity: counted, notes, actorId: user.id },
      { idempotencyKey, payload: { countId, countedQuantity: counted.toFixed(3), notes } },
      r => ({ ...r }),
    );
    return idempotentResponse(result);
  } catch (e) { return warehouseApiError(e); }
}
