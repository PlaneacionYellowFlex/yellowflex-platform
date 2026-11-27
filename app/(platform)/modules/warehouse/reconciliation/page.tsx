"use client";

import { ArrowLeft, CheckCircle2, FileCheck2, Loader2, RefreshCw, Scale, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Finding = { check: string; severity: "CRITICO" | "ALTO" | "INFO"; count: number; sample: Record<string, unknown>[] };
type Result = { generatedAt: string; consistent: boolean; totals: { movements: number; custodies: number; discrepancies: number }; findings: Finding[] };

/**
 * YF-003 V2 · Documentar una entrega histórica sin custodia (R3/R7). No crea custodias ni movimientos: deja una excepción
 * permanente con motivo y evidencia. El servidor exige permiso de aprobar y que quien documenta no haya registrado la entrega.
 */
function DocumentException({ movementId, folio, onDone }: { movementId: string; folio: string; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/warehouse/reports/reconciliation/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ movementId, reason, evidence }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 403 ? "Acceso restringido: se requiere permiso para aprobar ajustes." : b.error ?? "No fue posible documentar la excepción.");
      setOpen(false); onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible documentar la excepción."); }
    finally { setBusy(false); }
  }
  if (!open) return <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold text-blue-950 hover:bg-slate-50"><FileCheck2 className="h-3 w-3" />Documentar excepción</button>;
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-semibold">Entrega {folio}: documentar sin crear custodia ni modificar el historial.</p>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
      <textarea className="w-full rounded-lg border p-2" rows={3} placeholder="Causa y evidencia revisada (mínimo 20 caracteres)" value={reason} onChange={e => setReason(e.target.value)} />
      <input className="w-full rounded-lg border p-2" placeholder="Evidencia (vale, bitácora, folio) — opcional" value={evidence} onChange={e => setEvidence(e.target.value)} />
      <div className="flex gap-2"><button disabled={busy || reason.trim().length < 20} onClick={() => void submit()} className="rounded-lg bg-blue-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy ? "Procesando…" : "Confirmar"}</button>
        <button onClick={() => setOpen(false)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Cancelar</button></div>
    </div>
  );
}

/** YF-003 · Reconciliación de solo lectura (auditoría). Reporta inconsistencias; nunca corrige el inventario. */
export default function ReconciliationPage() {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const r = await fetch("/api/warehouse/reports/reconciliation", { cache: "no-store" }); const b = await r.json(); if (!r.ok) throw new Error(b.error ?? "No fue posible ejecutar la reconciliación."); setData(b); }
    catch (e) { setError(e instanceof Error ? e.message : "No fue posible ejecutar la reconciliación."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <Link href="/modules/warehouse" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:underline"><ArrowLeft className="h-4 w-4" />Volver a Almacén</Link>
      <header className="flex flex-wrap items-end justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-amber-700"><Scale className="h-4 w-4" />Almacén · Auditoría</div>
          <h1 className="mt-2 text-3xl font-bold text-blue-950">Reconciliación del inventario</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">Compara libro mayor, existencias, custodias de Producción y expedientes de diferencia. Es de solo lectura: cualquier hallazgo se resuelve con el flujo de conteo, diferencia y ajuste autorizado.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold text-blue-950 transition hover:bg-slate-50 disabled:opacity-50"><RefreshCw className="h-4 w-4" />Ejecutar de nuevo</button>
      </header>
      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {loading ? <div className="flex min-h-40 items-center justify-center rounded-3xl border bg-white"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Reconciliando…</div> : data && (
        <>
          <section className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-semibold ${data.consistent ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
            {data.consistent ? <CheckCircle2 className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
            {data.consistent ? "Sin inconsistencias." : "Se encontraron inconsistencias que requieren investigación."} {data.totals.movements} movimientos · {data.totals.custodies} custodias · {data.totals.discrepancies} expedientes · {new Date(data.generatedAt).toLocaleString("es-MX")}
          </section>
          <section className="grid gap-3">{data.findings.map(f => (
            <article key={f.check} className={`rounded-2xl border bg-white p-4 ${f.count > 0 ? (f.severity === "CRITICO" ? "border-red-300" : "border-amber-300") : "border-slate-200"}`}>
              <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-blue-950">{f.check}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${f.count === 0 ? "bg-emerald-100 text-emerald-800" : f.severity === "CRITICO" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{f.count === 0 ? "OK" : `${f.count} · ${f.severity}`}</span></div>
              {f.count > 0 && <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(f.sample, null, 1)}</pre>}
              {f.check === "R7 entrega sin custodia vinculada" && f.count > 0 && (
                <ul className="mt-2 space-y-2">{f.sample.slice(0, 50).map(row => (
                  <li key={String(row.movementId)} className="text-xs text-slate-600">{String(row.folio)} · {String(row.item)} · {String(row.quantity)}{" "}
                    <DocumentException movementId={String(row.movementId)} folio={String(row.folio)} onDone={() => void load()} /></li>))}</ul>)}
            </article>))}</section>
        </>
      )}
    </main>
  );
}
