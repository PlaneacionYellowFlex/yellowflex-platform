import { NextRequest } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { updateDiscrepancyOnce } from "@/repositories/warehouse-discrepancies.repository";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireWarehouseCapability("investigate");
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { id } = await params;
    const body = await readJsonObject(request);
    if (!body || (body.classification !== "CONTROLLED_TEST" && body.classification !== "REAL")) return invalidBody("Clasificación inválida.");
    const data = { classification: body.classification, cause: String(body.cause ?? "").trim(), notes: String(body.notes ?? "").trim(),
      resolution: String(body.resolution ?? "").trim(), close: body.close === true } as const;
    const result = await updateDiscrepancyOnce(id, { ...data, actorId: user.id }, { idempotencyKey, payload: { id, ...data } },
      r => ({ id: r.id, status: r.status }));
    return idempotentResponse(result);
  } catch (e) { return warehouseApiError(e); }
}
