"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Eye, FileSpreadsheet, Loader2, Scale, Search, ShieldCheck, XCircle } from "lucide-react";

type Caps = { view: boolean; create: boolean; void: boolean; export: boolean; reconView?: boolean; reconcile?: boolean };
type Row = {
  orderId: string; employeeId: string | null; employeeNumber: string | null; employeeName: string | null; employeeStatus: string | null;
  serviceWeekStart: string | null; quantity: number | null; historicalUnitPrice: string | null; committedAmount: string | null; reasons: string[];
};
type Candidate = Row & { classification: "eligible" | "requiresReview" | "excluded"; activeBatch: { id: string; payrollReference: string; status: string } | null };
type Totals = { orders: number; employees: number; services: number; amount: string };
type Preview = {
  payrollReference: string; expiresAt: string; previewDigest: string; previewToken: string; serviceWeeks: string[]; actor: { name: string };
  eligible: Row[]; requiresReview: Row[]; excluded: Row[]; totals: { eligible: Totals; requiresReview: Totals };
};
type Batch = {
  id: string; status: string; payrollReference: string; orderCount: number; employeeCount: number; serviceCount: number; committedAmount: string;
  generatedAt: string | null; exportedAt: string | null; fileName: string | null; fileSha256: string | null; externalReference: string | null;
  voidedAt: string | null; voidReason: string | null; serviceWeeks: string[];
  createdBy: { name: string }; exportedBy: { name: string } | null; voidedBy: { name: string } | null;
};
type Detail = Batch & { itemsTotal: number; page: number; pages: number;
  items: Array<{ id: string; orderId: string; employeeNumber: string; employeeName: string; employeeStatusSnapshot: string; inactiveEmployeeReviewed: boolean;
    departmentName: string | null; serviceWeekStart: string; itemCount: number; historicalUnitPrice: string; committedAmount: string; assignmentStatus: string | null;
    services: Array<{ serviceDate: string; serviceType: string; menuItemName: string }> }>;
  auditEvents: Array<{ eventType: string; createdAt: string; orderCount: number; reasonCode: string | null; actor: { name: string } }>;
};
type ApiError = Error & { code?: string };
type EmployeeRow = { employeeNumber: string; employeeName: string; employeeStatus: string; orders: number; services: number; amount: string; serviceWeeks: string[] };
type MassPreview = {
  payrollReference: string; period: { weekFrom: string; weekTo: string }; expiresAt: string; previewDigest: string; previewToken: string;
  confirmedOrdersInPeriod: number; serviceWeeks: string[]; actor: { name: string }; elapsedMs: number;
  totals: { eligible: Totals; requiresReview: Totals }; employees: EmployeeRow[]; requiresReview: Row[];
  excludedSummary: Record<string, number>; excludedRoutine: number; excludedAttention: Row[];
};

const REASONS: Record<string, string> = {
  ORDER_NOT_FOUND: "Pedido inexistente", ORDER_CANCELLED: "Pedido cancelado", ORDER_NOT_CONFIRMED: "Pedido no confirmado",
  ORDER_UNVERIFIED: "Nómina sin verificar (UNVERIFIED)", PAYROLL_STATUS_NOT_PENDING: "Cargo ya exportado o procesado",
  ACTIVE_ASSIGNMENT_EXISTS: "Ya asignado a un lote activo", EMPLOYEE_INACTIVE: "Excolaborador: requiere revisión de RH",
  EMPLOYEE_INVALID: "Colaborador inválido", EXTRAORDINARY_SERVICE: "Servicio extraordinario", ITEM_COUNT_INVALID: "Cantidad inválida",
  UNIT_PRICE_INVALID: "Precio histórico inválido", TOTAL_AMOUNT_INVALID: "Importe inválido", TOTAL_AMOUNT_MISMATCH: "Importe no cuadra con cantidad × precio",
  RESERVATIONS_REQUIRED: "Sin reservas", RESERVATION_COUNT_MISMATCH: "Reservas no coinciden con la cantidad", RESERVATION_NOT_ACTIVE: "Reserva no activa",
  RESERVATION_ORDER_MISMATCH: "Reserva de otro pedido", RESERVATION_EMPLOYEE_MISMATCH: "Reserva de otro colaborador",
  RESERVATION_MENU_ITEM_INVALID: "Platillo inválido", RESERVATION_WEEK_MISMATCH: "Reserva de otra semana", RESERVATION_DATE_OUTSIDE_WEEK: "Fecha fuera de la semana",
  SERVICE_WEEK_INVALID: "Semana de servicio inválida", PAYROLL_PERIOD_INVALID: "Referencia inválida",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  GENERATED: { label: "Generado", cls: "border-[#0B3A82]/30 bg-[#0B3A82]/5 text-[#0B3A82]" },
  EXPORTED: { label: "Exportado (pendiente de conciliar)", cls: "border-[#D6A800] bg-[#F4B400]/15 text-[#7a5a00]" },
  PARTIALLY_RECONCILED: { label: "Conciliación registrada (cierre pendiente)", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  RECONCILED: { label: "Conciliado y cerrado", cls: "border-emerald-400 bg-emerald-50 text-emerald-900" },
  VOIDED: { label: "Anulado", cls: "border-slate-300 bg-slate-100 text-slate-600" },
};
const EVENTS: Record<string, string> = {
  BATCH_CREATED: "Lote generado", BATCH_REPLAYED: "Reintento idempotente", BATCH_REJECTED: "Solicitud rechazada", BATCH_VOIDED: "Lote anulado",
  BATCH_EXPORTED: "Exportación oficial", ASSIGNMENT_RELEASED: "Asignaciones liberadas", RECONCILIATION_RECORDED: "Conciliación registrada", ADJUSTMENT_RECORDED: "Ajustes registrados",
  RECONCILIATION_REJECTED: "Conciliación rechazada", RECONCILIATION_REPLAYED: "Reintento de conciliación", RECONCILIATION_VOIDED: "Conciliación anulada",
  BATCH_RECONCILED: "Cierre definitivo", ADJUSTMENT_RESOLVED: "Ajuste resuelto", CONTROL_EXPORTED: "Reporte de control",
};
const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${btn} bg-[#0B3A82] text-white hover:bg-[#082d66]`;
const gold = `${btn} bg-[#F4B400] text-[#0B3A82] hover:bg-[#e0a600]`;
const outline = `${btn} border border-[#0B3A82]/30 bg-white text-[#0B3A82] hover:bg-[#0B3A82]/5`;
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#0B3A82]";
const mxn = (v: string | null) => v === null ? "—" : Number(v).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const dateMx = (v: string | null) => v ? new Date(`${v}T00:00:00Z`).toLocaleDateString("es-MX", { timeZone: "UTC" }) : "—";
const stamp = (v: string | null) => v ? new Date(v).toLocaleString("es-MX") : "—";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(response.status === 403 ? "Acceso restringido: falta el permiso de prenómina correspondiente." : data.error || "No fue posible completar la operación.") as ApiError;
    err.code = data.code; throw err;
  }
  return data as T;
}
function newKey() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export default function HrPayrollBatches() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);

  // selección
  const [filters, setFilters] = useState({ weekFrom: "", weekTo: "", employee: "", view: "selectable" });
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [idemKey, setIdemKey] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // prenómina masiva del periodo
  const [period, setPeriod] = useState({ weekFrom: "", weekTo: "", reference: "" });
  const [mass, setMass] = useState<MassPreview | null>(null);
  const [massReviewed, setMassReviewed] = useState<Set<string>>(new Set());
  const [massKey, setMassKey] = useState("");
  const [empFilter, setEmpFilter] = useState("");
  const [empPage, setEmpPage] = useState(1);
  const [candMeta, setCandMeta] = useState({ total: 0, page: 1, pages: 1 });

  // historial
  const [batches, setBatches] = useState<Batch[]>([]);
  const [historyFilter, setHistoryFilter] = useState({ status: "", reference: "" });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [voidTarget, setVoidTarget] = useState<Batch | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [exportTarget, setExportTarget] = useState<Batch | null>(null);
  const [externalRef, setExternalRef] = useState("");

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (inFlight.current) return undefined; // evita doble clic y doble envío
    inFlight.current = true; setBusy(label); setError(""); setSuccess("");
    try { return await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "No fue posible completar la operación."); return undefined; }
    finally { inFlight.current = false; setBusy(null); }
  }

  const loadHistory = useCallback(async (f = historyFilter) => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const data = await call<{ batches: Batch[] }>(`/api/food-services/hr/payroll/batches${q ? `?${q}` : ""}`);
    setBatches(data.batches);
  }, [historyFilter]);

  useEffect(() => {
    let active = true;
    void call<{ capabilities: Caps }>("/api/food-services/hr/payroll/capabilities").then(async d => {
      if (!active) return; setCaps(d.capabilities);
      if (d.capabilities.view) await loadHistory({ status: "", reference: "" });
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La conciliación, el cierre y la anulación de conciliación cambian el estado del lote: el historial se actualiza.
  useEffect(() => {
    const handler = () => { if (caps?.view) void loadHistory().catch(() => undefined); };
    window.addEventListener("yf:payroll-changed", handler);
    return () => window.removeEventListener("yf:payroll-changed", handler);
  }, [caps, loadHistory]);

  useEffect(() => { if (!preview && !mass) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [preview, mass]);
  const secondsLeft = preview ? Math.max(0, Math.floor((Date.parse(preview.expiresAt) - now) / 1000)) : 0;
  const massSecondsLeft = mass ? Math.max(0, Math.floor((Date.parse(mass.expiresAt) - now) / 1000)) : 0;
  const EMP_PAGE = 50;
  const massEmployees = useMemo(() => {
    const q = empFilter.trim().toLowerCase();
    return (mass?.employees ?? []).filter(e => !q || e.employeeNumber.toLowerCase().includes(q) || e.employeeName.toLowerCase().includes(q));
  }, [mass, empFilter]);
  const empPages = Math.max(1, Math.ceil(massEmployees.length / EMP_PAGE));

  const doMassPreview = () => run("mass-preview", async () => {
    const data = await call<MassPreview>("/api/food-services/hr/payroll/period/preview", { method: "POST",
      body: JSON.stringify({ payrollReference: period.reference, weekFrom: period.weekFrom, weekTo: period.weekTo }) });
    setMass(data); setMassReviewed(new Set()); setMassKey(newKey()); setEmpFilter(""); setEmpPage(1); setNow(Date.now());
  });

  const confirmMass = () => run("mass-create", async () => {
    if (!mass) return;
    try {
      const data = await call<{ batchId: string; orderCount: number; employeeCount: number; serviceCount: number; committedAmount: string; replayed: boolean }>(
        "/api/food-services/hr/payroll/period/batches", { method: "POST", headers: { "Idempotency-Key": massKey },
          body: JSON.stringify({ payrollReference: mass.payrollReference, weekFrom: mass.period.weekFrom, weekTo: mass.period.weekTo,
            reviewedInactiveOrderIds: [...massReviewed], previewToken: mass.previewToken }) });
      setSuccess(`${data.replayed ? "Lote ya registrado (reintento seguro)" : "Prenómina masiva generada"}: ${data.employeeCount} colaboradores, ${data.orderCount} pedidos, ${data.serviceCount} servicios, ${mxn(data.committedAmount)}. Folio ${data.batchId.slice(0, 8)}.`);
      setMass(null);
      if (caps?.view) await loadHistory();
    } catch (e) {
      const code = (e as ApiError).code;
      if (code === "PREVIEW_STALE" || code === "PREVIEW_EXPIRED") { setMass(null); throw new Error(`${(e as Error).message}`); }
      throw e;
    }
  });

  const selectable = useMemo(() => (candidates ?? []).filter(c => c.classification !== "excluded"), [candidates]);
  const selectedRows = useMemo(() => selectable.filter(c => selected.has(c.orderId)), [selectable, selected]);
  const selectedTotal = selectedRows.reduce((s, c) => s + Math.round(Number(c.committedAmount ?? 0) * 100), 0) / 100;

  const search = (page = 1) => run("search", async () => {
    const q = new URLSearchParams([...Object.entries(filters).filter(([, v]) => v), ["page", String(page)]]).toString();
    const data = await call<{ orders: Candidate[]; total: number; page: number; pages: number }>(`/api/food-services/hr/payroll/candidates?${q}`);
    setCandidates(data.orders); setCandMeta({ total: data.total, page: data.page, pages: data.pages }); setPreview(null);
    if (page === 1) setSelected(new Set());
  });

  const doPreview = () => run("preview", async () => {
    const data = await call<Preview>("/api/food-services/hr/payroll/preview", { method: "POST",
      body: JSON.stringify({ payrollReference: reference, orderIds: [...selected] }) });
    setPreview(data); setReviewed(new Set()); setIdemKey(newKey()); setNow(Date.now());
  });

  const includedIds = preview ? [...preview.eligible.map(r => r.orderId), ...preview.requiresReview.filter(r => reviewed.has(r.orderId)).map(r => r.orderId)] : [];

  const confirm = () => run("create", async () => {
    if (!preview) return;
    try {
      const data = await call<{ batchId: string; orderCount: number; committedAmount: string; replayed: boolean; serviceWeeks: string[] }>("/api/food-services/hr/payroll/batches", {
        method: "POST", headers: { "Idempotency-Key": idemKey },
        body: JSON.stringify({ payrollReference: preview.payrollReference, orderIds: includedIds, reviewedInactiveOrderIds: [...reviewed].filter(id => includedIds.includes(id)), previewToken: preview.previewToken }),
      });
      setSuccess(`${data.replayed ? "Lote ya registrado (reintento seguro)" : "Lote generado"}: ${data.orderCount} pedidos, ${mxn(data.committedAmount)}, ${data.serviceWeeks.length} semana(s). Folio ${data.batchId.slice(0, 8)}.`);
      setPreview(null); setCandidates(null); setSelected(new Set()); setReference("");
      if (caps?.view) await loadHistory();
    } catch (e) {
      const code = (e as ApiError).code;
      if (code === "PREVIEW_STALE" || code === "PREVIEW_EXPIRED" || code === "ACTIVE_ASSIGNMENT_EXISTS" || code === "ORDER_NOT_ELIGIBLE") {
        setPreview(null);
        throw new Error(`${(e as Error).message} Vuelve a buscar y genera una nueva vista previa.`);
      }
      throw e; // error de red u otro: el mismo Idempotency-Key permite reintentar sin duplicar
    }
  });

  const openDetail = (b: Batch | Detail, page = 1) => run(`detail:${b.id}`, async () => setDetail(await call<Detail>(`/api/food-services/hr/payroll/batches/${b.id}?page=${page}`)));

  const doVoid = () => run("void", async () => {
    if (!voidTarget) return;
    const r = await call<{ releasedAssignments: number }>(`/api/food-services/hr/payroll/batches/${voidTarget.id}/void`, { method: "POST", body: JSON.stringify({ reason: voidReason }) });
    setSuccess(`Lote anulado. ${r.releasedAssignments} pedido(s) liberados: pueden incluirse en un nuevo lote.`);
    setVoidTarget(null); setVoidReason(""); await loadHistory();
  });

  const doExport = () => run("export", async () => {
    if (!exportTarget) return;
    const r = await call<{ fileName: string; fileSha256: string; bytes: number }>(`/api/food-services/hr/payroll/batches/${exportTarget.id}/export`, {
      method: "POST", body: JSON.stringify(externalRef.trim() ? { externalReference: externalRef.trim() } : {}) });
    setSuccess(`Exportación oficial registrada: ${r.fileName} · SHA-256 ${r.fileSha256}. Exportar no significa que el descuento haya sido aplicado.`);
    setExportTarget(null); setExternalRef(""); await loadHistory();
  });

  const download = (b: Batch) => run(`download:${b.id}`, async () => {
    const response = await fetch(`/api/food-services/hr/payroll/batches/${b.id}/export`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error(d.error || "No fue posible descargar el archivo."); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = b.fileName ?? "prenomina.xlsx"; a.click(); URL.revokeObjectURL(url);
  });

  if (!caps) return <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{error
    ? <p role="alert" className="text-red-700">{error}</p> : <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Consultando permisos de prenómina…</span>}</section>;
  if (!caps.view && !caps.create) return <section className="rounded-2xl border border-slate-200 bg-white p-6">
    <p className="flex items-center gap-2 text-sm text-slate-700"><ShieldCheck className="size-5 text-[#0B3A82]" />No tienes permisos de prenómina. Solicítalos en C-PANEL (Consultar / Generar / Anular / Exportar prenómina).</p></section>;

  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 border-t-4 border-t-[#F4B400] bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-[#0B3A82]">Prenómina de Food Services</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Selecciona pedidos confirmados de cualquier semana, define libremente la referencia de prenómina y confirma el lote. Cada pedido conserva su semana y su precio histórico. Los reportes informativos no cambian estados; exportar no equivale a descuento aplicado.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">{(["view", "create", "void", "export"] as const).map(k =>
          <span key={k} className={`rounded-full border px-3 py-1 ${caps[k] ? "border-[#0B3A82]/30 bg-[#0B3A82]/5 text-[#0B3A82]" : "border-slate-200 text-slate-400"}`}>
            {{ view: "Consultar", create: "Generar", void: "Anular", export: "Exportar" }[k]}</span>)}</div>
      </div>
      {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><XCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
      {success && <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{success}</p>}
    </section>

    {caps.create && <section className="rounded-2xl border border-slate-200 border-l-4 border-l-[#0B3A82] bg-white p-5 sm:p-7">
      <h3 className="text-lg font-black text-[#0B3A82]">Prenómina masiva del periodo</h3>
      <p className="mt-1 text-sm text-slate-600">Incluye a <strong>todos los colaboradores</strong> con pedidos confirmados en las semanas de servicio del periodo, sin límite de cantidad. Solo se revisan individualmente las excepciones.</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e => { e.preventDefault(); void doMassPreview(); }}>
        <label className="text-sm font-semibold text-slate-700">Semana desde<input type="date" required className={input} value={period.weekFrom} onChange={e => setPeriod({ ...period, weekFrom: e.target.value })} /></label>
        <label className="text-sm font-semibold text-slate-700">Semana hasta<input type="date" required className={input} value={period.weekTo} onChange={e => setPeriod({ ...period, weekTo: e.target.value })} /></label>
        <label className="text-sm font-semibold text-slate-700">Referencia de prenómina<input required maxLength={40} className={input} placeholder="Ej. Quincena 2 noviembre" value={period.reference} onChange={e => setPeriod({ ...period, reference: e.target.value })} /></label>
        <div className="flex items-end"><button type="submit" className={`${gold} w-full`} disabled={busy !== null || !period.weekFrom || !period.weekTo || !period.reference.trim()}>
          {busy === "mass-preview" ? <><Loader2 className="size-4 animate-spin" />Calculando…</> : <><Eye className="size-4" />Calcular prenómina</>}</button></div>
      </form>

      {mass && <div className="mt-6 rounded-2xl border-2 border-[#F4B400] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-base font-black text-[#0B3A82]">{mass.payrollReference} · {dateMx(mass.period.weekFrom)} a {dateMx(mass.period.weekTo)}</p>
            <p className="text-xs text-slate-500">{mass.confirmedOrdersInPeriod} pedidos confirmados en el periodo · semanas {mass.serviceWeeks.map(dateMx).join(", ") || "—"} · calculado en {(mass.elapsedMs / 1000).toFixed(1)} s · digest {mass.previewDigest.slice(0, 12)}…</p></div>
          <p className={`rounded-full px-3 py-1 text-xs font-bold ${massSecondsLeft > 60 ? "bg-[#0B3A82]/5 text-[#0B3A82]" : "bg-red-50 text-red-700"}`}>{massSecondsLeft > 0 ? `Vence en ${Math.floor(massSecondsLeft / 60)}:${String(massSecondsLeft % 60).padStart(2, "0")}` : "Vista previa vencida"}</p>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-4">{[["Colaboradores únicos", mass.totals.eligible.employees], ["Pedidos", mass.totals.eligible.orders], ["Servicios", mass.totals.eligible.services], ["Importe total", mxn(mass.totals.eligible.amount)]].map(([k, v]) =>
          <div key={String(k)} className="rounded-xl border border-slate-200 p-3"><dt className="text-xs font-semibold uppercase text-slate-500">{k}</dt><dd className="text-xl font-black text-[#0B3A82]">{v}</dd></div>)}</dl>
        {mass.requiresReview.length > 0 && <div className="mt-4 rounded-xl border border-[#D6A800] bg-[#F4B400]/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-bold text-[#7a5a00]"><AlertTriangle className="size-4" />Excepciones: {mass.requiresReview.length} pedido(s) de excolaboradores. Marca los que RH revisó para incluirlos.</p>
            <button type="button" className={outline} disabled={busy !== null} onClick={() => { setMassReviewed(new Set(mass.requiresReview.map(r => r.orderId))); setMassKey(newKey()); }}>Marcar todos como revisados</button></div>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm">{mass.requiresReview.map(r => <li key={r.orderId}><label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-[#0B3A82]" checked={massReviewed.has(r.orderId)} disabled={busy !== null}
              onChange={e => { const s = new Set(massReviewed); if (e.target.checked) s.add(r.orderId); else s.delete(r.orderId); setMassReviewed(s); setMassKey(newKey()); }} />
            {r.employeeName} ({r.employeeNumber}) · semana {dateMx(r.serviceWeekStart)} · {mxn(r.committedAmount)}</label></li>)}</ul></div>}
        {(mass.excludedAttention.length > 0 || mass.excludedRoutine > 0) && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-bold text-slate-700">Fuera de este lote: {mass.excludedRoutine} ya procesados o asignados{mass.excludedAttention.length ? ` · ${mass.excludedAttention.length} requieren atención` : ""}</p>
          <p className="mt-1 text-xs text-slate-500">{Object.entries(mass.excludedSummary).map(([k, v]) => `${REASONS[k] ?? k}: ${v}`).join(" · ")}</p>
          {mass.excludedAttention.length > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-slate-600">{mass.excludedAttention.map(r => <li key={r.orderId}>{r.employeeName ?? r.orderId} ({r.employeeNumber}) · {r.reasons.map(x => REASONS[x] ?? x).join(" · ")}</li>)}</ul>}
        </div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-[#0B3A82]">Descuento por colaborador ({massEmployees.length})</p>
          <input className="w-64 rounded-xl border border-slate-300 px-3 py-1.5 text-sm" placeholder="Filtrar por número o nombre (consulta)" value={empFilter} onChange={e => { setEmpFilter(e.target.value); setEmpPage(1); }} />
        </div>
        <div className="mt-2 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-[#0B3A82] text-white"><tr><th className="p-2">No.</th><th className="p-2">Colaborador</th><th className="p-2 text-right">Pedidos</th><th className="p-2 text-right">Servicios</th><th className="p-2">Semanas</th><th className="p-2 text-right">Descuento</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{massEmployees.slice((empPage - 1) * EMP_PAGE, empPage * EMP_PAGE).map(e => <tr key={e.employeeNumber}>
            <td className="p-2 font-mono text-xs">{e.employeeNumber}</td><td className="p-2">{e.employeeName}</td><td className="p-2 text-right">{e.orders}</td>
            <td className="p-2 text-right">{e.services}</td><td className="p-2 text-xs">{e.serviceWeeks.map(dateMx).join(", ")}</td><td className="p-2 text-right font-semibold">{mxn(e.amount)}</td></tr>)}</tbody></table></div>
        <div className="mt-2 flex items-center justify-end gap-2 text-sm text-slate-600">
          <button type="button" className={outline} disabled={empPage <= 1} onClick={() => setEmpPage(empPage - 1)}>Anterior</button>
          <span>Página {empPage} de {empPages}</span>
          <button type="button" className={outline} disabled={empPage >= empPages} onClick={() => setEmpPage(empPage + 1)}>Siguiente</button></div>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" className={outline} disabled={busy !== null} onClick={() => setMass(null)}>Cancelar</button>
          <button type="button" className={primary} disabled={busy !== null || massSecondsLeft === 0 || mass.totals.eligible.orders + massReviewed.size === 0} onClick={() => void confirmMass()}>
            {busy === "mass-create" ? <><Loader2 className="size-4 animate-spin" />Generando prenómina…</> : <><CheckCircle2 className="size-4" />Generar prenómina de {mass.totals.eligible.employees} colaboradores ({mass.totals.eligible.orders + massReviewed.size} pedidos)</>}</button>
        </div>
      </div>}
    </section>}

    {caps.create && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
      <h3 className="text-lg font-black text-[#0B3A82]">Consulta y selección individual (opcional)</h3>
      <p className="mt-1 text-sm text-slate-600">Herramienta de consulta por colaborador o semana y para lotes de casos puntuales. Resultados paginados con total exacto.</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={e => { e.preventDefault(); void search(1); }}>
        <label className="text-sm font-semibold text-slate-700">Semana desde<input type="date" className={input} value={filters.weekFrom} onChange={e => setFilters({ ...filters, weekFrom: e.target.value })} /></label>
        <label className="text-sm font-semibold text-slate-700">Semana hasta<input type="date" className={input} value={filters.weekTo} onChange={e => setFilters({ ...filters, weekTo: e.target.value })} /></label>
        <label className="text-sm font-semibold text-slate-700">Colaborador<input className={input} placeholder="Número o nombre" maxLength={120} value={filters.employee} onChange={e => setFilters({ ...filters, employee: e.target.value })} /></label>
        <label className="text-sm font-semibold text-slate-700">Mostrar<select className={input} value={filters.view} onChange={e => setFilters({ ...filters, view: e.target.value })}>
          <option value="selectable">Pendientes</option><option value="all">Todos, con motivos</option></select></label>
        <div className="flex items-end"><button type="submit" className={`${primary} w-full`} disabled={busy !== null}>{busy === "search" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}Buscar</button></div>
      </form>

      {candidates && <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-slate-600">{candMeta.total} pedido(s) en total · página {candMeta.page} de {candMeta.pages} · {selectable.length} seleccionables en esta página · <strong className="text-[#0B3A82]">{selectedRows.length} seleccionados · {mxn(String(selectedTotal))}</strong></p>
          <div className="flex gap-2">
            <button type="button" className={outline} disabled={busy !== null} onClick={() => setSelected(new Set(selectable.filter(c => c.classification === "eligible").map(c => c.orderId)))}>Seleccionar elegibles</button>
            <button type="button" className={outline} disabled={busy !== null} onClick={() => setSelected(new Set())}>Limpiar</button>
          </div>
        </div>
        <div className="mt-3 max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="sticky top-0 bg-[#0B3A82] text-white"><tr>
              <th className="p-3"><span className="sr-only">Seleccionar</span></th><th className="p-3">Colaborador</th><th className="p-3">Semana</th>
              <th className="p-3 text-right">Servicios</th><th className="p-3 text-right">Precio histórico</th><th className="p-3 text-right">Importe</th><th className="p-3">Situación</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{candidates.map(c => <tr key={c.orderId} className={c.classification === "excluded" ? "bg-slate-50 text-slate-500" : ""}>
              <td className="p-3"><input type="checkbox" aria-label={`Seleccionar ${c.employeeName ?? c.orderId}`} className="size-4 accent-[#0B3A82]" disabled={c.classification === "excluded" || busy !== null}
                checked={selected.has(c.orderId)} onChange={e => { const s = new Set(selected); if (e.target.checked) s.add(c.orderId); else s.delete(c.orderId); setSelected(s); }} /></td>
              <td className="p-3"><p className="font-semibold text-slate-900">{c.employeeName}</p><p className="text-xs text-slate-500">{c.employeeNumber}</p></td>
              <td className="p-3">{dateMx(c.serviceWeekStart)}</td><td className="p-3 text-right">{c.quantity}</td>
              <td className="p-3 text-right">{mxn(c.historicalUnitPrice)}</td><td className="p-3 text-right font-semibold">{mxn(c.committedAmount)}</td>
              <td className="p-3 text-xs">{c.classification === "eligible" ? <span className="font-bold text-emerald-700">Elegible</span>
                : c.classification === "requiresReview" ? <span className="font-bold text-[#7a5a00]">Excolaborador: revisión de RH</span>
                : <span>{c.activeBatch ? `En lote ${c.activeBatch.payrollReference}` : c.reasons.map(r => REASONS[r] ?? r).join(" · ")}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {candMeta.pages > 1 && <div className="mt-2 flex items-center justify-end gap-2 text-sm text-slate-600">
          <button type="button" className={outline} disabled={busy !== null || candMeta.page <= 1} onClick={() => void search(candMeta.page - 1)}>Anterior</button>
          <span>Página {candMeta.page} de {candMeta.pages} (la selección se conserva entre páginas)</span>
          <button type="button" className={outline} disabled={busy !== null || candMeta.page >= candMeta.pages} onClick={() => void search(candMeta.page + 1)}>Siguiente</button></div>}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1 text-sm font-semibold text-slate-700">Referencia de prenómina (libre, definida por RH)
            <input className={input} maxLength={40} placeholder="Ej. Quincena 2 noviembre, NOM-45, Pago extraordinario" value={reference} onChange={e => setReference(e.target.value)} /></label>
          <button type="button" className={gold} disabled={busy !== null || selected.size === 0 || reference.trim().length === 0} onClick={() => void doPreview()}>
            {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}Vista previa</button>
        </div>
      </div>}
    </section>}

    {preview && <section className="rounded-2xl border-2 border-[#F4B400] bg-white p-5 sm:p-7" aria-labelledby="pv-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 id="pv-title" className="text-lg font-black text-[#0B3A82]">Vista previa de la selección individual · {preview.payrollReference}</h3>
          <p className="text-sm text-slate-600">Semanas: {preview.serviceWeeks.map(dateMx).join(", ") || "—"} · Preparada por {preview.actor.name} · Digest {preview.previewDigest.slice(0, 12)}…</p></div>
        <p className={`rounded-full px-3 py-1 text-xs font-bold ${secondsLeft > 60 ? "bg-[#0B3A82]/5 text-[#0B3A82]" : "bg-red-50 text-red-700"}`}>{secondsLeft > 0 ? `Vence en ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "Vista previa vencida"}</p>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-4">{[["Pedidos", preview.totals.eligible.orders], ["Colaboradores", preview.totals.eligible.employees], ["Servicios", preview.totals.eligible.services], ["Importe elegible", mxn(preview.totals.eligible.amount)]].map(([k, v]) =>
        <div key={String(k)} className="rounded-xl border border-slate-200 p-3"><dt className="text-xs font-semibold uppercase text-slate-500">{k}</dt><dd className="text-lg font-black text-[#0B3A82]">{v}</dd></div>)}</dl>
      {preview.requiresReview.length > 0 && <div className="mt-4 rounded-xl border border-[#D6A800] bg-[#F4B400]/10 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-[#7a5a00]"><AlertTriangle className="size-4" />Excolaboradores con obligación válida: marca cada uno que RH revisó para incluirlo.</p>
        <ul className="mt-2 space-y-1 text-sm">{preview.requiresReview.map(r => <li key={r.orderId}><label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-[#0B3A82]" checked={reviewed.has(r.orderId)} disabled={busy !== null}
            onChange={e => { const s = new Set(reviewed); if (e.target.checked) s.add(r.orderId); else s.delete(r.orderId); setReviewed(s); setIdemKey(newKey()); }} />
          {r.employeeName} ({r.employeeNumber}) · semana {dateMx(r.serviceWeekStart)} · {mxn(r.committedAmount)}</label></li>)}</ul></div>}
      {preview.excluded.length > 0 && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <p className="font-bold text-slate-700">Excluidos ({preview.excluded.length})</p>
        <ul className="mt-2 space-y-1 text-slate-600">{preview.excluded.map(r => <li key={r.orderId}>{r.employeeName ?? r.orderId} · {r.reasons.map(x => REASONS[x] ?? x).join(" · ")}</li>)}</ul></div>}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" className={outline} disabled={busy !== null} onClick={() => setPreview(null)}>Cancelar</button>
        <button type="button" className={primary} disabled={busy !== null || includedIds.length === 0 || secondsLeft === 0} onClick={() => void confirm()}>
          {busy === "create" ? <><Loader2 className="size-4 animate-spin" />Generando lote…</> : <><CheckCircle2 className="size-4" />Confirmar generación ({includedIds.length})</>}</button>
      </div>
    </section>}

    {caps.view && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-lg font-black text-[#0B3A82]">Historial de lotes</h3>
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void run("history", () => loadHistory()); }}>
          <label className="text-xs font-semibold text-slate-600">Estado<select className={input} value={historyFilter.status} onChange={e => setHistoryFilter({ ...historyFilter, status: e.target.value })}>
            <option value="">Todos</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Referencia<input className={input} maxLength={40} value={historyFilter.reference} onChange={e => setHistoryFilter({ ...historyFilter, reference: e.target.value })} /></label>
          <button type="submit" className={outline} disabled={busy !== null}>{busy === "history" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}Filtrar</button>
        </form>
      </div>
      {batches.length === 0 ? <p className="mt-4 text-sm text-slate-500">Sin lotes registrados.</p> :
        <ul className="mt-4 divide-y divide-slate-100">{batches.map(b => <li key={b.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2"><strong className="text-slate-900">{b.payrollReference}</strong>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS[b.status]?.cls ?? ""}`}>{STATUS[b.status]?.label ?? b.status}</span>
              <span className="text-xs text-slate-500">Folio {b.id.slice(0, 8)}</span></p>
            <p className="mt-1 text-sm text-slate-600">{b.orderCount} pedidos · {b.employeeCount} colaboradores · {b.serviceCount} servicios · <strong className="text-[#0B3A82]">{mxn(b.committedAmount)}</strong> · Semanas {b.serviceWeeks.map(dateMx).join(", ")}</p>
            <p className="text-xs text-slate-500">Generado {stamp(b.generatedAt)} por {b.createdBy.name}
              {b.exportedAt && <> · Exportado {stamp(b.exportedAt)} por {b.exportedBy?.name} · <span className="font-mono">SHA-256 {b.fileSha256}</span></>}
              {b.voidedAt && <> · Anulado {stamp(b.voidedAt)} por {b.voidedBy?.name}: {b.voidReason}</>}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" className={outline} disabled={busy !== null} onClick={() => void openDetail(b)}>{busy === `detail:${b.id}` ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}Detalle</button>
            {caps.export && b.status === "GENERATED" && <button type="button" className={gold} disabled={busy !== null} onClick={() => { setExportTarget(b); setExternalRef(""); }}><FileSpreadsheet className="size-4" />Exportar oficial</button>}
            {b.exportedAt && <button type="button" className={outline} disabled={busy !== null} onClick={() => void download(b)}>{busy === `download:${b.id}` ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Descargar</button>}
            {caps.reconView && ["EXPORTED", "PARTIALLY_RECONCILED", "RECONCILED"].includes(b.status) && <button type="button" className={primary} disabled={busy !== null}
              onClick={() => window.dispatchEvent(new CustomEvent("yf:payroll-reconcile", { detail: b.id }))}><Scale className="size-4" />{b.status === "EXPORTED" && caps.reconcile ? "Conciliar" : "Ver conciliación"}</button>}
            {caps.void && b.status === "GENERATED" && <button type="button" className={`${btn} border border-red-200 bg-white text-red-700 hover:bg-red-50`} disabled={busy !== null} onClick={() => { setVoidTarget(b); setVoidReason(""); }}><XCircle className="size-4" />Anular</button>}
          </div>
        </li>)}</ul>}
    </section>}

    {voidTarget && <Modal title="Anular lote de prenómina" onClose={() => busy === null && setVoidTarget(null)}>
      <p className="text-sm text-slate-700">Se anulará el lote <strong>{voidTarget.payrollReference}</strong> ({voidTarget.orderCount} pedidos, {mxn(voidTarget.committedAmount)}). Sus asignaciones se liberarán en la misma operación y los pedidos podrán incluirse en otro lote. Solo es posible antes de la exportación oficial.</p>
      <label className="mt-4 block text-sm font-bold">Motivo obligatorio<textarea autoFocus minLength={5} maxLength={500} className={`${input} min-h-24`} value={voidReason} disabled={busy !== null} onChange={e => setVoidReason(e.target.value)} /></label>
      <div className="mt-5 flex justify-end gap-3"><button type="button" className={outline} disabled={busy !== null} onClick={() => setVoidTarget(null)}>Volver</button>
        <button type="button" className={`${btn} bg-red-700 text-white hover:bg-red-800`} disabled={busy !== null || voidReason.trim().length < 5} onClick={() => void doVoid()}>{busy === "void" ? <><Loader2 className="size-4 animate-spin" />Anulando…</> : "Confirmar anulación"}</button></div>
    </Modal>}

    {exportTarget && <Modal title="Exportación oficial" onClose={() => busy === null && setExportTarget(null)}>
      <p className="text-sm text-slate-700">Se generará el archivo Excel oficial del lote <strong>{exportTarget.payrollReference}</strong> y se registrará con su SHA-256. Solo se exporta una vez; después podrás descargar el mismo archivo. <strong>Exportar no significa que el descuento haya sido aplicado</strong>: eso se confirma en la conciliación.</p>
      <label className="mt-4 block text-sm font-bold">Referencia externa (opcional)<input className={input} maxLength={160} value={externalRef} disabled={busy !== null} onChange={e => setExternalRef(e.target.value)} placeholder="Ej. folio de envío a nómina" /></label>
      <div className="mt-5 flex justify-end gap-3"><button type="button" className={outline} disabled={busy !== null} onClick={() => setExportTarget(null)}>Volver</button>
        <button type="button" className={gold} disabled={busy !== null} onClick={() => void doExport()}>{busy === "export" ? <><Loader2 className="size-4 animate-spin" />Exportando…</> : <><FileSpreadsheet className="size-4" />Confirmar exportación</>}</button></div>
    </Modal>}

    {detail && <Modal title={`Lote ${detail.payrollReference}`} wide onClose={() => setDetail(null)}>
      <p className="text-sm text-slate-600">{STATUS[detail.status]?.label ?? detail.status} · {detail.employeeCount} colaboradores · {detail.orderCount} pedidos · {mxn(detail.committedAmount)} · Folio {detail.id}</p>
      <p className="mt-1 text-xs text-slate-500">Renglones {(detail.page - 1) * 200 + 1}–{Math.min(detail.page * 200, detail.itemsTotal)} de {detail.itemsTotal}. El Excel oficial incluye todos los renglones.</p>
      <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[760px] text-left text-xs">
        <thead className="sticky top-0 bg-[#0B3A82] text-white"><tr><th className="p-2">Colaborador</th><th className="p-2">Semana</th><th className="p-2">Servicios</th><th className="p-2 text-right">Precio</th><th className="p-2 text-right">Importe</th><th className="p-2">Asignación</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{detail.items.map(i => <tr key={i.id}>
          <td className="p-2"><strong>{i.employeeName}</strong> <span className="text-slate-500">{i.employeeNumber}</span>{i.inactiveEmployeeReviewed && <span className="ml-1 rounded bg-[#F4B400]/20 px-1 text-[#7a5a00]">Excolaborador revisado</span>}</td>
          <td className="p-2">{dateMx(i.serviceWeekStart)}</td><td className="p-2">{i.services.map(s => `${dateMx(s.serviceDate)} ${s.menuItemName}`).join(" · ")}</td>
          <td className="p-2 text-right">{mxn(i.historicalUnitPrice)}</td><td className="p-2 text-right font-semibold">{mxn(i.committedAmount)}</td>
          <td className="p-2">{i.assignmentStatus === "ACTIVE" ? "Activa" : i.assignmentStatus === "RELEASED" ? "Liberada" : "—"}</td></tr>)}</tbody></table></div>
      {detail.pages > 1 && <div className="mt-2 flex items-center justify-end gap-2 text-sm text-slate-600">
        <button type="button" className={outline} disabled={busy !== null || detail.page <= 1} onClick={() => void openDetail(detail, detail.page - 1)}>Anterior</button>
        <span>Página {detail.page} de {detail.pages}</span>
        <button type="button" className={outline} disabled={busy !== null || detail.page >= detail.pages} onClick={() => void openDetail(detail, detail.page + 1)}>Siguiente</button></div>}
      <h4 className="mt-4 text-sm font-bold text-[#0B3A82]">Historial auditable</h4>
      <ul className="mt-2 space-y-1 text-xs text-slate-600">{detail.auditEvents.map((e, i) => <li key={i}>{stamp(e.createdAt)} · {EVENTS[e.eventType] ?? e.eventType} · {e.actor.name} · {e.orderCount} pedido(s){e.reasonCode ? ` · ${e.reasonCode}` : ""}</li>)}</ul>
    </Modal>}
  </div>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4" onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
    <div className={`w-full ${wide ? "max-w-5xl" : "max-w-lg"} rounded-2xl border-t-4 border-t-[#F4B400] bg-white p-6 shadow-xl`}>
      <div className="flex items-start justify-between gap-3"><h3 className="text-lg font-black text-[#0B3A82]">{title}</h3>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><XCircle className="size-5" /></button></div>
      <div className="mt-3">{children}</div>
    </div>
  </div>;
}
