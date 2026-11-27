import { NextRequest } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { warehouseFolio } from "@/lib/warehouse/folio";
import { requestRecountOnce } from "@/repositories/warehouse-recounts.repository";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireWarehouseCapability("investigate");
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { id } = await params;
    const body = await readJsonObject(req);
    if (!body) return invalidBody();
    const reason = String(body.reason ?? "").trim();
    const result = await requestRecountOnce({ discrepancyId: id, reason, actorId: user.id, folio: warehouseFolio("REC") },
      { idempotencyKey, payload: { id, reason } }, r => ({ id: r.id, folio: r.folio }));
    return idempotentResponse(result);
  } catch (e) { return warehouseApiError(e); }
}
