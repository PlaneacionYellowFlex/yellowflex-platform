import { NextRequest } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { db } from "@/lib/db";
import { parseCountedQuantity } from "@/repositories/warehouse-counts.repository";
import { completeRecountOnce, WarehouseRecountError } from "@/repositories/warehouse-recounts.repository";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireWarehouseCapability("investigate");
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) return missingIdempotencyKey();
    const { id } = await params;
    const body = await readJsonObject(req);
    if (!body) return invalidBody();
    let quantity;
    try { quantity = parseCountedQuantity(body.countedQuantity); } catch { throw new WarehouseRecountError("Cantidad inválida; debe ser cero o positiva con máximo tres decimales."); }
    const notes = String(body.notes ?? "").trim();
    const recount = await db.warehouseDiscrepancyRecount.findUnique({ where: { id }, select: { discrepancyId: true } });
    if (!recount) throw new WarehouseRecountError("El reconteo no existe.");
    const result = await completeRecountOnce({ id, discrepancyId: recount.discrepancyId, quantity, notes, actorId: user.id },
      { idempotencyKey, payload: { id, countedQuantity: quantity.toFixed(3), notes } }, r => ({ ...r }));
    return idempotentResponse(result);
  } catch (e) { return warehouseApiError(e); }
}
