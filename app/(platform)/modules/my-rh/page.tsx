"use client";

import { FileText, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { HR_REQUEST_TYPES, HR_STATUS_LABELS, type HrRequestTypeKey } from "@/lib/hr/request-config";

type RequestRow = {
  id: string; folio: string; type: HrRequestTypeKey; status: string; startDate: string; endDate: string | null;
  startTime: string | null; endTime: string | null; requestedDays: string | null; reason: string; createdAt: string;
  employee: { fullName: string; employeeNumber: string; position: string | null; department: { name: string }; profile: { manager: { fullName: string } | null; managerUser: { name: string } | null } | null };
};

type RoutingInfo = {
  employeeName: string;
  managerName: string | null;
};

const initialForm = { type: "VACATION" as HrRequestTypeKey, startDate: "", endDate: "", startTime: "", endTime: "", requestedDays: "", reason: "" };

function dateLabel(value: string) { return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)); }

export default function MyHrPage() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [teamRows, setTeamRows] = useState<RequestRow[]>([]);
  const [routing, setRouting] = useState<RoutingInfo | null>(null);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const [ownResponse, teamResponse] = await Promise.all([
      fetch("/api/hr/requests", { cache: "no-store" }),
      fetch("/api/hr/requests?scope=team", { cache: "no-store" }),
    ]);
    const ownData = await ownResponse.json();
    const teamData = await teamResponse.json();
    if (!ownResponse.ok) setError(ownData.error ?? "No fue posible cargar tus solicitudes.");
    else {
      setRows(ownData.requests ?? []);
      setRouting(ownData.routing ?? null);
      setError("");
    }
    if (teamResponse.ok) setTeamRows(teamData.requests ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const config = HR_REQUEST_TYPES[form.type];
  const needsTime = ["EARLY_DEPARTURE", "LATE_ARRIVAL", "HOURLY_PERMISSION"].includes(form.type);
  const needsEndTime = form.type === "HOURLY_PERMISSION";
  const needsEndDate = ["VACATION", "MEDICAL_LEAVE", "ABSENCE_PERMISSION"].includes(form.type);
  const requiresManager = config.route === "MANAGER_THEN_HR";
  const managerMissing = requiresManager && !routing?.managerName;

  const pending = useMemo(() => rows.filter((r) => ["PENDING_MANAGER", "PENDING_HR", "INFORMATION_REQUIRED"].includes(r.status)).length, [rows]);

  async function decideTeam(id: string, decision: "APPROVE" | "REJECT") {
    const comment = decision === "REJECT" ? window.prompt("Motivo del rechazo:") : null;
    if (decision === "REJECT" && !comment) return;
    const response = await fetch(`/api/hr/requests/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, comment }) });
    const data = await response.json();
    if (!response.ok) setError(data.error ?? "No fue posible registrar la decisión.");
    else await load();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (managerMissing) {
      setError("Recursos Humanos debe asignar un jefe directo antes de enviar esta solicitud.");
      return;
    }
    setSaving(true); setError(""); setMessage("");
    const response = await fetch("/api/hr/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json();
    if (!response.ok) setError(data.error ?? "No fue posible enviar la solicitud.");
    else { setMessage(`Solicitud ${data.request.folio} enviada correctamente.`); setForm(initialForm); await load(); }
    setSaving(false);
  }

  return <div className="space-y-8">
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#B77900]">YellowFlex · Recursos Humanos</p>
      <div className="mt-2 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div><h1 className="text-3xl font-black tracking-tight text-slate-950">Mi RH</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Solicita vacaciones, permisos, salidas, entradas tardías y justificaciones. Consulta aquí el estado de cada trámite.</p></div>
        <div className="rounded-2xl bg-blue-50 px-5 py-3 text-sm font-bold text-[#0B3A82]">{pending} solicitud{pending === 1 ? "" : "es"} en proceso</div>
      </div>
    </section>

    {teamRows.length > 0 && <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-bold text-slate-950">Solicitudes de mi equipo</h2><p className="mt-1 text-sm text-slate-500">Como jefe inmediato, aquí resuelves la primera etapa antes de que la solicitud llegue a RH.</p><div className="mt-4 divide-y divide-slate-100">{teamRows.filter((row) => row.status === "PENDING_MANAGER").map((row) => <div key={row.id} className="flex flex-col justify-between gap-4 py-4 lg:flex-row lg:items-center"><div><b className="text-slate-950">{row.folio} · {row.employee.fullName}</b><p className="text-sm font-semibold text-[#0B3A82]">{HR_REQUEST_TYPES[row.type].label}</p><p className="mt-1 text-sm text-slate-600">{row.reason}</p></div><div className="flex gap-2"><button onClick={() => decideTeam(row.id, "APPROVE")} className="rounded-xl bg-[#0B3A82] px-4 py-2 text-xs font-bold text-white">Aprobar y enviar a RH</button><button onClick={() => decideTeam(row.id, "REJECT")} className="rounded-xl border border-red-200 px-4 py-2 text-xs font-bold text-red-700">Rechazar</button></div></div>)}{teamRows.filter((row) => row.status === "PENDING_MANAGER").length === 0 && <p className="py-4 text-sm text-slate-500">No tienes solicitudes pendientes de aprobación.</p>}</div></section>}

    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-[#0B3A82]"><Send className="size-5" /></span><div><h2 className="font-bold text-slate-950">Nueva solicitud</h2><p className="text-xs text-slate-500">Platform validará al responsable antes de enviarla.</p></div></div>
        <div className="mt-6 space-y-4">
          <Field label="Tipo"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as HrRequestTypeKey })} className={inputClass}>{Object.entries(HR_REQUEST_TYPES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></Field>
          {requiresManager ? <div className={`rounded-2xl border px-4 py-3 ${managerMissing ? "border-red-200 bg-red-50" : "border-blue-100 bg-blue-50/60"}`}><p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${managerMissing ? "text-red-600" : "text-[#0B3A82]"}`}>Jefe directo</p><p className={`mt-1 text-sm font-bold ${managerMissing ? "text-red-700" : "text-slate-950"}`}>{routing?.managerName ?? "Sin jefe directo asignado"}</p>{managerMissing && <p className="mt-1 text-xs text-red-600">Contacta a Recursos Humanos para corregir tu jerarquía.</p>}</div> : <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#0B3A82]">Responsable</p><p className="mt-1 text-sm font-bold text-slate-950">Recursos Humanos</p></div>}
          <div className="grid grid-cols-2 gap-3"><Field label="Fecha inicial"><input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputClass} /></Field>{needsEndDate && <Field label="Fecha final"><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputClass} /></Field>}</div>
          {form.type === "VACATION" && <Field label="Días solicitados"><input required min="0.5" step="0.5" type="number" value={form.requestedDays} onChange={(e) => setForm({ ...form, requestedDays: e.target.value })} className={inputClass} /></Field>}
          {needsTime && <div className="grid grid-cols-2 gap-3"><Field label={form.type === "LATE_ARRIVAL" ? "Hora de entrada" : "Hora de salida"}><input required type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputClass} /></Field>{needsEndTime && <Field label="Hora de regreso"><input required type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={inputClass} /></Field>}</div>}
          <Field label="Motivo"><textarea required rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputClass} placeholder="Describe brevemente la solicitud..." /></Field>
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}{message && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p>}
          <button disabled={saving || managerMissing} className="h-11 w-full rounded-2xl bg-[#0B3A82] px-5 text-sm font-bold text-white transition hover:bg-[#082E68] disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Enviando..." : "Enviar solicitud"}</button>
        </div>
      </form>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-6"><h2 className="font-bold text-slate-950">Mis solicitudes</h2><p className="mt-1 text-sm text-slate-500">Historial y estado actual de tus trámites.</p></div>
        {loading ? <p className="p-6 text-sm text-slate-500">Cargando...</p> : rows.length === 0 ? <div className="p-10 text-center"><FileText className="mx-auto size-8 text-slate-300"/><p className="mt-3 text-sm text-slate-500">Todavía no tienes solicitudes.</p></div> : <div className="divide-y divide-slate-100">{rows.map((row) => <article key={row.id} className="p-5 sm:p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><span className="font-black text-slate-950">{row.folio}</span><Status value={row.status}/></div><p className="mt-1 font-semibold text-[#0B3A82]">{HR_REQUEST_TYPES[row.type].label}</p><p className="mt-2 text-sm text-slate-500">{dateLabel(row.startDate)}{row.endDate ? ` → ${dateLabel(row.endDate)}` : ""}{row.startTime ? ` · ${row.startTime}${row.endTime ? `–${row.endTime}` : ""}` : ""}</p><p className="mt-2 text-sm text-slate-700">{row.reason}</p></div><div className="text-xs text-slate-400">{row.status === "PENDING_MANAGER" ? `Pendiente de ${row.employee.profile?.manager?.fullName ?? row.employee.profile?.managerUser?.name ?? "jefe directo"}` : row.status === "PENDING_HR" ? "Pendiente de Recursos Humanos" : HR_STATUS_LABELS[row.status] ?? row.status}</div></div></article>)}</div>}
      </section>
    </div>
  </div>;
}

const inputClass = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#0B3A82]/40 focus:ring-4 focus:ring-blue-50";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-bold text-slate-600">{label}{children}</label>; }
function Status({ value }: { value: string }) { const final = value === "AUTHORIZED"; const rejected = value === "REJECTED"; return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${final ? "bg-emerald-50 text-emerald-700" : rejected ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{HR_STATUS_LABELS[value] ?? value}</span>; }
