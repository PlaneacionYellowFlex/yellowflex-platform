"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Lock, Scale, Search, ShieldCheck, Upload, XCircle } from "lucide-react";

type Caps = { reconView: boolean; reconcile: boolean; adjust: boolean; close: boolean; control: boolean; view: boolean };
type BatchOption = { id: string; status: string; payrollReference: string; employeeCount: number; orderCount: number; committedAmount: string; exportedAt: string | null };
type Totals = { employees: number; expected: string; applied: string; covered: string; pendingRecovery: string; pendingRefund: string; difference: string;
  complete: number; partial: number; notApplied: number; overApplied: number };
type PreviewRow = { employeeId: string; employeeNumber: string; employeeName: string; orderCount: number; expected: string; applied: string; difference: string;
  result: string; sourceRow: number; note: string | null; matchedBy: string };
type Issue = { code: string; row: number | null; employeeNumber: string | null; message: string };
type Preview = { fileName: string; fileSha256: string; rowsRead: number; valid: boolean; errorCount: number; errorCounts: Record<string, number>; errors: Issue[];
  warnings: Issue[]; missingCount: number; totals: Totals; rows: PreviewRow[]; previewToken: string | null; expiresAt: string; elapsedMs: number; notice: string };
type Recon = { id: string; status: string; fileName: string; evidenceSha256: string; externalReference: string | null; reconciledAt: string; closedAt: string | null;
  voidedAt: string | null; voidReason: string | null; actor: string; voidedBy: string | null; expected: string; applied: string; covered: string;
  pendingRecovery: string; pendingRefund: string; employeeCount: number; completeCount: number; partialCount: number; notAppliedCount: number; overCount: number };
type EmployeeRow = { id: string; employeeNumber: string; employeeName: string; orderCount: number; expected: string; applied: string; difference: string; result: string;
  sourceRow: number; note: string | null; covered: boolean; pendingBalance: string; pendingAdjustmentId: string | null };
type State = {
  batch: { id: string; status: string; payrollReference: string; employeeCount: number; orderCount: number; committedAmount: string; closedAt: string | null; closedBy: string | null; closeNote: string | null };
  reconciliation: Recon | null; history: Recon[]; orderStatus: Record<string, number>; employees: EmployeeRow[]; total: number; page: number; pages: number;
  kpis: { expected: string; applied: string; pendingRecovery: string; pendingRefund: string; employees: number; reconciledEmployees: number; employeesWithDifferences: number;
    coveredEmployees: number; pendingAdjustments: number; resolvedAdjustments: number } | null;
};
type Adjustment = { id: string; batch: { id: string; payrollReference: string; status: string }; employeeNumber: string; employeeName: string; kind: string; status: string;
  original: string; applied: string; difference: string; balance: string; reason: string; parentAdjustmentId: string | null; createdAt: string; actor: string;
  resolutionType: string | null; resolvedAmount: string | null; resolutionReference: string | null; resolutionNote: string | null; resolvedAt: string | null; resolvedBy: string | null };
type AdjList = { adjustments: Adjustment[]; total: number; page: number; pages: number; pendingTotals: { count: number; recovery: string; refund: string } };

const RESULT: Record<string, { label: string; cls: string }> = {
  COMPLETE: { label: "Completo", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  PARTIAL: { label: "Parcial", cls: "border-[#D6A800] bg-[#F4B400]/15 text-[#7a5a00]" },
  NOT_APPLIED: { label: "No aplicado", cls: "border-red-200 bg-red-50 text-red-800" },
  OVER_APPLIED: { label: "Superior al esperado", cls: "border-[#0B3A82]/30 bg-[#0B3A82]/5 text-[#0B3A82]" },
};
const BATCH_STATUS: Record<string, string> = {
  EXPORTED: "Exportado · pendiente de conciliar", PARTIALLY_RECONCILED: "Conciliación registrada · cierre pendiente", RECONCILED: "Conciliado y cerrado",
};
const KIND: Record<string, string> = { NOT_APPLIED: "Descuento no aplicado", PARTIAL: "Descuento parcial", OVER_APPLIED: "Descuento superior al esperado" };
const RESOLUTION: Record<string, string> = { RECOVERED: "Recuperado en nómina posterior", REFUNDED: "Devuelto al colaborador", COMPENSATED: "Compensado",
  CORRECTED: "Corrección justificada", WAIVED: "Condonado con autorización" };
const ERRORS: Record<string, string> = {
  EMPLOYEE_MISSING: "Colaborador ausente", UNKNOWN_EMPLOYEE: "Colaborador desconocido", DUPLICATE_EMPLOYEE: "Renglón duplicado", AMOUNT_MISSING: "Importe vacío",
  AMOUNT_INVALID: "Importe inválido", REFERENCE_MISMATCH: "Referencia distinta", BATCH_MISMATCH: "Otro lote", EXPECTED_MISMATCH: "Esperado alterado",
  EMPLOYEE_NUMBER_MISSING: "Sin número de colaborador",
};
const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${btn} bg-[#0B3A82] text-white hover:bg-[#082d66]`;
const gold = `${btn} bg-[#F4B400] text-[#0B3A82] hover:bg-[#e0a600]`;
const outline = `${btn} border border-[#0B3A82]/30 bg-white text-[#0B3A82] hover:bg-[#0B3A82]/5`;
const danger = `${btn} border border-red-200 bg-white text-red-700 hover:bg-red-50`;
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#0B3A82]";
const mxn = (v: string | null) => v === null ? "—" : Number(v).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const stamp = (v: string | null) => v ? new Date(v).toLocaleString("es-MX") : "—";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const API = "/api/food-services/hr/payroll";
const PAGE = 50;

type ApiError = Error & { code?: string };
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init,
    headers: { ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(response.status === 403 ? "Acceso restringido: falta el permiso de conciliación correspondiente." : data.error || "No fue posible completar la operación.") as ApiError;
    err.code = data.code; throw err;
  }
  return data as T;
}
async function download(url: string) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(response.status === 403 ? "Acceso restringido: falta el permiso correspondiente." : data.error || "No fue posible descargar el archivo.");
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "archivo.xlsx";
  const href = URL.createObjectURL(await response.blob());
  const a = document.createElement("a"); a.href = href; a.download = name; a.click(); URL.revokeObjectURL(href);
  return name;
}
const notifyChanged = () => window.dispatchEvent(new Event("yf:payroll-changed"));
const newKey = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function HrPayrollReconciliation() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [batchId, setBatchId] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [filter, setFilter] = useState({ result: "ALL", q: "", page: 1 });
  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | null>(null);
  const [externalRef, setExternalRef] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmKey, setConfirmKey] = useState("");
  const [pvFilter, setPvFilter] = useState({ result: "ALL", q: "", page: 1 });
  const [now, setNow] = useState(() => Date.now());
  const [closeOpen, setCloseOpen] = useState(false); const [closeNote, setCloseNote] = useState("");
  const [voidOpen, setVoidOpen] = useState(false); const [voidReason, setVoidReason] = useState("");
  const [adj, setAdj] = useState<AdjList | null>(null);
  const [adjFilter, setAdjFilter] = useState({ status: "PENDING", kind: "", q: "", page: 1 });
  const [resolveTarget, setResolveTarget] = useState<Adjustment | null>(null);
  const [resolution, setResolution] = useState({ type: "", amount: "", reference: "", note: "" });
  const fileInput = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    setBusy(label); setError(""); setSuccess("");
    try { return await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Error inesperado."); return undefined; } finally { setBusy(null); }
  }

  const fetchBatches = useCallback(async () => {
    // Una consulta por estado: los lotes por conciliar o por cerrar nunca quedan fuera por antigüedad.
    const lists = await Promise.all(["EXPORTED", "PARTIALLY_RECONCILED", "RECONCILED"].map(status =>
      call<{ batches: BatchOption[] }>(`${API}/batches?limit=200&status=${status}`)));
    return lists.flatMap(d => d.batches);
  }, []);
  const fetchState = useCallback(async (id: string, f: { result: string; q: string; page: number }) =>
    call<State>(`${API}/batches/${encodeURIComponent(id)}/reconciliation?${new URLSearchParams({ result: f.result, page: String(f.page), ...(f.q ? { q: f.q } : {}) })}`), []);
  const fetchAdjustments = useCallback(async (f: { status: string; kind: string; q: string; page: number }) =>
    call<AdjList>(`${API}/adjustments?${new URLSearchParams({ status: f.status, page: String(f.page), ...(f.kind ? { kind: f.kind } : {}), ...(f.q ? { q: f.q } : {}) })}`), []);

  useEffect(() => {
    let active = true;
    void call<{ capabilities: Caps }>(`${API}/capabilities`).then(async d => {
      if (!active) return; setCaps(d.capabilities);
      if (d.capabilities.view) { const list = await fetchBatches(); if (active) setBatches(list); }
      if (d.capabilities.reconView) { const a = await fetchAdjustments({ status: "PENDING", kind: "", q: "", page: 1 }); if (active) setAdj(a); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [fetchBatches, fetchAdjustments]);

  // Acceso directo desde el historial de lotes («Conciliar»).
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      void selectBatch(id);
    };
    window.addEventListener("yf:payroll-reconcile", handler);
    return () => window.removeEventListener("yf:payroll-reconcile", handler);
  });

  useEffect(() => { if (!preview?.previewToken) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [preview]);
  const secondsLeft = preview?.previewToken ? Math.max(0, Math.floor((Date.parse(preview.expiresAt) - now) / 1000)) : 0;

  async function selectBatch(id: string) {
    setBatchId(id); setPreview(null); setFile(null); setExternalRef(""); setState(null);
    if (fileInput.current) fileInput.current.value = "";
    if (!id) return;
    const f = { result: "ALL", q: "", page: 1 }; setFilter(f);
    await run("state", async () => {
      const [s, list] = await Promise.all([fetchState(id, f), fetchBatches()]);
      setState(s); setBatches(list);
    });
  }
  async function reload(f = filter) {
    if (!batchId) return;
    setFilter(f);
    await run("state", async () => setState(await fetchState(batchId, f)));
  }
  async function reloadAdjustments(f = adjFilter) {
    setAdjFilter(f);
    await run("adjustments", async () => setAdj(await fetchAdjustments(f)));
  }

  async function doPreview() {
    if (!file || !batchId) return;
    await run("preview", async () => {
      const p = await call<Preview>(`${API}/batches/${encodeURIComponent(batchId)}/reconciliation/preview`, {
        method: "POST", body: file.bytes, headers: { "Content-Type": XLSX, "X-File-Name": encodeURIComponent(file.name) } });
      setPreview(p); setPvFilter({ result: "ALL", q: "", page: 1 }); setConfirmKey(newKey());
    });
  }
  async function doConfirm() {
    if (!file || !preview?.previewToken || !batchId) return;
    await run("confirm", async () => {
      const r = await call<{ reconciliationId: string; adjustmentsCreated: number; replayed: boolean }>(`${API}/batches/${encodeURIComponent(batchId)}/reconciliation`, {
        method: "POST", body: file.bytes, headers: { "Content-Type": XLSX, "X-File-Name": encodeURIComponent(file.name), "X-Preview-Token": preview.previewToken!,
          "Idempotency-Key": confirmKey, ...(externalRef.trim() ? { "X-External-Reference": encodeURIComponent(externalRef.trim()) } : {}) } });
      setPreview(null); setFile(null); if (fileInput.current) fileInput.current.value = "";
      const f = { result: "DIFFERENCES", q: "", page: 1 }; setFilter(f);
      setState(await fetchState(batchId, f)); setBatches(await fetchBatches()); setAdj(await fetchAdjustments(adjFilter));
      notifyChanged();
      setSuccess(`Conciliación registrada${r.replayed ? " (reintento: se conservó el registro original)" : ""}. ${r.adjustmentsCreated} diferencia(s) quedaron como ajustes trazables.`);
    });
  }
  async function doClose() {
    if (!state?.reconciliation) return;
    await run("close", async () => {
      const r = await call<{ processedOrders: number; exportedOrders: number; pendingAdjustments: number; notice: string }>(`${API}/batches/${encodeURIComponent(state.batch.id)}/close`, {
        method: "POST", body: JSON.stringify({ reconciliationId: state.reconciliation!.id, ...(closeNote.trim() ? { note: closeNote.trim() } : {}) }) });
      setCloseOpen(false); setCloseNote("");
      setState(await fetchState(state.batch.id, filter)); setBatches(await fetchBatches()); setAdj(await fetchAdjustments(adjFilter));
      notifyChanged();
      setSuccess(`Lote cerrado. ${r.processedOrders} pedido(s) cubiertos (PROCESSED), ${r.exportedOrders} sin cubrir (EXPORTED). ${r.notice}`);
    });
  }
  async function doVoid() {
    if (!state?.reconciliation) return;
    await run("void", async () => {
      await call(`${API}/batches/${encodeURIComponent(state.batch.id)}/reconciliation/void`, {
        method: "POST", body: JSON.stringify({ reconciliationId: state.reconciliation!.id, reason: voidReason.trim() }) });
      setVoidOpen(false); setVoidReason("");
      setState(await fetchState(state.batch.id, { result: "ALL", q: "", page: 1 })); setBatches(await fetchBatches()); setAdj(await fetchAdjustments(adjFilter));
      notifyChanged();
      setSuccess("Conciliación anulada y conservada en el historial. El lote volvió a «Exportado»; importa el archivo correcto.");
    });
  }
  function openResolve(a: Adjustment) {
    setResolveTarget(a);
    setResolution({ type: a.kind === "OVER_APPLIED" ? "REFUNDED" : "RECOVERED", amount: Math.abs(Number(a.balance)).toFixed(2), reference: "", note: "" });
  }
  async function openResolveById(id: string) {
    const a = adj?.adjustments.find(x => x.id === id);
    if (a) { openResolve(a); return; }
    await run("adjustments", async () => {
      const list = await fetchAdjustments({ status: "PENDING", kind: "", q: "", page: 1 });
      let found = list.adjustments.find(x => x.id === id);
      for (let p = 2; !found && p <= list.pages; p++) found = (await fetchAdjustments({ status: "PENDING", kind: "", q: "", page: p })).adjustments.find(x => x.id === id);
      if (found) openResolve(found); else throw new Error("No se encontró el ajuste pendiente; actualiza la vista.");
    });
  }
  async function doResolve() {
    if (!resolveTarget) return;
    await run("resolve", async () => {
      const r = await call<{ remainder: string; processedOrders: number }>(`${API}/adjustments/${encodeURIComponent(resolveTarget.id)}/resolve`, {
        method: "POST", body: JSON.stringify({ resolutionType: resolution.type, amount: resolution.amount.trim(), note: resolution.note.trim(),
          ...(resolution.reference.trim() ? { reference: resolution.reference.trim() } : {}) }) });
      setResolveTarget(null);
      setAdj(await fetchAdjustments(adjFilter));
      if (batchId) setState(await fetchState(batchId, filter));
      setSuccess(`Ajuste resuelto.${Number(r.remainder) > 0 ? ` Queda un saldo de ${mxn(r.remainder)} como nuevo ajuste pendiente.` : ""}${r.processedOrders ? ` ${r.processedOrders} pedido(s) quedaron cubiertos (PROCESSED).` : ""}`);
    });
  }
  async function getFile(label: string, url: string) {
    await run(label, async () => setSuccess(`Descargado: ${await download(url)}. Las descargas de control no cambian estados.`));
  }

  const pvRows = useMemo(() => {
    const q = pvFilter.q.trim().toLowerCase();
    return (preview?.rows ?? []).filter(r => (pvFilter.result === "ALL" || (pvFilter.result === "DIFFERENCES" ? r.result !== "COMPLETE" : r.result === pvFilter.result))
      && (!q || r.employeeNumber.toLowerCase().includes(q) || r.employeeName.toLowerCase().includes(q)));
  }, [preview, pvFilter]);
  const pvPages = Math.max(1, Math.ceil(pvRows.length / PAGE));

  if (!caps) return <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{error
    ? <p role="alert" className="text-red-700">{error}</p> : <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Consultando permisos de conciliación…</span>}</section>;
  if (!caps.reconView) return <section className="rounded-2xl border border-slate-200 bg-white p-6">
    <p className="flex items-center gap-2 text-sm text-slate-700"><ShieldCheck className="size-5 text-[#0B3A82]" />Conciliación y cierre: solicita en C-PANEL «Consultar conciliaciones» (y, según tu función, Registrar conciliación, Gestionar ajustes, Cerrar lote o Exportar reportes de control).</p></section>;

  const b = state?.batch; const r = state?.reconciliation ?? null; const k = state?.kpis ?? null;
  const pendingDiff = k ? Number(k.pendingRecovery) + Number(k.pendingRefund) : 0;

  return <div className="space-y-6">
    <section ref={sectionRef} id="conciliacion" className="rounded-2xl border border-slate-200 border-t-4 border-t-[#0B3A82] bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-[#0B3A82]"><Scale className="size-5" />Conciliación y cierre</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Registra en una sola importación lo que Nómina aplicó realmente a cada colaborador. Exportar no significa descuento aplicado y un lote exportado no está conciliado. Solo atiendes las excepciones: cada diferencia queda como ajuste trazable y el cierre no la hace desaparecer.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">{(["reconView", "reconcile", "adjust", "close", "control"] as const).map(key =>
          <span key={key} className={`rounded-full border px-3 py-1 ${caps[key] ? "border-[#0B3A82]/30 bg-[#0B3A82]/5 text-[#0B3A82]" : "border-slate-200 text-slate-400"}`}>
            {{ reconView: "Consultar", reconcile: "Registrar", adjust: "Ajustes", close: "Cerrar", control: "Reportes" }[key]}</span>)}</div>
      </div>
      {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><XCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
      {success && <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{success}</p>}

      <label className="mt-5 block max-w-2xl text-sm font-bold text-slate-700">Lote exportado
        <select className={input} value={batchId} disabled={busy !== null} onChange={e => void selectBatch(e.target.value)}>
          <option value="">Selecciona un lote…</option>
          {batches.map(x => <option key={x.id} value={x.id}>{x.payrollReference} · {BATCH_STATUS[x.status]} · {x.employeeCount} colaboradores · {mxn(x.committedAmount)}</option>)}
        </select></label>
      {!caps.view ? <p className="mt-2 text-xs text-[#7a5a00]">Para seleccionar lotes se requiere también el permiso «Consultar prenómina» en C-PANEL.</p>
        : batches.length === 0 && <p className="mt-2 text-xs text-slate-500">No hay lotes exportados. Exporta un lote en el historial de lotes para conciliarlo.</p>}
      {busy === "state" && <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando conciliación…</p>}

      {b && <>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Importe esperado" value={mxn(k?.expected ?? b.committedAmount)} />
          <Kpi label="Importe aplicado" value={k ? mxn(k.applied) : "Sin conciliar"} />
          <Kpi label="Diferencia pendiente" value={k ? mxn(String(pendingDiff)) : "—"} hint={k ? `Recuperar ${mxn(k.pendingRecovery)} · Devolver ${mxn(k.pendingRefund)}` : undefined} tone={pendingDiff > 0 ? "gold" : "blue"} />
          <Kpi label="Colaboradores conciliados" value={k ? `${k.reconciledEmployees} de ${k.employees}` : `0 de ${b.employeeCount}`} hint={k ? `${k.coveredEmployees} cubiertos` : undefined} />
          <Kpi label="Con diferencias" value={k ? String(k.employeesWithDifferences) : "—"} hint={k ? `${k.pendingAdjustments} ajuste(s) pendiente(s)` : undefined} tone={k && k.employeesWithDifferences ? "gold" : "blue"} />
          <Kpi label="Estado del lote" value={BATCH_STATUS[b.status] ?? b.status} small />
        </div>
        <p className="mt-2 text-xs text-slate-500">Pedidos del lote: {Object.entries(state!.orderStatus).map(([s, n]) => `${n} ${s}`).join(" · ")}. PROCESSED solo cuando el colaborador quedó cubierto por evidencia.</p>

        {b.status === "EXPORTED" && caps.reconcile && <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-black text-[#0B3A82]">1. Plantilla de conciliación</p>
            <p className="mt-1 text-sm text-slate-600">Contiene a los {b.employeeCount} colaboradores del lote con su importe esperado. Captura el importe aplicado por Nómina; 0 si no se aplicó (una celda vacía bloquea la importación).</p>
            <button type="button" className={`${outline} mt-3`} disabled={busy !== null} onClick={() => void getFile("template", `${API}/batches/${encodeURIComponent(b.id)}/reconciliation/template`)}>
              {busy === "template" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Descargar plantilla</button>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-black text-[#0B3A82]">2. Importar lo aplicado por Nómina</p>
            <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#0B3A82]/10 file:px-3 file:py-2 file:font-bold file:text-[#0B3A82]"
              disabled={busy !== null} onChange={async e => { const f = e.target.files?.[0]; setPreview(null); setFile(f ? { name: f.name, bytes: await f.arrayBuffer() } : null); }} />
            <label className="mt-3 block text-xs font-semibold text-slate-600">Referencia de Nómina (opcional)<input className={input} maxLength={160} value={externalRef} disabled={busy !== null} onChange={e => setExternalRef(e.target.value)} placeholder="Ej. folio del cálculo de nómina" /></label>
            <button type="button" className={`${primary} mt-3`} disabled={busy !== null || !file} onClick={() => void doPreview()}>
              {busy === "preview" ? <><Loader2 className="size-4 animate-spin" />Validando…</> : <><Upload className="size-4" />Validar y ver vista previa</>}</button>
          </div>
        </div>}

        {preview && <div className="mt-6 rounded-2xl border-2 border-[#F4B400] p-4 sm:p-5" aria-labelledby="rc-pv">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 id="rc-pv" className="text-lg font-black text-[#0B3A82]">Vista previa · {preview.fileName}</h3>
              <p className="text-xs text-slate-500">{preview.rowsRead} renglones leídos · SHA-256 <span className="font-mono">{preview.fileSha256.slice(0, 16)}…</span> · {preview.elapsedMs} ms</p></div>
            {preview.previewToken && <p className={`rounded-full px-3 py-1 text-xs font-bold ${secondsLeft > 60 ? "bg-[#0B3A82]/5 text-[#0B3A82]" : "bg-red-50 text-red-700"}`}>Vigencia {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</p>}
          </div>
          {!preview.valid ? <div className="mt-4">
            <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{preview.errorCount} error(es): {Object.entries(preview.errorCounts).map(([c, n]) => `${ERRORS[c] ?? c} ${n}`).join(" · ")}. {preview.notice}</p>
            <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 bg-[#0B3A82] text-white"><tr><th className="p-2">Renglón</th><th className="p-2">Colaborador</th><th className="p-2">Error</th><th className="p-2">Detalle</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{preview.errors.slice(0, 300).map((x, i) => <tr key={i}><td className="p-2">{x.row ?? "—"}</td><td className="p-2">{x.employeeNumber ?? "—"}</td><td className="p-2 font-semibold">{ERRORS[x.code] ?? x.code}</td><td className="p-2">{x.message}</td></tr>)}</tbody></table></div>
            {preview.errors.length > 300 && <p className="mt-1 text-xs text-slate-500">Se muestran 300 de {preview.errorCount} errores.</p>}
          </div> : <div className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Colaboradores" value={String(preview.totals.employees)} hint={`${preview.totals.complete} completos`} />
              <Kpi label="Esperado / aplicado" value={mxn(preview.totals.applied)} hint={`de ${mxn(preview.totals.expected)}`} />
              <Kpi label="Por recuperar" value={mxn(preview.totals.pendingRecovery)} hint={`${preview.totals.partial} parciales · ${preview.totals.notApplied} no aplicados`} tone={Number(preview.totals.pendingRecovery) ? "gold" : "blue"} />
              <Kpi label="Por devolver" value={mxn(preview.totals.pendingRefund)} hint={`${preview.totals.overApplied} superiores`} tone={Number(preview.totals.pendingRefund) ? "gold" : "blue"} />
            </div>
            {preview.warnings.length > 0 && <p className="mt-3 text-xs text-[#7a5a00]">{preview.warnings.length} advertencia(s): {preview.warnings.slice(0, 3).map(w => w.message).join(" · ")}</p>}
            <Filters value={pvFilter} onChange={setPvFilter} disabled={busy !== null} />
            <EmployeeTable rows={pvRows.slice((pvFilter.page - 1) * PAGE, pvFilter.page * PAGE)} />
            <Pager page={pvFilter.page} pages={pvPages} total={pvRows.length} disabled={busy !== null} onPage={p => setPvFilter({ ...pvFilter, page: p })} />
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <p className="text-xs text-slate-500">Se registrará la conciliación completa y {preview.totals.partial + preview.totals.notApplied + preview.totals.overApplied} ajuste(s).</p>
              <button type="button" className={outline} disabled={busy !== null} onClick={() => setPreview(null)}>Descartar</button>
              <button type="button" className={gold} disabled={busy !== null || secondsLeft === 0} onClick={() => void doConfirm()}>
                {busy === "confirm" ? <><Loader2 className="size-4 animate-spin" />Registrando…</> : <><CheckCircle2 className="size-4" />Confirmar conciliación de {preview.totals.employees} colaboradores</>}</button>
            </div>
          </div>}
        </div>}

        {r && <div className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm text-slate-700">
              <p><strong className="text-[#0B3A82]">Conciliación registrada</strong> por {r.actor} el {stamp(r.reconciledAt)} · archivo <strong>{r.fileName}</strong>{r.externalReference ? ` · ref. ${r.externalReference}` : ""}</p>
              <p className="text-xs text-slate-500">SHA-256 <span className="font-mono">{r.evidenceSha256}</span></p>
              {b.closedAt && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-800"><Lock className="size-3" />Cerrado el {stamp(b.closedAt)} por {b.closedBy}{b.closeNote ? ` · ${b.closeNote}` : ""}. {k?.pendingAdjustments ? `${k.pendingAdjustments} ajuste(s) siguen pendientes.` : "Sin diferencias pendientes."}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={outline} disabled={busy !== null} onClick={() => void getFile("evidence", `${API}/batches/${encodeURIComponent(b.id)}/reconciliation/evidence?reconciliationId=${encodeURIComponent(r.id)}`)}><Download className="size-4" />Evidencia</button>
              {caps.reconcile && b.status === "PARTIALLY_RECONCILED" && <button type="button" className={danger} disabled={busy !== null} onClick={() => { setVoidOpen(true); setVoidReason(""); }}><XCircle className="size-4" />Anular conciliación</button>}
              {caps.close && b.status === "PARTIALLY_RECONCILED" && <button type="button" className={primary} disabled={busy !== null} onClick={() => { setCloseOpen(true); setCloseNote(""); }}><Lock className="size-4" />Cerrar lote</button>}
            </div>
          </div>
          {caps.control && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-600">Reportes de control:</span>
            {([["reconciliation", "Conciliación por colaborador"], ["differences", "Diferencias"], ["adjustments", "Ajustes"], ["summary", "Resumen de cierre"]] as const).map(([t, label]) =>
              <button key={t} type="button" className={outline} disabled={busy !== null} onClick={() => void getFile(`report:${t}`, `${API}/batches/${encodeURIComponent(b.id)}/control-report?type=${t}`)}>
                {busy === `report:${t}` ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}{label}</button>)}</div>}
          <Filters value={filter} onChange={f => void reload(f)} disabled={busy !== null} server />
          <EmployeeTable rows={state!.employees} onResolve={caps.adjust ? id => void openResolveById(id) : undefined} showBalance />
          <Pager page={state!.page} pages={state!.pages} total={state!.total} disabled={busy !== null} onPage={p => void reload({ ...filter, page: p })} />
        </div>}

        {state!.history.some(h => h.voidedAt) && <div className="mt-5"><h4 className="text-sm font-bold text-[#0B3A82]">Conciliaciones anuladas (historial)</h4>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">{state!.history.filter(h => h.voidedAt).map(h => <li key={h.id}>{stamp(h.reconciledAt)} · {h.fileName} · {h.actor} · anulada {stamp(h.voidedAt)} por {h.voidedBy}: {h.voidReason}</li>)}</ul></div>}
      </>}
    </section>

    {adj && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 className="text-lg font-black text-[#0B3A82]">Ajustes de prenómina</h3>
          <p className="text-sm text-slate-600">{adj.pendingTotals.count} pendiente(s) en todos los lotes · por recuperar {mxn(adj.pendingTotals.recovery)} · por devolver {mxn(adj.pendingTotals.refund)}. Ningún ajuste genera cargos automáticos en otro lote.</p></div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void reloadAdjustments({ ...adjFilter, page: 1 }); }}>
          <label className="text-xs font-semibold text-slate-600">Estado<select className={input} value={adjFilter.status} onChange={e => setAdjFilter({ ...adjFilter, status: e.target.value })}>
            <option value="PENDING">Pendientes</option><option value="APPLIED">Resueltos</option><option value="VOIDED">Anulados</option><option value="ALL">Todos</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Tipo<select className={input} value={adjFilter.kind} onChange={e => setAdjFilter({ ...adjFilter, kind: e.target.value })}>
            <option value="">Todos</option>{Object.entries(KIND).map(([key, v]) => <option key={key} value={key}>{v}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Buscar<input className={input} maxLength={120} value={adjFilter.q} placeholder="Colaborador o referencia" onChange={e => setAdjFilter({ ...adjFilter, q: e.target.value })} /></label>
          <button type="submit" className={outline} disabled={busy !== null}>{busy === "adjustments" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}Filtrar</button>
        </form>
      </div>
      {adj.adjustments.length === 0 ? <p className="mt-4 text-sm text-slate-500">Sin ajustes con estos filtros.</p> :
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-[#0B3A82] text-white"><tr><th className="p-2">Lote</th><th className="p-2">Colaborador</th><th className="p-2">Tipo</th><th className="p-2 text-right">Esperado</th>
            <th className="p-2 text-right">Aplicado</th><th className="p-2 text-right">Saldo</th><th className="p-2">Estado / resolución</th><th className="p-2"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{adj.adjustments.map(a => <tr key={a.id}>
            <td className="p-2">{a.batch.payrollReference}</td><td className="p-2"><strong>{a.employeeName}</strong> <span className="text-slate-500">{a.employeeNumber}</span></td>
            <td className="p-2">{KIND[a.kind]}{a.parentAdjustmentId && <span className="ml-1 rounded bg-slate-100 px-1">saldo remanente</span>}</td>
            <td className="p-2 text-right">{mxn(a.original)}</td><td className="p-2 text-right">{mxn(a.applied)}</td>
            <td className={`p-2 text-right font-semibold ${Number(a.balance) > 0 ? "text-[#7a5a00]" : "text-[#0B3A82]"}`}>{Number(a.balance) > 0 ? "Recuperar " : "Devolver "}{mxn(String(Math.abs(Number(a.balance))))}</td>
            <td className="p-2">{a.status === "PENDING" ? <span className="font-semibold text-[#7a5a00]">Pendiente · {stamp(a.createdAt)} · {a.actor}</span>
              : a.status === "APPLIED" ? <span>{RESOLUTION[a.resolutionType ?? ""]} {mxn(a.resolvedAmount)} · {a.resolutionReference ?? "sin referencia"} · {a.resolvedBy} · {stamp(a.resolvedAt)}</span>
              : <span className="text-slate-500">Anulado con la conciliación</span>}</td>
            <td className="p-2 text-right">{caps.adjust && a.status === "PENDING" && <button type="button" className={outline} disabled={busy !== null} onClick={() => openResolve(a)}>Resolver</button>}</td>
          </tr>)}</tbody></table></div>}
      <Pager page={adj.page} pages={adj.pages} total={adj.total} disabled={busy !== null} onPage={p => void reloadAdjustments({ ...adjFilter, page: p })} />
    </section>}

    {closeOpen && state?.reconciliation && <Modal title="Cerrar lote de prenómina" onClose={() => busy === null && setCloseOpen(false)}>
      <p className="text-sm text-slate-700">Se cerrará definitivamente el lote <strong>{state.batch.payrollReference}</strong>. Los pedidos de colaboradores cubiertos pasarán a PROCESSED; los no cubiertos quedarán EXPORTED y no podrán volver a cobrarse.</p>
      {k && k.pendingAdjustments > 0 && <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#D6A800] bg-[#F4B400]/10 p-3 text-sm text-[#7a5a00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{k.pendingAdjustments} diferencia(s) seguirán vigentes como ajustes pendientes (recuperar {mxn(k.pendingRecovery)}, devolver {mxn(k.pendingRefund)}). Cerrar el lote no las liquida.</p>}
      <label className="mt-4 block text-sm font-bold">Nota de cierre (opcional)<textarea className={`${input} min-h-20`} maxLength={500} value={closeNote} disabled={busy !== null} onChange={e => setCloseNote(e.target.value)} /></label>
      <div className="mt-5 flex justify-end gap-3"><button type="button" className={outline} disabled={busy !== null} onClick={() => setCloseOpen(false)}>Volver</button>
        <button type="button" className={primary} disabled={busy !== null} onClick={() => void doClose()}>{busy === "close" ? <><Loader2 className="size-4 animate-spin" />Cerrando…</> : <><Lock className="size-4" />Confirmar cierre</>}</button></div>
    </Modal>}

    {voidOpen && state?.reconciliation && <Modal title="Anular conciliación" onClose={() => busy === null && setVoidOpen(false)}>
      <p className="text-sm text-slate-700">Úsalo solo si se importó un archivo equivocado. La conciliación y sus ajustes pendientes se conservan en el historial como anulados y el lote vuelve a «Exportado». No es posible si algún ajuste ya fue resuelto o si el lote está cerrado.</p>
      <label className="mt-4 block text-sm font-bold">Motivo obligatorio (mínimo 10 caracteres)<textarea autoFocus className={`${input} min-h-24`} maxLength={500} value={voidReason} disabled={busy !== null} onChange={e => setVoidReason(e.target.value)} /></label>
      <div className="mt-5 flex justify-end gap-3"><button type="button" className={outline} disabled={busy !== null} onClick={() => setVoidOpen(false)}>Volver</button>
        <button type="button" className={`${btn} bg-red-700 text-white hover:bg-red-800`} disabled={busy !== null || voidReason.trim().length < 10} onClick={() => void doVoid()}>{busy === "void" ? <><Loader2 className="size-4 animate-spin" />Anulando…</> : "Confirmar anulación"}</button></div>
    </Modal>}

    {resolveTarget && <Modal title="Resolver ajuste" onClose={() => busy === null && setResolveTarget(null)}>
      <p className="text-sm text-slate-700"><strong>{resolveTarget.employeeName}</strong> ({resolveTarget.employeeNumber}) · lote {resolveTarget.batch.payrollReference} · {KIND[resolveTarget.kind]}</p>
      <p className="mt-1 text-xs text-slate-500">Esperado {mxn(resolveTarget.original)} · aplicado {mxn(resolveTarget.applied)} · saldo {mxn(String(Math.abs(Number(resolveTarget.balance))))} {Number(resolveTarget.balance) > 0 ? "por recuperar" : "por devolver"}</p>
      <p className="mt-1 text-xs text-slate-500">{resolveTarget.reason}</p>
      <label className="mt-4 block text-sm font-bold">Resolución<select className={input} value={resolution.type} disabled={busy !== null} onChange={e => setResolution({ ...resolution, type: e.target.value,
        amount: ["CORRECTED", "WAIVED"].includes(e.target.value) ? Math.abs(Number(resolveTarget.balance)).toFixed(2) : resolution.amount })}>
        {(resolveTarget.kind === "OVER_APPLIED" ? ["REFUNDED", "COMPENSATED", "CORRECTED"] : ["RECOVERED", "CORRECTED", "WAIVED"]).map(t => <option key={t} value={t}>{RESOLUTION[t]}</option>)}</select></label>
      <label className="mt-3 block text-sm font-bold">Importe resuelto<input className={input} inputMode="decimal" value={resolution.amount} disabled={busy !== null || ["CORRECTED", "WAIVED"].includes(resolution.type)} onChange={e => setResolution({ ...resolution, amount: e.target.value })} />
        <span className="text-xs font-normal text-slate-500">Si es menor al saldo, el remanente queda como nuevo ajuste pendiente.</span></label>
      <label className="mt-3 block text-sm font-bold">Referencia {resolution.type === "WAIVED" ? "(opcional)" : "(obligatoria)"}<input className={input} maxLength={160} value={resolution.reference} disabled={busy !== null} placeholder="Folio de nómina, transferencia u oficio" onChange={e => setResolution({ ...resolution, reference: e.target.value })} /></label>
      <label className="mt-3 block text-sm font-bold">Justificación (mínimo 10 caracteres)<textarea className={`${input} min-h-20`} maxLength={1000} value={resolution.note} disabled={busy !== null} onChange={e => setResolution({ ...resolution, note: e.target.value })} /></label>
      <div className="mt-5 flex justify-end gap-3"><button type="button" className={outline} disabled={busy !== null} onClick={() => setResolveTarget(null)}>Volver</button>
        <button type="button" className={primary} disabled={busy !== null || resolution.note.trim().length < 10 || !resolution.amount.trim() || (resolution.type !== "WAIVED" && resolution.reference.trim().length < 3)} onClick={() => void doResolve()}>
          {busy === "resolve" ? <><Loader2 className="size-4 animate-spin" />Registrando…</> : "Registrar resolución"}</button></div>
    </Modal>}
  </div>;
}

function Kpi({ label, value, hint, tone = "blue", small = false }: { label: string; value: string; hint?: string; tone?: "blue" | "gold"; small?: boolean }) {
  return <div className={`rounded-xl border bg-white p-3 ${tone === "gold" ? "border-[#D6A800] border-l-4 border-l-[#F4B400]" : "border-slate-200 border-l-4 border-l-[#0B3A82]"}`}>
    <p className="text-xs font-semibold text-slate-500">{label}</p>
    <p className={`${small ? "text-sm" : "text-lg"} font-black text-[#0B3A82]`}>{value}</p>
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
  </div>;
}

function Filters({ value, onChange, disabled, server = false }: { value: { result: string; q: string; page: number }; onChange: (v: { result: string; q: string; page: number }) => void; disabled: boolean; server?: boolean }) {
  const [q, setQ] = useState(value.q);
  const options: Array<[string, string]> = [["ALL", "Todos"], ["DIFFERENCES", "Con diferencias"], ["COMPLETE", "Completos"], ["PARTIAL", "Parciales"], ["NOT_APPLIED", "No aplicados"], ["OVER_APPLIED", "Superiores"]];
  return <div className="mt-4 flex flex-wrap items-end gap-2">
    <div className="flex flex-wrap gap-1">{options.map(([k, label]) => <button key={k} type="button" disabled={disabled} onClick={() => onChange({ result: k, q: server ? q : value.q, page: 1 })}
      className={`rounded-full border px-3 py-1 text-xs font-bold ${value.result === k ? "border-[#0B3A82] bg-[#0B3A82] text-white" : "border-slate-200 text-slate-600 hover:border-[#0B3A82]/40"}`}>{label}</button>)}</div>
    <form className="ml-auto flex items-end gap-2" onSubmit={e => { e.preventDefault(); onChange({ ...value, q, page: 1 }); }}>
      <input className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#0B3A82]" maxLength={120} placeholder="No. o nombre" value={q}
        onChange={e => { setQ(e.target.value); if (!server) onChange({ ...value, q: e.target.value, page: 1 }); }} />
      {server && <button type="submit" className={outline} disabled={disabled}><Search className="size-4" />Buscar</button>}
    </form>
  </div>;
}

function EmployeeTable({ rows, onResolve, showBalance = false }: { rows: Array<{ employeeNumber: string; employeeName: string; orderCount: number; expected: string; applied: string;
  difference: string; result: string; sourceRow: number; note: string | null; pendingBalance?: string; covered?: boolean; pendingAdjustmentId?: string | null }>;
  onResolve?: (adjustmentId: string) => void; showBalance?: boolean }) {
  if (!rows.length) return <p className="mt-3 text-sm text-slate-500">Sin colaboradores con este filtro.</p>;
  return <div className="mt-3 max-h-[28rem] overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[820px] text-left text-xs">
    <thead className="sticky top-0 bg-[#0B3A82] text-white"><tr><th className="p-2">Colaborador</th><th className="p-2">Pedidos</th><th className="p-2 text-right">Esperado</th>
      <th className="p-2 text-right">Aplicado</th><th className="p-2 text-right">Diferencia</th><th className="p-2">Resultado</th>{showBalance && <th className="p-2 text-right">Saldo vigente</th>}<th className="p-2">Renglón · comentario</th>{onResolve && <th className="p-2"></th>}</tr></thead>
    <tbody className="divide-y divide-slate-100">{rows.map(r => <tr key={r.employeeNumber}>
      <td className="p-2"><strong>{r.employeeName}</strong> <span className="text-slate-500">{r.employeeNumber}</span></td><td className="p-2">{r.orderCount}</td>
      <td className="p-2 text-right">{mxn(r.expected)}</td><td className="p-2 text-right">{mxn(r.applied)}</td>
      <td className={`p-2 text-right font-semibold ${Number(r.difference) < 0 ? "text-red-700" : Number(r.difference) > 0 ? "text-[#0B3A82]" : "text-slate-500"}`}>{mxn(r.difference)}</td>
      <td className="p-2"><span className={`rounded-full border px-2 py-0.5 font-bold ${RESULT[r.result]?.cls ?? ""}`}>{RESULT[r.result]?.label ?? r.result}</span>{r.covered === false && <span className="ml-1 text-[#7a5a00]">no cubierto</span>}</td>
      {showBalance && <td className="p-2 text-right">{Number(r.pendingBalance ?? 0) ? mxn(r.pendingBalance ?? "0") : "—"}</td>}
      <td className="p-2 text-slate-500">{r.sourceRow}{r.note ? ` · ${r.note}` : ""}</td>
      {onResolve && <td className="p-2 text-right">{r.pendingAdjustmentId && <button type="button" className={outline} onClick={() => onResolve(r.pendingAdjustmentId!)}>Resolver</button>}</td>}
    </tr>)}</tbody></table></div>;
}

function Pager({ page, pages, total, disabled, onPage }: { page: number; pages: number; total: number; disabled: boolean; onPage: (p: number) => void }) {
  if (total <= PAGE) return total ? <p className="mt-2 text-right text-xs text-slate-500">{total} renglón(es)</p> : null;
  return <div className="mt-2 flex items-center justify-end gap-2 text-sm text-slate-600">
    <span className="text-xs">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} de {total}</span>
    <button type="button" className={outline} disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
    <span>Página {page} de {pages}</span>
    <button type="button" className={outline} disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button>
  </div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4" onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
    <div className="w-full max-w-lg rounded-2xl border-t-4 border-t-[#F4B400] bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-black text-[#0B3A82]">{title}</h3>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><XCircle className="size-5" /></button></div>
      <div className="mt-3">{children}</div>
    </div>
  </div>;
}
