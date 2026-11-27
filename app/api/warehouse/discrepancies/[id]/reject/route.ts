import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { rejectDiscrepancyAdjustmentOnce } from "@/repositories/warehouse-discrepancies.repository";

/** YF-003: rechazo de la propuesta de ajuste (sin movimiento de inventario); el expediente vuelve a investigación. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireWarehouseCapability("approve");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { id } = await params;
    const body = await readJsonObject(request);
    if (!body) return invalidBody();
    const reason = String(body.reason ?? "").trim();
    const result = await rejectDiscrepancyAdjustmentOnce(id, user.id, reason, { idempotencyKey, payload: { id, reason } }, r => ({ ...r }));
    return idempotentResponse(result);
  } catch (error) { return warehouseApiError(error); }
}
