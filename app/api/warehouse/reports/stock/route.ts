import { NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { warehouseApiError } from "@/lib/warehouse/api-error";
import { decodeStockCursor, stockPage } from "@/repositories/warehouse-reporting.repository";

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

/**
 * YF-003 V2 · Consulta habitual de existencias por artículo y ubicación (solo lectura), paginada por cursor.
 * ?q=&itemId=&locationId=&cursor=&limit=&format=csv. Fuente: existencia materializada, reconciliada contra el libro mayor (R8).
 */
export async function GET(request: Request) {
  try {
    await requireWarehouseCapability("view");
    const url = new URL(request.url);
    const filters = { itemId: url.searchParams.get("itemId") || null, locationId: url.searchParams.get("locationId") || null,
      search: url.searchParams.get("q")?.trim().slice(0, 80) || null };
    if (url.searchParams.get("format") === "csv") {
      const lines = [["Artículo", "Descripción", "Almacén", "Ubicación", "Existencia", "Unidad", "Artículo activo", "Ubicación activa"].join(",")];
      let cursor: { itemCode: string; locationId: string } | null = null;
      for (;;) {
        const page = await stockPage(filters, cursor, 2000);
        for (const r of page.rows) lines.push([r.itemCode, r.itemDescription, r.warehouseCode, r.locationCode, r.quantity, r.unit, r.itemActive ? "Sí" : "No", r.locationActive ? "Sí" : "No"].map(csvCell).join(","));
        if (!page.nextCursor) break;
        cursor = decodeStockCursor(page.nextCursor);
      }
      return new NextResponse("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="existencias.csv"', "Cache-Control": "no-store" } });
    }
    const raw = url.searchParams.get("cursor");
    const cursor = decodeStockCursor(raw);
    if (raw && !cursor) return NextResponse.json({ error: "Cursor inválido." }, { status: 400 });
    return NextResponse.json(await stockPage(filters, cursor, Number(url.searchParams.get("limit") ?? 200)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return warehouseApiError(error); }
}
