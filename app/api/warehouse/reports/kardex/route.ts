import { NextResponse } from "next/server";
import { requireWarehouseCapability } from "@/lib/warehouse/access";
import { warehouseApiError } from "@/lib/warehouse/api-error";
import { db } from "@/lib/db";
import { kardex } from "@/repositories/warehouse-reporting.repository";

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

/**
 * Kardex de un artículo (solo lectura): saldo acumulado desde el primer movimiento. ?itemId=&locationId=&cursor=&format=csv
 * La exportación CSV recorre TODAS las páginas (sin límite oculto) y respeta los mismos filtros que la pantalla.
 */
export async function GET(request: Request) {
  try {
    await requireWarehouseCapability("view");
    const url = new URL(request.url);
    const itemId = url.searchParams.get("itemId") ?? "";
    const locationId = url.searchParams.get("locationId") || null;
    if (!itemId) return NextResponse.json({ error: "Selecciona un artículo." }, { status: 400 });
    const item = await db.inventoryItem.findUnique({ where: { id: itemId }, select: { id: true, code: true, description: true, baseUnit: true, active: true } });
    if (!item) return NextResponse.json({ error: "El artículo no existe." }, { status: 404 });
    const location = locationId ? await db.warehouseLocation.findUnique({ where: { id: locationId }, select: { id: true, code: true } }) : null;
    if (locationId && !location) return NextResponse.json({ error: "La ubicación no existe." }, { status: 404 });
    if (url.searchParams.get("format") === "csv") {
      const lines = [["Secuencia", "Fecha", "Folio", "Tipo", "Origen", "Destino", "Cantidad", "Efecto", "Saldo", "Unidad", "Referencia", "Usuario", "Revertido por", "Notas"].join(",")];
      let cursor: { seq: number } | null = null;
      for (;;) {
        const page = await kardex(item.id, locationId, cursor, 2000);
        for (const r of page.rows) lines.push([r.seq, r.occurredAt, r.folio, r.type, r.originCode, r.destinationCode, r.quantity, r.delta, r.balance, r.unit,
          [r.referenceType, r.referenceNumber].filter(Boolean).join(" "), r.actorName, r.reversedBy, r.notes].map(csvCell).join(","));
        if (page.nextCursor === null) break;
        cursor = { seq: page.nextCursor };
      }
      const name = `kardex-${item.code}${location ? `-${location.code}` : ""}.csv`.replace(/[^A-Za-z0-9._-]/g, "_");
      return new NextResponse("﻿" + lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
    }
    const seq = Number(url.searchParams.get("cursor") ?? 0);
    const page = await kardex(item.id, locationId, Number.isInteger(seq) && seq > 0 ? { seq } : null, Number(url.searchParams.get("limit") ?? 200));
    return NextResponse.json({ item, location, ...page }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return warehouseApiError(error); }
}
