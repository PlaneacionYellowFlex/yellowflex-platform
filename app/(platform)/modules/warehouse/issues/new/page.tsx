"use client";

import { ArrowLeft, CheckCircle2, Loader2, LogOut } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { idempotentFetch } from "@/components/warehouse/idempotent-fetch";

type Item = { id: string; code: string; description: string; baseUnit: string };
type Location = { id: string; code: string; name: string; warehouseName: string };

/** YF-003 · Salida de material (no es entrega a Producción ni consumo). Motivo, destino y referencia obligatorios. */
export default function NewIssuePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ itemId: "", originLocationId: "", quantity: "", reason: "", destination: "", referenceNumber: "", notes: "" });
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ folio: string; itemCode: string; quantity: number; unit: string; originLocation: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/warehouse/movements", { credentials: "same-origin", cache: "no-store" })
      .then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "No fue posible cargar el catálogo."); return b; })
      .then(b => { if (active) { setItems(b.items); setLocations(b.locations); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "No fue posible cargar el catálogo."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(i => !q || `${i.code} ${i.description}`.toLowerCase().includes(q)).slice(0, 40);
  }, [items, query]);
  const item = items.find(i => i.id === form.itemId);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    if (form.reason.trim().length < 8) { setError("Indica el motivo de la salida (mínimo 8 caracteres)."); return; }
    savingRef.current = true; setSaving(true); setError("");
    try {
      const r = await idempotentFetch("/api/warehouse/movements/issues", form);
      if (!r.ok) throw new Error(r.body.error ?? "No fue posible registrar la salida.");
      setDone((r.body as { movement: NonNullable<typeof done> }).movement);
      setForm({ itemId: "", originLocationId: "", quantity: "", reason: "", destination: "", referenceNumber: "", notes: "" });
    } catch (err) { setError(err instanceof Error ? err.message : "No fue posible registrar la salida."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  const input = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-800 focus:ring-2 focus:ring-blue-100";
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <Link href="/modules/warehouse" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:underline"><ArrowLeft className="h-4 w-4" />Volver a Almacén</Link>
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-amber-700"><LogOut className="h-4 w-4" />Almacén · Salida</div>
        <h1 className="mt-2 text-3xl font-bold text-blue-950">Salida de material</h1>
        <p className="mt-2 text-sm text-slate-600">Material que sale del inventario de Almacén (por ejemplo, a un proveedor o cliente). Para Producción usa «Entregar a Producción».</p>
      </header>
      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {done && <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-5 w-5" />Salida {done.folio} confirmada: {done.quantity} {done.unit} de {done.itemCode} desde {done.originLocation}.</div>}
      {loading ? <div className="flex min-h-40 items-center justify-center rounded-3xl border bg-white"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Cargando catálogo…</div> : (
        <form onSubmit={submit} className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2">
          <label className="text-xs font-black uppercase text-slate-500 sm:col-span-2">Artículo
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar código o descripción…" className={input} />
            <select required value={form.itemId} onChange={set("itemId")} className={input}><option value="">Selecciona artículo</option>{visible.map(i => <option key={i.id} value={i.id}>{i.code} · {i.description}</option>)}</select>
          </label>
          <label className="text-xs font-black uppercase text-slate-500">Ubicación de origen<select required value={form.originLocationId} onChange={set("originLocationId")} className={input}><option value="">Selecciona ubicación</option>{locations.map(l => <option key={l.id} value={l.id}>{l.code} · {l.warehouseName}</option>)}</select></label>
          <label className="text-xs font-black uppercase text-slate-500">Cantidad {item ? `(${item.baseUnit})` : ""}<input required inputMode="decimal" value={form.quantity} onChange={set("quantity")} placeholder="Ej. 12.5" className={input} /></label>
          <label className="text-xs font-black uppercase text-slate-500 sm:col-span-2">Motivo<input required value={form.reason} onChange={set("reason")} placeholder="Ej. Devolución a proveedor por defecto de fabricación" className={input} /></label>
          <label className="text-xs font-black uppercase text-slate-500">Destino<input required value={form.destination} onChange={set("destination")} placeholder="Ej. Proveedor / cliente / área" className={input} /></label>
          <label className="text-xs font-black uppercase text-slate-500">Documento u orden de referencia<input required value={form.referenceNumber} onChange={set("referenceNumber")} className={input} /></label>
          <label className="text-xs font-black uppercase text-slate-500 sm:col-span-2">Observaciones<input value={form.notes} onChange={set("notes")} placeholder="Opcional" className={input} /></label>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2">Platform valida la existencia disponible al confirmar. Una salida no se edita ni se borra: si fue un error, un supervisor distinto registra el reverso desde el Kardex.</div>
          <div className="flex justify-end sm:col-span-2"><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-950 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-800 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Procesando…" : "Confirmar salida"}</button></div>
        </form>
      )}
    </main>
  );
}
