import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { invalidBody, readJsonObject, warehouseApiError } from "@/lib/warehouse/api-error";
import { documentHandoffWithoutCustody } from "@/repositories/warehouse-reconciliation-exceptions.repository";

/** YF-003 V2 · Documenta una entrega histórica sin custodia (R3/R7). Requiere autorización de ajustes; no modifica movimientos ni existencias. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireWarehouseCapability("approve");
    const b = await readJsonObject(req);
    if (!b) return invalidBody();
    const r = await documentHandoffWithoutCustody({ movementId: b.movementId, reason: b.reason, evidence: b.evidence }, user.id);
    return NextResponse.json(r, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}
