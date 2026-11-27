import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { warehouseFolio } from "@/lib/warehouse/folio";
import { parseWarehouseQuantity } from "@/lib/warehouse-quantity";
import { requestProductionReturnOnce } from "@/repositories/warehouse-custody.repository";

/** Devolución de sobrante a Almacén: total (sin cantidad) o parcial (cantidad menor al saldo). Idempotente. */
export async function POST(request: Request, context: { params: Promise<{ custodyId: string }> }) {
  try {
    const user = await requireWarehouseCapability("production");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { custodyId } = await context.params;
    const body = await readJsonObject(request);
    if (!body) return invalidBody();
    const quantity = body.quantity === undefined || body.quantity === null || body.quantity === "" ? null : parseWarehouseQuantity(body.quantity);
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    const result = await requestProductionReturnOnce(
      { custodyId, quantity, returnFolio: warehouseFolio("CUS-DEV"), notes, actorId: user.id, occurredAt: new Date() },
      { idempotencyKey, payload: { custodyId, quantity: quantity?.toFixed(3) ?? null, notes } },
      r => ({ ...r }),
    );
    return idempotentResponse(result);
  } catch (error) { return warehouseApiError(error); }
}
