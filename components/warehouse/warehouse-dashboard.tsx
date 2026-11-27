"use client";

import { AlertTriangle, Clock3, Gauge, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Dashboard = {
  generatedAt: string; activeItems: number; activeLocations: number;
  stockByUnit: { unit: string; quantity: string | null; items: number }[];
  custodyByStatus: { status: string; unit: string; quantity: string | null; count: number; oldest: string | null }[];
  openCounts: number; oldestOpenCount: string | null; openDiscrepancies: number; oldestOpenDiscrepancy: string | null;
  adjustmentsAwaitingDecision: number; countAccuracy90d: { exact: number; completed: number; percent: number } | null; itemsWithoutMovement90d: number;
};

const STATUS: Record<string, string> = { IN_TRANSIT: "En tránsito a Producción", AVAILABLE: "Disponible en Producción", RETURN_IN_TRANSIT: "Devolución pendiente de recibir" };
const qty = (v: string | null) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(Number(v ?? 0));
const age = (iso: string | null) => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "hoy" : days === 1 ? "1 día" : `${days} días`;
};

/**
 * YF-003 · Tablero de Almacén: indicadores deterministas calculados en el servidor desde el libro mayor, custodias, conteos y
 * expedientes. Las cantidades se agrupan por unidad (no se suman kilogramos con piezas) y no hay valores monetarios.
 */
export default function WarehouseDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/warehouse/reports/dashboard", { credentials: "same-origin", cache: "no-store" })
      .then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "No fue posible calcular los indicadores."); return b as Dashboard; })
      .then(b => { if (active) setData(b); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "No fue posible calcular los indicadores."); });
    return () => { active = false; };
  }, []);
  if (error) return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</section>;
  if (!data) return <section className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Calculando indicadores…</section>;
  const pending = [
    { label: "Conteos abiertos", value: data.openCounts, oldest: data.oldestOpenCount, href: "/modules/warehouse/counts" },
    { label: "Diferencias en investigación", value: data.openDiscrepancies, oldest: data.oldestOpenDiscrepancy, href: "/modules/warehouse/discrepancies" },
    { label: "Ajustes por decidir", value: data.adjustmentsAwaitingDecision, oldest: null, href: "/modules/warehouse/discrepancies" },
  ];
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-label="Indicadores de Almacén">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-amber-700"><Gauge className="h-4 w-4" />Indicadores</p>
          <h2 className="mt-1 text-xl font-bold text-blue-950">Estado del inventario</h2>
        </div>
        <p className="text-xs text-slate-500">Calculado {new Date(data.generatedAt).toLocaleString("es-MX")} desde el libro mayor</p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {pending.map(p => (
          <Link key={p.label} href={p.href} className="group rounded-2xl border border-slate-200 p-4 transition hover:border-blue-300 hover:bg-blue-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
            <p className="text-xs font-semibold text-slate-500">{p.label}</p>
            <p className={`mt-1 text-3xl font-bold ${p.value > 0 ? "text-amber-700" : "text-blue-950"}`}>{p.value}</p>
            {p.oldest && p.value > 0 && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3 w-3" />Más antiguo: {age(p.oldest)}</p>}
          </Link>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-blue-950">Existencia en Almacén por unidad</h3>
          {data.stockByUnit.length === 0 ? <p className="mt-2 text-sm text-slate-500">Sin existencias registradas.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{data.stockByUnit.map(r => <li key={r.unit} className="flex justify-between"><span>{r.unit} <span className="text-xs text-slate-500">({r.items} códigos)</span></span><b>{qty(r.quantity)}</b></li>)}</ul>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-blue-950">Material bajo custodia de Producción</h3>
          {data.custodyByStatus.length === 0 ? <p className="mt-2 text-sm text-slate-500">Sin custodias abiertas.</p> : (
            <ul className="mt-2 space-y-1 text-sm">{data.custodyByStatus.map(r => <li key={r.status + r.unit} className="flex justify-between gap-2"><span>{STATUS[r.status] ?? r.status} <span className="text-xs text-slate-500">({r.count}{r.oldest ? ` · ${age(r.oldest)}` : ""})</span></span><b>{qty(r.quantity)} {r.unit}</b></li>)}</ul>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 p-4 text-sm">
          <h3 className="font-bold text-blue-950">Control interno (90 días)</h3>
          <p className="mt-2 flex justify-between"><span>Exactitud de conteos</span><b>{data.countAccuracy90d ? `${data.countAccuracy90d.percent}% (${data.countAccuracy90d.exact}/${data.countAccuracy90d.completed})` : "Sin conteos"}</b></p>
          <p className="mt-1 flex justify-between"><span>Códigos con existencia sin movimiento</span><b className={data.itemsWithoutMovement90d > 0 ? "text-amber-700" : ""}>{data.itemsWithoutMovement90d}</b></p>
          <p className="mt-1 flex justify-between"><span>Códigos / ubicaciones activas</span><b>{data.activeItems} / {data.activeLocations}</b></p>
          {data.adjustmentsAwaitingDecision > 0 && <p className="mt-3 flex items-center gap-1 text-xs font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />Hay ajustes esperando decisión de un aprobador independiente.</p>}
        </div>
      </div>
    </section>
  );
}
