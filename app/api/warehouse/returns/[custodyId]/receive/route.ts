import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { warehouseFolio } from "@/lib/warehouse/folio";
import { parseWarehouseQuantity } from "@/lib/warehouse-quantity";
import { receiveWarehouseReturnOnce } from "@/repositories/warehouse-custody.repository";

/** Recepción en Almacén de una devolución de Producción: un solo movimiento OPERATIONAL_RETURN por Idempotency-Key. */
export async function POST(request: Request, context: { params: Promise<{ custodyId: string }> }) {
  try {
    const user = await requireWarehouseCapability("operate");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { custodyId } = await context.params;
    const body = await readJsonObject(request);
    if (!body) return invalidBody();
    const receivedQuantity = parseWarehouseQuantity(body.receivedQuantity);
    const destinationLocationId = typeof body.destinationLocationId === "string" ? body.destinationLocationId : "";
    if (!destinationLocationId) return invalidBody("Selecciona la ubicación destino.");
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    const result = await receiveWarehouseReturnOnce(
      { custodyId, movementFolio: warehouseFolio("IM"), receivedQuantity, destinationLocationId, notes, actorId: user.id, occurredAt: new Date() },
      { idempotencyKey, payload: { custodyId, receivedQuantity: receivedQuantity.toFixed(3), destinationLocationId, notes } },
      r => ({ movementFolio: r.movement.folio, custodyFolio: r.custodyFolio, returnedQuantity: r.returnedQuantity, unit: r.unit,
        item: { id: r.item.id, code: r.item.code, description: r.item.description }, destination: { code: r.destination.code, name: r.destination.name } }),
    );
    return idempotentResponse(result);
  } catch (error) { return warehouseApiError(error); }
}
