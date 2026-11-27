import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { parseWarehouseQuantity } from "@/lib/warehouse-quantity";
import { receiveProductionCustodyOnce } from "@/repositories/warehouse-custody.repository";

/** Recepción en Producción de una entrega de Almacén (cambio de custodia, no consumo). Idempotente por Idempotency-Key. */
export async function POST(request: Request, context: { params: Promise<{ custodyId: string }> }) {
  try {
    const user = await requireWarehouseCapability("production");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { custodyId } = await context.params;
    const body = await readJsonObject(request);
    if (!body) return invalidBody();
    const receivedQuantity = parseWarehouseQuantity(body.receivedQuantity);
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    const result = await receiveProductionCustodyOnce(
      { custodyId, receivedQuantity, notes, actorId: user.id, occurredAt: new Date() },
      { idempotencyKey, payload: { custodyId, receivedQuantity: receivedQuantity.toFixed(3), notes } },
      custody => ({
        custody: {
          id: custody.id, folio: custody.folio, status: custody.status, quantity: custody.quantity.toNumber(), unit: custody.unit,
          enteredAt: custody.enteredAt.toISOString(),
          item: { id: custody.item.id, code: custody.item.code, description: custody.item.description },
          custodianArea: { id: custody.custodianArea.id, code: custody.custodianArea.code, name: custody.custodianArea.name },
        },
      }),
    );
    return idempotentResponse(result);
  } catch (error) { return warehouseApiError(error); }
}
