import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, missingIdempotencyKey, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { warehouseFolio } from "@/lib/warehouse/folio";
import { approveDiscrepancyAdjustmentOnce } from "@/repositories/warehouse-discrepancies.repository";

/**
 * YF-003: aprobación de ajustes sin atajos por rol. Exige C-PANEL warehouse view + approve y el permiso operativo
 * canApproveWarehouseAdjustments; el repositorio lo vuelve a verificar dentro de la transacción junto con la separación
 * de funciones (quien aprueba no contó, no recontó, no solicitó reconteos ni investigó el expediente).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireWarehouseCapability("approve");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { id } = await params;
    const result = await approveDiscrepancyAdjustmentOnce(id, user.id, warehouseFolio("AJ"), { idempotencyKey, payload: { id } }, movement => ({ movement }));
    return idempotentResponse(result);
  } catch (error) { return warehouseApiError(error); }
}
