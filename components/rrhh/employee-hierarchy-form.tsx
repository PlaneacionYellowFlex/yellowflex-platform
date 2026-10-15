"use client";

import { Building2, CalendarDays, LoaderCircle, Save, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type EmployeeOption = {
  id: string;
  employeeNumber: string;
  fullName: string;
  position: string | null;
  department: { name: string };
};

type DirectionOption = { id: string; name: string; email: string };
type CatalogResponse = {
  data?: {
    employee: {
      profile: {
        managerId: string | null;
        managerUserId: string | null;
      } | null;
    };
    employees: EmployeeOption[];
    directionUsers: DirectionOption[];
  };
  error?: string;
};

type Props = {
  employeeId: string;
  currentManagerName: string | null;
};

export default function EmployeeHierarchyForm({ employeeId, currentManagerName }: Props) {
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [directionUsers, setDirectionUsers] = useState<DirectionOption[]>([]);
  const [selection, setSelection] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/rrhh/employees/${employeeId}/hierarchy`, { cache: "no-store" });
        const payload = (await response.json()) as CatalogResponse;
        if (!response.ok || !payload.data) throw new Error(payload.error ?? "No fue posible cargar la jerarquía.");
        if (!cancelled) {
          setEmployees(payload.data.employees);
          setDirectionUsers(payload.data.directionUsers);
          const profile = payload.data.employee.profile;
          if (profile?.managerId) setSelection(`employee:${profile.managerId}`);
          else if (profile?.managerUserId) setSelection(`user:${profile.managerUserId}`);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "No fue posible cargar la jerarquía.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [employeeId]);

  const selectedLabel = useMemo(() => {
    if (selection.startsWith("employee:")) {
      return employees.find((item) => `employee:${item.id}` === selection)?.fullName ?? null;
    }
    return directionUsers.find((item) => `user:${item.id}` === selection)?.name ?? null;
  }, [selection, employees, directionUsers]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null); setError(null);
    if (!selection) return setError("Selecciona el nuevo jefe inmediato.");
    if (!effectiveDate) return setError("La fecha efectiva es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");

    const [kind, id] = selection.split(":");
    setSaving(true);
    try {
      const response = await fetch(`/api/rrhh/employees/${employeeId}/hierarchy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          managerId: kind === "employee" ? id : null,
          managerUserId: kind === "user" ? id : null,
          effectiveDate,
          reason,
          notes,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible actualizar el jefe inmediato.");
      setMessage("Jerarquía actualizada correctamente.");
      setReason(""); setNotes("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No fue posible actualizar la jerarquía.");
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
        <p className="text-xs font-medium text-slate-500">Jefe inmediato actual</p>
        <p className="mt-1 text-sm font-bold text-slate-900">{currentManagerName ?? "Sin jefe inmediato asignado"}</p>
      </div>

      <label className="block">
        <span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700"><UsersRound className="size-4 text-slate-400" />Nuevo jefe inmediato</span>
        <select value={selection} onChange={(e) => setSelection(e.target.value)} disabled={loading} className={inputClassName}>
          <option value="">{loading ? "Cargando jerarquía..." : "Seleccionar jefe inmediato"}</option>
          {employees.length > 0 && <optgroup label="Colaboradores activos">{employees.map((item) => <option key={item.id} value={`employee:${item.id}`}>{item.fullName} · {item.position ?? "Sin puesto"} · {item.department.name}</option>)}</optgroup>}
          {directionUsers.length > 0 && <optgroup label="Dirección">{directionUsers.map((item) => <option key={item.id} value={`user:${item.id}`}>{item.name} · Dirección</option>)}</optgroup>}
        </select>
      </label>

      {selectedLabel && <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm"><Building2 className="size-4 text-[#0b3a82]" /><span className="text-slate-600">Nueva línea de reporte: <strong className="text-slate-900">{selectedLabel}</strong></span></div>}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block"><span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700"><CalendarDays className="size-4 text-slate-400" />Fecha efectiva</span><input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputClassName} /></label>
        <label className="block"><span className="mb-2 text-sm font-bold text-slate-700">Motivo del cambio</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} placeholder="Promoción, reorganización, corrección..." className={inputClassName} /></label>
      </div>
      <label className="block"><span className="mb-2 text-sm font-bold text-slate-700">Notas</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} className={`${inputClassName} resize-y`} /></label>
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
      <div className="flex justify-end border-t border-slate-100 pt-5"><button type="submit" disabled={saving || loading} className="inline-flex min-w-48 items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? <><LoaderCircle className="size-4 animate-spin" />Guardando...</> : <><Save className="size-4" />Actualizar jerarquía</>}</button></div>
    </form>
  );
}

const inputClassName = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50";
