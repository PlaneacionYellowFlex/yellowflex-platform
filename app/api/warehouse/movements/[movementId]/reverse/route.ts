import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { warehouseFolio } from "@/lib/warehouse/folio";
import { reverseMovementOnce } from "@/repositories/warehouse-operations.repository";

/**
 * YF-003 · Reverso controlado de un movimiento (entrada, salida, transferencia o entrega no recibida). Requiere la capacidad
 * de investigar (supervisión de Almacén), motivo obligatorio y una persona distinta de quien registró el original.
 * Nunca modifica el movimiento original; un movimiento se revierte una sola vez.
 */
export async function POST(request: Request, context: { params: Promise<{ movementId: string }> }) {
  try {
    const user = await requireWarehouseCapability("investigate");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { movementId } = await context.params;
    const body = await readJsonObject(request);
    if (!body) return invalidBody();
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const result = await reverseMovementOnce({ movementId, folio: warehouseFolio("REV"), reason, actorId: user.id, occurredAt: new Date() },
      { idempotencyKey, payload: { movementId, reason } }, r => ({ reversal: r }));
    return idempotentResponse(result);
  } catch (error) { return warehouseApiError(error); }
}
