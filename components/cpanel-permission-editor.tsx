"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

type Action = "view" | "operate" | "approve" | "audit" | "manage" | "cancel-food-order"
  | "create-payroll-batch" | "view-payroll-batches" | "void-payroll-batch" | "export-payroll-batch"
  | "view-payroll-reconciliations" | "register-payroll-reconciliation" | "manage-payroll-adjustments" | "close-payroll-batch" | "export-payroll-control";
type Permission = { moduleKey: string; actionKey: string; granted: boolean };
type Audit = { id: string; moduleKey: string; actionKey: string; oldGranted: boolean | null; newGranted: boolean; reason: string | null; createdAt: string };
type ResponseBody = { permissions?: Permission[]; audit?: Audit[]; scope?: "admin" | "rh"; error?: string };

const modules = [
  ["dashboard", "Inicio"], ["food-services", "Food Services"], ["my-rh", "Mi RH"],
  ["rrhh", "Recursos Humanos"], ["control-tower", "Control Tower"],
  ["purchases", "Compras"], ["mantenimiento", "Mantenimiento"],
  ["warehouse", "Almacén"], ["calidad", "Calidad"],
  ["mejora-continua", "Mejora Continua"], ["vigilancia", "Vigilancia"],
  ["settings", "Configuración"], ["c-panel", "C-PANEL"],
] as const;
const actions: { key: Action; label: string }[] = [
  { key: "view", label: "Ver" }, { key: "operate", label: "Operar" },
  { key: "approve", label: "Aprobar" }, { key: "audit", label: "Auditar" },
  { key: "manage", label: "Administrar" },
];
/** Acciones sensibles exclusivas de Food Services y del rol RH (sin acceso implícito para ADMIN). */
const foodActions: { key: Action; label: string }[] = [
  { key: "cancel-food-order", label: "Cancelar pedido Food" },
  { key: "view-payroll-batches", label: "Consultar prenómina" },
  { key: "create-payroll-batch", label: "Generar prenómina" },
  { key: "void-payroll-batch", label: "Anular prenómina" },
  { key: "export-payroll-batch", label: "Exportar prenómina" },
  { key: "view-payroll-reconciliations", label: "Consultar conciliaciones" },
  { key: "register-payroll-reconciliation", label: "Registrar conciliación" },
  { key: "manage-payroll-adjustments", label: "Gestionar ajustes" },
  { key: "close-payroll-batch", label: "Cerrar lote" },
  { key: "export-payroll-control", label: "Exportar reportes de control" },
];

export default function CpanelPermissionEditor({ userId, userName }: { userId: string; userName: string }) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [scope, setScope] = useState<"admin" | "rh">("rh");
  const [audit, setAudit] = useState<Audit[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchPermissions = useCallback(async () => {
    const response = await fetch(`/api/admin/cpanel/permissions?userId=${encodeURIComponent(userId)}`, { cache: "no-store", credentials: "same-origin" });
    const body = (await response.json()) as ResponseBody;
    if (!response.ok) throw new Error(response.status === 403 ? "Acceso restringido" : body.error ?? "No se pudieron consultar los permisos.");
    return body;
  }, [userId]);
  const applyBody = (body: ResponseBody) => {
    setPermissions(body.permissions ?? []);
    setScope(body.scope ?? "rh");
    setAudit(body.audit ?? []);
  };
  const load = async () => applyBody(await fetchPermissions());

  useEffect(() => {
    let active = true;
    void fetchPermissions().then((body) => { if (active) applyBody(body); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Error al cargar."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchPermissions]);

  async function change(moduleKey: string, actionKey: Action, granted: boolean) {
    if (busyKey) return;
    if (reason.trim().length < 5) { setError("Escribe un motivo de al menos cinco caracteres para auditar el cambio."); return; }
    const key = `${moduleKey}:${actionKey}`;
    setBusyKey(key);
    setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/cpanel/permissions", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, moduleKey, actionKey, granted, reason: reason.trim() }),
      });
      const body = (await response.json()) as ResponseBody;
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar el permiso.");
      await load();
      setSuccess("Permiso actualizado y cambio registrado en auditoría.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No fue posible guardar.");
    } finally { setBusyKey(null); }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 size-6 text-[#0b3a82]" />
        <div>
          <h2 className="text-xl font-bold text-[#0b3a82]">C-PANEL · Permisos corporativos</h2>
          <p className="mt-1 text-sm text-slate-600">{userName} · Permisos individuales, auditados y administrados por ADMIN o por RH con delegación expresa.</p>
          <p className="mt-1 text-xs text-amber-800">Estos permisos todavía no sustituyen los controles operativos existentes de Compras y Almacén.</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {success && <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="size-4" />{success}</p>}
      <label className="mt-5 block text-sm font-semibold text-slate-700">
        Motivo del cambio (obligatorio)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ej. Autorización de Dirección para acceso al módulo" className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal outline-none focus:border-[#0b3a82]" />
      </label>
      {loading ? <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Consultando permisos...</p> : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50"><tr><th className="p-3 text-blue-950">Módulo</th>{actions.map((action) => <th key={action.key} className="p-3 text-center text-blue-950">{action.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{modules.map(([key, label]) => (
              <tr key={key}><th className="p-3 font-semibold text-slate-700">{label}</th>{actions.map(({ key: actionKey }) => {
                const checked = permissions.some((p) => p.moduleKey === key && p.actionKey === actionKey && p.granted);
                const editable = scope === "admin" || ((actionKey === "view" || actionKey === "operate") && key !== "c-panel" && key !== "settings");
                const cellKey = `${key}:${actionKey}`;
                return <td key={actionKey} className="p-3 text-center"><input aria-label={`${label}: ${actionKey}`} type="checkbox" className="size-4 cursor-pointer accent-[#0b3a82]" checked={checked} disabled={busyKey !== null || !editable} onChange={(e) => void change(key, actionKey, e.target.checked)} />{busyKey === cellKey && <Loader2 className="ml-1 inline size-3 animate-spin" />}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!loading && (
        <div className="mt-5 rounded-xl border border-slate-200 border-l-4 border-l-[#F4B400] p-4">
          <h3 className="font-bold text-[#0b3a82]">Food Services · acciones sensibles (solo cuentas RH)</h3>
          <p className="mt-1 text-xs text-slate-600">Prenómina, conciliación, ajustes y cierre. Se validan en la interfaz y en cada API; ADMIN no las obtiene de forma implícita.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{foodActions.map(({ key: actionKey, label }) => {
            const checked = permissions.some((p) => p.moduleKey === "food-services" && p.actionKey === actionKey && p.granted);
            const cellKey = `food-services:${actionKey}`;
            return <label key={actionKey} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input aria-label={`Food Services: ${actionKey}`} type="checkbox" className="size-4 cursor-pointer accent-[#0b3a82]" checked={checked} disabled={busyKey !== null || scope !== "admin"} onChange={(e) => void change("food-services", actionKey, e.target.checked)} />
              {label}{busyKey === cellKey && <Loader2 className="ml-1 inline size-3 animate-spin" />}
            </label>;
          })}</div>
        </div>
      )}
      <div className="mt-6">
        <h3 className="font-bold text-blue-950">Últimos cambios auditados</h3>
        {audit.length === 0 ? <p className="mt-2 text-sm text-slate-500">Sin cambios registrados.</p> : (
          <ul className="mt-3 max-h-60 space-y-2 overflow-y-auto">{audit.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">
              <strong>{entry.moduleKey} · {entry.actionKey}</strong> — {entry.newGranted ? "Concedido" : "Revocado"} · {new Date(entry.createdAt).toLocaleString("es-MX")}
              <span className="mt-1 block text-slate-500">Motivo: {entry.reason || "Sin motivo"}</span>
            </li>
          ))}</ul>
        )}
      </div>
    </section>
  );
}
