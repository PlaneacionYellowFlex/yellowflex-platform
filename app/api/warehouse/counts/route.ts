import { NextRequest, NextResponse } from "next/server";
import { WarehouseCountType } from "@prisma/client";
import { getWarehouseCapabilities, requireWarehouseCapability } from "@/lib/warehouse/access";
import { idempotentResponse, invalidBody, missingIdempotencyKey, readJsonObject, requireIdempotencyKey, warehouseApiError } from "@/lib/warehouse/api-error";
import { warehouseFolio } from "@/lib/warehouse/folio";
import { stockPage } from "@/repositories/warehouse-reporting.repository";
import { createWarehouseCountOnce, listWarehouseCounts } from "@/repositories/warehouse-counts.repository";

export async function GET(request?: Request) {
  try {
    const user = await requireWarehouseCapability("view");
    const caps = await getWarehouseCapabilities(user.id, undefined, user.roles);
    // YF-003 V2: candidatos buscados en el servidor (?q=), 60 por consulta, desde la existencia materializada.
    const q = request?.url ? new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) || null : null;
    const [counts, page] = await Promise.all([listWarehouseCounts(), stockPage({ search: q }, null, 60)]);
    const balances = page.rows;
    return NextResponse.json({
      canOperate: caps.operate,
      counts: counts.map(c => ({
        id: c.id, folio: c.folio, type: c.type, status: c.status, launchedAt: c.launchedAt,
        expectedQuantity: Number(c.expectedQuantity), countedQuantity: c.countedQuantity === null ? null : Number(c.countedQuantity), difference: c.difference === null ? null : Number(c.difference),
        item: { code: c.item.code, description: c.item.description, unit: c.item.baseUnit }, location: { code: c.location.code, name: c.location.name },
      })),
      // Candidatos: existencias positivas en ubicaciones y artículos activos.
      candidates: balances.filter(b => b.itemActive && b.locationActive && Number(b.quantity) > 0).map(b => ({
        itemId: b.itemId, itemCode: b.itemCode, itemDescription: b.itemDescription, unit: b.unit, locationId: b.locationId, locationCode: b.locationCode, locationName: b.locationCode,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return warehouseApiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    // Autorización antes de leer el cuerpo. Un segundo conteo abierto del mismo artículo y ubicación se rechaza (409).
    const user = await requireWarehouseCapability("operate");
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) return missingIdempotencyKey();
    const b = await readJsonObject(req);
    if (!b || typeof b.itemId !== "string" || typeof b.locationId !== "string" || !b.itemId || !b.locationId) return invalidBody("Artículo y ubicación son obligatorios.");
    const type = b.type === "SURPRISE" ? WarehouseCountType.SURPRISE : WarehouseCountType.CYCLE;
    const notes = typeof b.notes === "string" ? b.notes.trim() : "";
    const result = await createWarehouseCountOnce(
      { folio: warehouseFolio("CNT"), itemId: b.itemId, locationId: b.locationId, type, notes, actorId: user.id },
      { idempotencyKey, payload: { itemId: b.itemId, locationId: b.locationId, type, notes } },
      c => ({ id: c.id, folio: c.folio, expectedQuantity: c.expectedQuantity.toString() }),
    );
    return idempotentResponse(result);
  } catch (e) { return warehouseApiError(e); }
}
