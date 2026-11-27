"use client";

import { ArrowLeft, Boxes, History, Loader2, MapPin, Plus, Power, Save, Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Unit = { code: string; label: string };
type Item = { id: string; code: string; description: string; baseUnit: string; active: boolean; stock: string; locations: number; hasHistory: boolean; updatedAt: string };
type Warehouse = { id: string; code: string; name: string; active: boolean };
type Location = { id: string; code: string; name: string; active: boolean; warehouseId: string; warehouseCode: string; warehouseName: string; stockLines: number };
type HistoryRow = { id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string; actor: string; createdAt: string };
type Editing = { kind: "item" | "location"; id: string; label: string; mode: "edit" | "toggle"; active: boolean; description?: string; baseUnit?: string; name?: string; hasHistory?: boolean };

const ACTION_LABEL: Record<string, string> = { CREATE: "Alta", UPDATE: "Edición", ACTIVATE: "Activación", INACTIVATE: "Inactivación" };
const qty = (v: string) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(Number(v));
const input = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none";
const primary = "inline-flex items-center gap-2 rounded-xl bg-blue-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:opacity-50";

async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? "No fue posible guardar el cambio.");
  return b;
}

/**
 * YF-003 V2 · Administración del catálogo de Almacén. Requiere el permiso sensible de catálogo.
 * No elimina registros, no cambia códigos y nunca modifica existencias; cada cambio exige motivo y queda en el historial.
 */
export default function CatalogPage() {
  const [tab, setTab] = useState<"items" | "locations">("items");
  const [q, setQ] = useState(""); const [status, setStatus] = useState("all"); const [unit, setUnit] = useState(""); const [warehouseId, setWarehouseId] = useState("");
  const [items, setItems] = useState<Item[]>([]); const [locations, setLocations] = useState<Location[]>([]);
  const [units, setUnits] = useState<Unit[]>([]); const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [total, setTotal] = useState(0); const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: "", description: "", baseUnit: "", name: "", warehouseId: "", reason: "" });
  const [editing, setEditingState] = useState<(Editing & { reason: string }) | null>(null);
  // Al abrir o cerrar el diálogo se limpia el error anterior; al escribir dentro del diálogo se conserva.
  const setEditing = (next: (Editing & { reason: string }) | null) => { if (!next || !editing || next.id !== editing.id || next.mode !== editing.mode) setError(""); setEditingState(next); };
  const [history, setHistory] = useState<{ label: string; rows: HistoryRow[] } | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true); setError("");
    try {
      const qs = new URLSearchParams({ limit: "50", status, ...(q.trim() ? { q: q.trim() } : {}), ...(cursor ? { cursor } : {}),
        ...(tab === "items" && unit ? { unit } : {}), ...(tab === "locations" && warehouseId ? { warehouseId } : {}) });
      const r = await fetch(`/api/warehouse/catalog/${tab}?${qs}`, { cache: "no-store" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "No fue posible consultar el catálogo.");
      if (tab === "items") { setItems(prev => (cursor ? [...prev, ...b.rows] : b.rows)); setUnits(b.units ?? []); }
      else { setLocations(prev => (cursor ? [...prev, ...b.rows] : b.rows)); setWarehouses(b.warehouses ?? []); }
      setTotal(b.total ?? 0); setNext(b.nextCursor ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible consultar el catálogo."); }
    finally { setLoading(false); }
  }, [tab, q, status, unit, warehouseId]);

  useEffect(() => { void Promise.resolve().then(() => load(null)); }, [load]);

  async function create() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (tab === "items") {
        const b = await send("/api/warehouse/catalog/items", "POST", { code: form.code, description: form.description, baseUnit: form.baseUnit, reason: form.reason });
        setMessage(`Artículo ${b.item.code} dado de alta.`);
      } else {
        const b = await send("/api/warehouse/catalog/locations", "POST", { warehouseId: form.warehouseId, code: form.code, name: form.name, reason: form.reason });
        setMessage(`Ubicación ${b.location.code} dada de alta.`);
      }
      setCreating(false); setForm({ code: "", description: "", baseUnit: "", name: "", warehouseId: "", reason: "" }); await load(null);
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible guardar."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!editing) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const url = `/api/warehouse/catalog/${editing.kind === "item" ? "items" : "locations"}/${editing.id}`;
      const body = editing.mode === "toggle" ? { active: !editing.active, reason: editing.reason }
        : editing.kind === "item" ? { description: editing.description, ...(editing.hasHistory ? {} : { baseUnit: editing.baseUnit }), reason: editing.reason }
        : { name: editing.name, reason: editing.reason };
      const b = await send(url, "PATCH", body);
      setMessage(b.unchanged ? "No había cambios que registrar." : `${editing.label}: cambio registrado.`);
      setEditing(null); await load(null);
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible guardar."); }
    finally { setBusy(false); }
  }

  async function showHistory(entityType: "ITEM" | "LOCATION", id: string, label: string) {
    setError("");
    try {
      const r = await fetch(`/api/warehouse/catalog/history?entityType=${entityType}&entityId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "No fue posible consultar el historial.");
      setHistory({ label, rows: b.rows });
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible consultar el historial."); }
  }

  const reasonOk = (s: string) => s.trim().length >= 8;
  const canCreate = reasonOk(form.reason) && form.code.trim().length >= 1 &&
    (tab === "items" ? form.description.trim().length >= 3 && !!form.baseUnit : form.name.trim().length >= 2 && !!form.warehouseId);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <Link href="/modules/warehouse" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:underline"><ArrowLeft className="h-4 w-4" />Volver a Almacén</Link>
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-amber-700"><Boxes className="h-4 w-4" />Almacén · Catálogo</div>
        <h1 className="mt-2 text-3xl font-bold text-blue-950">Catálogo de artículos y ubicaciones</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">Altas, ediciones descriptivas e inactivación controlada. Nada se elimina, los códigos no cambian y la existencia no se modifica desde aquí. Cada cambio exige motivo y queda en el historial.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {([["items", "Artículos", Boxes], ["locations", "Ubicaciones", MapPin]] as const).map(([key, label, Icon]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setNext(null); setCreating(false); setStatus("all"); setQ(""); }}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${tab === key ? "bg-blue-900 text-white" : "border bg-white text-blue-950 hover:bg-slate-50"}`}><Icon className="h-4 w-4" />{label}</button>))}
        <button onClick={() => setCreating(v => !v)} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900 transition hover:bg-amber-100"><Plus className="h-4 w-4" />{tab === "items" ? "Nuevo artículo" : "Nueva ubicación"}</button>
      </div>

      {error && !editing && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {message && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>}

      {creating && (
        <section className="grid gap-3 rounded-3xl border border-amber-200 bg-white p-5 shadow-sm sm:grid-cols-2">
          <h2 className="font-bold text-blue-950 sm:col-span-2">{tab === "items" ? "Alta de artículo" : "Alta de ubicación"}</h2>
          {tab === "locations" && <label className="text-sm font-semibold">Almacén<select className={input} value={form.warehouseId} onChange={e => setForm({ ...form, warehouseId: e.target.value })}>
            <option value="">Selecciona…</option>{warehouses.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>}
          <label className="text-sm font-semibold">Código<input className={input} value={form.code} maxLength={50} onChange={e => setForm({ ...form, code: e.target.value })} /></label>
          {tab === "items" ? <>
            <label className="text-sm font-semibold">Unidad base<select className={input} value={form.baseUnit} onChange={e => setForm({ ...form, baseUnit: e.target.value })}>
              <option value="">Selecciona…</option>{units.map(u => <option key={u.code} value={u.code}>{u.code} · {u.label}</option>)}</select></label>
            <label className="text-sm font-semibold sm:col-span-2">Descripción<input className={input} value={form.description} maxLength={300} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </> : <label className="text-sm font-semibold">Nombre<input className={input} value={form.name} maxLength={120} onChange={e => setForm({ ...form, name: e.target.value })} /></label>}
          <label className="text-sm font-semibold sm:col-span-2">Motivo del alta<input className={input} value={form.reason} maxLength={500} placeholder="Mínimo 8 caracteres" onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
          <div className="flex gap-2 sm:col-span-2"><button className={primary} disabled={busy || !canCreate} onClick={() => void create()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar</button>
            <button className="rounded-xl border px-4 py-2.5 text-sm font-bold" onClick={() => setCreating(false)}>Cancelar</button></div>
        </section>
      )}

      <section className="flex flex-wrap items-end gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="min-w-56 flex-1 text-sm font-semibold">Buscar<div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className={`${input} pl-9`} value={q} placeholder={tab === "items" ? "Código o descripción" : "Código o nombre"} onChange={e => setQ(e.target.value)} /></div></label>
        <label className="text-sm font-semibold">Estado<select className={input} value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>
        {tab === "items" ? <label className="text-sm font-semibold">Unidad<select className={input} value={unit} onChange={e => setUnit(e.target.value)}><option value="">Todas</option>{units.map(u => <option key={u.code} value={u.code}>{u.code}</option>)}</select></label>
          : <label className="text-sm font-semibold">Almacén<select className={input} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">Todos</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code}</option>)}</select></label>}
        <span className="text-xs text-slate-500">{total} registro(s)</span>
      </section>

      <section className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">{tab === "items"
            ? <tr><th className="p-3">Código</th><th className="p-3">Descripción</th><th className="p-3">Unidad</th><th className="p-3 text-right">Existencia</th><th className="p-3">Estado</th><th className="p-3 text-right">Acciones</th></tr>
            : <tr><th className="p-3">Almacén</th><th className="p-3">Código</th><th className="p-3">Nombre</th><th className="p-3 text-right">Artículos con existencia</th><th className="p-3">Estado</th><th className="p-3 text-right">Acciones</th></tr>}</thead>
          <tbody className="divide-y">{tab === "items" ? items.map(i => (
            <tr key={i.id} className={i.active ? "" : "bg-slate-50 text-slate-500"}>
              <td className="p-3 font-mono font-semibold">{i.code}</td><td className="p-3">{i.description}</td><td className="p-3">{i.baseUnit}</td>
              <td className="p-3 text-right">{qty(i.stock)}{i.locations > 0 && <span className="block text-[11px] text-slate-500">{i.locations} ubicación(es)</span>}</td>
              <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${i.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{i.active ? "Activo" : "Inactivo"}</span></td>
              <td className="space-x-1 whitespace-nowrap p-3 text-right">
                <button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => setEditing({ kind: "item", id: i.id, label: i.code, mode: "edit", active: i.active, description: i.description, baseUnit: i.baseUnit, hasHistory: i.hasHistory, reason: "" })}>Editar</button>
                <button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => setEditing({ kind: "item", id: i.id, label: i.code, mode: "toggle", active: i.active, reason: "" })}><Power className="inline h-3 w-3" /> {i.active ? "Inactivar" : "Activar"}</button>
                <button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => void showHistory("ITEM", i.id, i.code)}><History className="inline h-3 w-3" /> Historial</button>
              </td></tr>))
            : locations.map(l => (
            <tr key={l.id} className={l.active ? "" : "bg-slate-50 text-slate-500"}>
              <td className="p-3">{l.warehouseCode}</td><td className="p-3 font-mono font-semibold">{l.code}</td><td className="p-3">{l.name}</td><td className="p-3 text-right">{l.stockLines}</td>
              <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${l.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{l.active ? "Activa" : "Inactiva"}</span></td>
              <td className="space-x-1 whitespace-nowrap p-3 text-right">
                <button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => setEditing({ kind: "location", id: l.id, label: `${l.warehouseCode}/${l.code}`, mode: "edit", active: l.active, name: l.name, reason: "" })}>Editar</button>
                <button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => setEditing({ kind: "location", id: l.id, label: `${l.warehouseCode}/${l.code}`, mode: "toggle", active: l.active, reason: "" })}><Power className="inline h-3 w-3" /> {l.active ? "Inactivar" : "Activar"}</button>
                <button className="rounded-lg border px-2 py-1 text-xs font-bold" onClick={() => void showHistory("LOCATION", l.id, `${l.warehouseCode}/${l.code}`)}><History className="inline h-3 w-3" /> Historial</button>
              </td></tr>))}</tbody>
        </table>
        {loading && <div className="flex items-center justify-center p-4 text-sm"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Consultando…</div>}
        {!loading && (tab === "items" ? items : locations).length === 0 && <p className="p-6 text-center text-sm text-slate-500">Sin registros con esos filtros.</p>}
        {next && !loading && <div className="border-t p-3 text-center"><button className="rounded-xl border px-4 py-2 text-sm font-bold" onClick={() => void load(next)}>Cargar más</button></div>}
      </section>

      {editing && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg space-y-3 rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-blue-950">{editing.mode === "toggle" ? (editing.active ? "Inactivar" : "Activar") : "Editar"} · {editing.label}</h2>
              <button aria-label="Cerrar" onClick={() => setEditing(null)}><X className="h-5 w-5" /></button></div>
            {editing.mode === "toggle" ? <p className="text-sm text-slate-600">{editing.active
              ? "Solo se inactiva sin existencia, sin custodias ni conteos pendientes. El historial se conserva y podrás reactivarlo después."
              : "Al activarlo volverá a estar disponible para registrar movimientos."}</p>
              : editing.kind === "item" ? <>
                <label className="block text-sm font-semibold">Descripción<input className={input} value={editing.description ?? ""} maxLength={300} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
                <label className="block text-sm font-semibold">Unidad base<select className={input} value={editing.baseUnit} disabled={editing.hasHistory} onChange={e => setEditing({ ...editing, baseUnit: e.target.value })}>
                  {units.map(u => <option key={u.code} value={u.code}>{u.code} · {u.label}</option>)}</select>
                  {editing.hasHistory && <span className="text-xs font-normal text-slate-500">No se puede cambiar: el artículo ya tiene movimientos.</span>}</label>
              </> : <label className="block text-sm font-semibold">Nombre<input className={input} value={editing.name ?? ""} maxLength={120} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>}
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <label className="block text-sm font-semibold">Motivo<input className={input} value={editing.reason} maxLength={500} placeholder="Mínimo 8 caracteres" onChange={e => setEditing({ ...editing, reason: e.target.value })} /></label>
            <div className="flex justify-end gap-2"><button className="rounded-xl border px-4 py-2.5 text-sm font-bold" onClick={() => setEditing(null)}>Cancelar</button>
              <button className={primary} disabled={busy || !reasonOk(editing.reason)} onClick={() => void save()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Confirmar</button></div>
          </div>
        </div>
      )}

      {history && (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><h2 className="font-bold text-blue-950">Historial · {history.label}</h2><button aria-label="Cerrar historial" onClick={() => setHistory(null)}><X className="h-5 w-5" /></button></div>
          {history.rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">Sin cambios registrados desde Platform.</p> : (
            <ul className="mt-3 space-y-2 text-sm">{history.rows.map(h => (
              <li key={h.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><strong>{ACTION_LABEL[h.action] ?? h.action}</strong> · {h.actor} · {new Date(h.createdAt).toLocaleString("es-MX")}
                <span className="block text-slate-600">Motivo: {h.reason}</span>
                {h.before && h.after && <span className="block text-xs text-slate-500">{Object.keys(h.after).filter(k => JSON.stringify(h.before?.[k]) !== JSON.stringify(h.after?.[k])).map(k => `${k}: ${String(h.before?.[k])} → ${String(h.after?.[k])}`).join(" · ")}</span>}
              </li>))}</ul>)}
        </section>
      )}
    </main>
  );
}
