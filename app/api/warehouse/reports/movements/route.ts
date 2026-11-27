import { NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { warehouseApiError } from "@/lib/warehouse/api-error";
import { countMovements, decodeCursor, isMovementType, searchMovements, type MovementFilters } from "@/repositories/warehouse-reporting.repository";

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
const day = (v: string | null, end = false) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + (end ? 86400000 : 0));
};

/**
 * Reporte de movimientos (solo lectura) con filtros por artículo, ubicación, tipo, usuario, referencia y fechas.
 * Paginación por cursor estable; ?format=csv exporta TODOS los registros que cumplen los filtros (por bloques de 1,000).
 */
export async function GET(request: Request) {
  try {
    await requireWarehouseCapability("view");
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const filters: MovementFilters = {
      itemId: url.searchParams.get("itemId") || null, locationId: url.searchParams.get("locationId") || null,
      type: type && isMovementType(type) ? type : null, actorId: url.searchParams.get("actorId") || null,
      reference: url.searchParams.get("reference")?.trim() || null, from: day(url.searchParams.get("from")), to: day(url.searchParams.get("to"), true),
    };
    if (type && !filters.type) return NextResponse.json({ error: "Tipo de movimiento inválido." }, { status: 400 });
    if (url.searchParams.get("format") === "csv") {
      const lines = [["Fecha", "Folio", "Tipo", "Artículo", "Descripción", "Origen", "Destino", "Cantidad", "Unidad", "Referencia", "Usuario", "Revertido por", "Notas"].join(",")];
      let cursor = null; let total = 0;
      for (;;) {
        const page = await searchMovements(filters, cursor, 1000);
        for (const r of page.rows) {
          total += 1;
          lines.push([r.occurredAt, r.folio, r.type, r.itemCode, r.itemDescription, r.originCode, r.destinationCode, r.quantity, r.unit,
            [r.referenceType, r.referenceNumber].filter(Boolean).join(" "), r.actorName, r.reversedBy, r.notes].map(csvCell).join(","));
        }
        if (!page.nextCursor) break;
        cursor = decodeCursor(page.nextCursor);
      }
      return new NextResponse("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="movimientos-almacen.csv"', "X-Total-Rows": String(total), "Cache-Control": "no-store" } });
    }
    const [page, total] = await Promise.all([
      searchMovements(filters, decodeCursor(url.searchParams.get("cursor")), Number(url.searchParams.get("limit") ?? 100)),
      countMovements(filters),
    ]);
    return NextResponse.json({ ...page, total }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return warehouseApiError(error); }
}
