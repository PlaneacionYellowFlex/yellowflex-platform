import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { warehouseFolio } from "@/lib/warehouse/folio";
import { parseWarehouseQuantity } from "@/lib/warehouse-quantity";
import { createExternalIssueOnce } from "@/repositories/warehouse-operations.repository";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * YF-003 · Salida de material de Almacén (no es entrega a Producción ni consumo): motivo, destino y referencia obligatorios.
 * Valida existencia disponible bajo bloqueo; nunca deja saldo negativo. Idempotente por Idempotency-Key.
 */
export async function POST(request: Request) {
  try {
    const user = await requireWarehouseCapability("operate");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const body = await readJsonObject(request);
    if (!body) return invalidBody();
    const itemId = text(body.itemId); const originLocationId = text(body.originLocationId);
    if (!itemId || !originLocationId) return invalidBody("Selecciona el artículo y la ubicación de origen.");
    const quantity = parseWarehouseQuantity(body.quantity);
    const payload = { itemId, originLocationId, quantity: quantity.toFixed(3), reason: text(body.reason), destination: text(body.destination),
      referenceNumber: text(body.referenceNumber), notes: text(body.notes) || null };
    const result = await createExternalIssueOnce(
      { folio: warehouseFolio("SAL"), itemId, originLocationId, quantity, reason: payload.reason, destination: payload.destination,
        referenceNumber: payload.referenceNumber, notes: payload.notes, actorId: user.id, occurredAt: new Date() },
      { idempotencyKey, payload },
      m => ({ movement: { id: m.id, folio: m.folio, itemCode: m.item.code, quantity: m.quantity.toNumber(), unit: m.unit, originLocation: m.originLocation?.code ?? null } }),
    );
    return idempotentResponse(result);
  } catch (error) { return warehouseApiError(error); }
}
