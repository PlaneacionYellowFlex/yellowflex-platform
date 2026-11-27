"use client";

import { ArrowLeft, Download, History, Loader2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { idempotentFetch } from "@/components/warehouse/idempotent-fetch";
import { MOVEMENT_TYPE_LABEL } from "@/components/warehouse/labels";

type Item = { id: string; code: string; description: string; unit: string; active?: boolean };
type Balance = { itemId: string; locationId: string; locationCode: string; quantity: number };
type Row = { id: string; seq: number; folio: string; type: string; quantity: string; delta: string; balance: string; unit: string; occurredAt: string;
  originCode: string | null; destinationCode: string | null; referenceType: string | null; referenceNumber: string | null; notes: string | null; actorName: string | null; reversedBy: string | null };

const TYPE_LABEL = MOVEMENT_TYPE_LABEL;
const REVERSIBLE = ["EXTERNAL_RECEIPT", "EXTERNAL_ISSUE", "INTERNAL_TRANSFER", "OPERATIONAL_HANDOFF"];
const qty = (v: string) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(Number(v));

/** YF-003 · Kardex: cada movimiento con su efecto y el saldo acumulado; desde aquí un supervisor registra reversos trazables. */
export default function KardexPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [canReverse, setCanReverse] = useState(false);
  const [reverse, setReverse] = useState<{ row: Row; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const fromUrl = new URLSearchParams(window.location.search).get("itemId");
    void Promise.all([
      fetch("/api/warehouse/inventory", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/warehouse/capabilities", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)),
    ]).then(([inv, caps]) => {
      if (!active) return;
      setItems(inv.inventory ?? []);
      setCanReverse(caps?.capabilities?.investigate === true);
      if (fromUrl) setItemId(fromUrl);
    }).catch(() => { if (active) setError("No fue posible cargar el catálogo."); });
    return () => { active = false; };
  }, []);

  const load = useCallback(async (append: boolean, cursor: number | null) => {
    if (!itemId) return;
    setLoading(true); setError("");
    try {
      const qs = new URLSearchParams({ itemId, ...(locationId ? { locationId } : {}), ...(cursor ? { cursor: String(cursor) } : {}), limit: "200" });
      const r = await fetch(`/api/warehouse/reports/kardex?${qs}`, { cache: "no-store" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "No fue posible consultar el Kardex.");
      setRows(prev => (append ? [...prev, ...b.rows] : b.rows)); setNext(b.nextCursor);
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible consultar el Kardex."); }
    finally { setLoading(false); }
  }, [itemId, locationId]);
  useEffect(() => { void Promise.resolve().then(() => load(false, null)); }, [load]);
  // V2: ubicaciones con existencia del artículo elegido, desde la consulta paginada de existencias (solo ese artículo).
  useEffect(() => {
    let active = true;
    if (!itemId) { void Promise.resolve().then(() => { if (active) setBalances([]); }); return () => { active = false; }; }
    void fetch(`/api/warehouse/reports/stock?${new URLSearchParams({ itemId, limit: "500" })}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : { rows: [] }))
      .then((b: { rows?: { itemId: string; locationId: string; locationCode: string; quantity: string }[] }) => {
        if (active) setBalances((b.rows ?? []).map(r => ({ itemId: r.itemId, locationId: r.locationId, locationCode: r.locationCode, quantity: Number(r.quantity) })));
      }).catch(() => undefined);
    return () => { active = false; };
  }, [itemId]);

  const item = items.find(i => i.id === itemId);
  const locations = balances;
  const visible = useMemo(() => { const q = query.trim().toLowerCase(); return items.filter(i => !q || `${i.code} ${i.description}`.toLowerCase().includes(q)).slice(0, 50); }, [items, query]);
  const exportHref = itemId ? `/api/warehouse/reports/kardex?${new URLSearchParams({ itemId, ...(locationId ? { locationId } : {}), format: "csv" })}` : "#";

  async function confirmReverse() {
    if (!reverse || busy) return;
    if (reverse.reason.trim().length < 8) { setError("Indica el motivo del reverso (mínimo 8 caracteres)."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await idempotentFetch(`/api/warehouse/movements/${reverse.row.id}/reverse`, { reason: reverse.reason.trim() });
      if (!r.ok) throw new Error(r.body.error ?? "No fue posible registrar el reverso.");
      const rev = (r.body as { reversal: { reversalFolio: string; originalFolio: string } }).reversal;
      setMessage(`Reverso ${rev.reversalFolio} registrado para ${rev.originalFolio}. El movimiento original se conserva.`);
      setReverse(null); await load(false, null);
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible registrar el reverso."); }
    finally { setBusy(false); }
  }

  const control = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-800";
  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <Link href="/modules/warehouse" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:underline"><ArrowLeft className="h-4 w-4" />Volver a Almacén</Link>
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-amber-700"><History className="h-4 w-4" />Almacén · Kardex</div>
        <h1 className="mt-2 text-3xl font-bold text-blue-950">Kardex por artículo</h1>
        <p className="mt-2 text-sm text-slate-600">Saldo acumulado desde el primer movimiento. Sin ubicación: existencia total en Almacén (las transferencias suman cero; lo entregado a Producción sale del saldo y se controla como custodia).</p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_220px_auto]">
          <label className="text-xs font-bold uppercase text-slate-500">Buscar<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Código o descripción" className={control} /></label>
          <label className="text-xs font-bold uppercase text-slate-500">Artículo<select value={itemId} onChange={e => { setItemId(e.target.value); setLocationId(""); }} className={control}><option value="">Selecciona artículo</option>{visible.map(i => <option key={i.id} value={i.id}>{i.code}{i.active === false ? " (inactivo)" : ""} · {i.description}</option>)}{item && !visible.some(v => v.id === item.id) && <option value={item.id}>{item.code}</option>}</select></label>
          <label className="text-xs font-bold uppercase text-slate-500">Ubicación<select value={locationId} onChange={e => setLocationId(e.target.value)} disabled={!itemId} className={control}><option value="">Todas (total Almacén)</option>{locations.map(l => <option key={l.locationId} value={l.locationId}>{l.locationCode}</option>)}</select></label>
          <a href={exportHref} aria-disabled={!itemId} className={`mt-5 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition ${itemId ? "border-blue-900 text-blue-950 hover:bg-blue-50" : "pointer-events-none border-slate-200 text-slate-400"}`}><Download className="h-4 w-4" />Exportar CSV</a>
        </div>
      </header>
      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">{message}</div>}
      {reverse && (
        <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-bold text-blue-950">Reversar {reverse.row.folio} · {TYPE_LABEL[reverse.row.type]} {qty(reverse.row.quantity)} {reverse.row.unit}</h2>
          <p className="mt-1 text-xs text-amber-900">Se registrará un movimiento compensatorio; el original no se modifica. Debe hacerlo una persona distinta de quien registró el movimiento.</p>
          <textarea value={reverse.reason} onChange={e => setReverse({ ...reverse, reason: e.target.value })} placeholder="Motivo del reverso (mínimo 8 caracteres)" className="mt-3 w-full rounded-xl border bg-white p-3 text-sm" />
          <div className="mt-3 flex justify-end gap-2"><button onClick={() => setReverse(null)} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold">Cancelar</button><button disabled={busy || reverse.reason.trim().length < 8} onClick={() => void confirmReverse()} className="inline-flex items-center gap-2 rounded-xl bg-blue-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-800 disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Procesando…" : "Confirmar reverso"}</button></div>
        </section>
      )}
      {!itemId ? <div className="rounded-3xl border border-dashed bg-white p-10 text-center text-sm text-slate-500">Selecciona un artículo para ver su Kardex.</div> : (
        <section className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-3">#</th><th className="px-3 py-3">Fecha</th><th className="px-3 py-3">Folio</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Origen → Destino</th><th className="px-3 py-3 text-right">Efecto</th><th className="px-3 py-3 text-right">Saldo</th><th className="px-3 py-3">Referencia</th><th className="px-3 py-3">Usuario</th><th className="px-3 py-3">Estado</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map(r => (
              <tr key={r.id} className="hover:bg-blue-50/40">
                <td className="px-3 py-2 text-slate-400">{r.seq}</td><td className="whitespace-nowrap px-3 py-2">{new Date(r.occurredAt).toLocaleString("es-MX")}</td>
                <td className="px-3 py-2 font-semibold text-blue-950">{r.folio}</td><td className="px-3 py-2">{TYPE_LABEL[r.type] ?? r.type}</td>
                <td className="px-3 py-2 text-xs">{r.originCode ?? "—"} → {r.destinationCode ?? "—"}</td>
                <td className={`px-3 py-2 text-right font-semibold ${Number(r.delta) > 0 ? "text-emerald-700" : Number(r.delta) < 0 ? "text-red-700" : "text-slate-400"}`}>{Number(r.delta) > 0 ? "+" : ""}{qty(r.delta)}</td>
                <td className="px-3 py-2 text-right font-bold text-blue-950">{qty(r.balance)} <span className="text-[10px] font-normal text-slate-500">{r.unit}</span></td>
                <td className="px-3 py-2 text-xs">{[r.referenceType, r.referenceNumber].filter(Boolean).join(" ") || "—"}</td><td className="px-3 py-2 text-xs">{r.actorName ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.reversedBy ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">Revertido ({r.reversedBy})</span>
                  : r.referenceType === "REVERSO" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">Reverso</span>
                  : canReverse && REVERSIBLE.includes(r.type) ? <button onClick={() => setReverse({ row: r, reason: "" })} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 font-semibold text-blue-950 transition hover:border-blue-800 hover:bg-blue-50"><Undo2 className="h-3 w-3" />Reversar</button>
                  : <span className="text-emerald-700">Confirmado</span>}</td>
              </tr>))}</tbody>
          </table>
          {rows.length === 0 && !loading && <p className="p-8 text-center text-sm text-slate-500">Este artículo no tiene movimientos.</p>}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>{rows.length} movimientos mostrados</span>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : next && <button onClick={() => void load(true, next)} className="rounded-lg border px-3 py-1.5 font-bold text-blue-950 hover:bg-blue-50">Cargar más</button>}</div>
        </section>
      )}
    </main>
  );
}
