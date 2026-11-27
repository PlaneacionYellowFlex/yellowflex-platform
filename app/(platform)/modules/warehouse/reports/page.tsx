"use client";

import { ArrowLeft, Download, FileSpreadsheet, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { MOVEMENT_TYPE_LABEL } from "@/components/warehouse/labels";

type Item = { id: string; code: string; description: string };
type Balance = { locationId: string; locationCode: string };
type Row = { id: string; folio: string; type: string; quantity: string; unit: string; occurredAt: string; itemCode: string; itemDescription: string;
  originCode: string | null; destinationCode: string | null; referenceType: string | null; referenceNumber: string | null; actorName: string | null; reversedBy: string | null };
const EMPTY = { itemId: "", locationId: "", type: "", reference: "", from: "", to: "" };
const qty = (v: string) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(Number(v));

/** YF-003 · Reporte de movimientos con filtros y exportación completa (la exportación aplica exactamente los mismos filtros). */
export default function MovementsReportPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Balance[]>([]);
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/warehouse/inventory", { cache: "no-store" }).then(r => r.json()).then(b => {
      if (!active) return;
      setItems(b.inventory ?? []);
      // V2: el inventario entrega el catálogo de ubicaciones; ya no se descarga cada fila artículo-ubicación.
      const list: Balance[] = (b.locations ?? []).map((l: { id: string; code: string; warehouseCode: string }) => ({ locationId: l.id, locationCode: l.code }));
      setLocations(list.sort((a, c) => a.locationCode.localeCompare(c.locationCode)));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const query = useMemo(() => new URLSearchParams(Object.entries(applied).filter(([, v]) => v)), [applied]);
  const fetchPage = useCallback(async (cursor: string | null, append: boolean) => {
    setLoading(true); setError("");
    try {
      const qs = new URLSearchParams(query); qs.set("limit", "100"); if (cursor) qs.set("cursor", cursor);
      const r = await fetch(`/api/warehouse/reports/movements?${qs}`, { cache: "no-store" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "No fue posible consultar los movimientos.");
      setRows(prev => (append ? [...prev, ...b.rows] : b.rows)); setNext(b.nextCursor); setTotal(b.total);
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible consultar los movimientos."); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void Promise.resolve().then(() => fetchPage(null, false)); }, [fetchPage]);
  function submit(e: FormEvent) { e.preventDefault(); setApplied({ ...filters }); }
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setFilters(f => ({ ...f, [k]: e.target.value }));
  const exportHref = `/api/warehouse/reports/movements?${new URLSearchParams([...query.entries(), ["format", "csv"]])}`;
  const control = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-800";

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <Link href="/modules/warehouse" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:underline"><ArrowLeft className="h-4 w-4" />Volver a Almacén</Link>
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-amber-700"><FileSpreadsheet className="h-4 w-4" />Almacén · Reportes</div>
        <h1 className="mt-2 text-3xl font-bold text-blue-950">Reporte de movimientos</h1>
        <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="text-xs font-bold uppercase text-slate-500">Artículo<select value={filters.itemId} onChange={set("itemId")} className={control}><option value="">Todos</option>{items.map(i => <option key={i.id} value={i.id}>{i.code}</option>)}</select></label>
          <label className="text-xs font-bold uppercase text-slate-500">Ubicación<select value={filters.locationId} onChange={set("locationId")} className={control}><option value="">Todas</option>{locations.map(l => <option key={l.locationId} value={l.locationId}>{l.locationCode}</option>)}</select></label>
          <label className="text-xs font-bold uppercase text-slate-500">Tipo<select value={filters.type} onChange={set("type")} className={control}><option value="">Todos</option>{Object.entries(MOVEMENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs font-bold uppercase text-slate-500">Folio o referencia<input value={filters.reference} onChange={set("reference")} className={control} /></label>
          <label className="text-xs font-bold uppercase text-slate-500">Desde<input type="date" value={filters.from} onChange={set("from")} className={control} /></label>
          <label className="text-xs font-bold uppercase text-slate-500">Hasta<input type="date" value={filters.to} onChange={set("to")} className={control} /></label>
          <div className="flex gap-2 md:col-span-3 lg:col-span-6">
            <button className="inline-flex items-center gap-2 rounded-xl bg-blue-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800"><Search className="h-4 w-4" />Aplicar filtros</button>
            <button type="button" onClick={() => { setFilters(EMPTY); setApplied(EMPTY); }} className="rounded-xl border px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">Limpiar</button>
            <a href={exportHref} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-blue-900 px-4 py-2.5 text-sm font-bold text-blue-950 transition hover:bg-blue-50"><Download className="h-4 w-4" />Exportar CSV ({total})</a>
          </div>
        </form>
      </header>
      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      <section className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-3">Fecha</th><th className="px-3 py-3">Folio</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Artículo</th><th className="px-3 py-3">Origen → Destino</th><th className="px-3 py-3 text-right">Cantidad</th><th className="px-3 py-3">Referencia</th><th className="px-3 py-3">Usuario</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(r => (
            <tr key={r.id} className="hover:bg-blue-50/40"><td className="whitespace-nowrap px-3 py-2">{new Date(r.occurredAt).toLocaleString("es-MX")}</td><td className="px-3 py-2 font-semibold text-blue-950">{r.folio}{r.reversedBy && <span className="ml-1 rounded-full bg-slate-100 px-2 text-[10px] text-slate-600">revertido</span>}</td>
              <td className="px-3 py-2">{MOVEMENT_TYPE_LABEL[r.type] ?? r.type}</td><td className="px-3 py-2"><b>{r.itemCode}</b><p className="text-xs text-slate-500">{r.itemDescription}</p></td>
              <td className="px-3 py-2 text-xs">{r.originCode ?? "—"} → {r.destinationCode ?? "—"}</td><td className="px-3 py-2 text-right font-bold">{qty(r.quantity)} <span className="text-[10px] font-normal text-slate-500">{r.unit}</span></td>
              <td className="px-3 py-2 text-xs">{[r.referenceType, r.referenceNumber].filter(Boolean).join(" ") || "—"}</td><td className="px-3 py-2 text-xs">{r.actorName ?? "—"}</td></tr>))}</tbody>
        </table>
        {rows.length === 0 && !loading && <p className="p-8 text-center text-sm text-slate-500">No hay movimientos con estos filtros.</p>}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>{rows.length} de {total} movimientos</span>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : next && <button onClick={() => void fetchPage(next, true)} className="rounded-lg border px-3 py-1.5 font-bold text-blue-950 hover:bg-blue-50">Cargar más</button>}</div>
      </section>
    </main>
  );
}
