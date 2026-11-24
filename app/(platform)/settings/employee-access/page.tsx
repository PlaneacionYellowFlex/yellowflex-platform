"use client";
import { useCallback, useEffect, useState } from "react";

type Employee = { id: string; employeeNumber: string; fullName: string; corporateUserId: string | null;
  department: { name: string }; corporateUser: null | { id: string; active: boolean; email: string | null;
  passwordMustChange: boolean; roles: { role: string }[] } };
export default function EmployeeAccessPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState("");
  const [role, setRole] = useState<"EMPLEADO" | "PRODUCCION">("EMPLEADO");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ employeeNumber: string; password: string } | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/employee-access", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No fue posible consultar colaboradores.");
    setEmployees(data.employees ?? []);
  }, []);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);
  async function execute(action: "create" | "reset", userId?: string) {
    if (busy) return;
    setBusy(true); setError(""); setIssued(null);
    try {
      const response = await fetch("/api/admin/employee-access", { method: action === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "create" ? { employeeId: selected, role } : { userId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No fue posible completar la operación.");
      const employee = employees.find((e) => action === "create" ? e.id === selected : e.corporateUserId === userId);
      setIssued({ employeeNumber: employee?.employeeNumber ?? data.employeeNumber ?? "", password: data.initialPassword });
      setSelected(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setBusy(false); }
  }
  const eligible = employees.filter((e) => !e.corporateUserId);
  const operational = employees.filter((e) => e.corporateUser?.roles.length && e.corporateUser.roles.every((r) => ["EMPLEADO", "PRODUCCION"].includes(r.role)));
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <header className="rounded-3xl border border-slate-200 bg-white p-7"><h1 className="text-2xl font-bold text-[#0b3a82]">Accesos de colaboradores operativos</h1>
      <p className="mt-2 text-sm text-slate-600">RH autorizado crea cuentas vinculadas a la base de personal. Contraseña temporal con cambio obligatorio. Sin correo requerido.</p></header>
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-bold text-[#0b3a82]">Habilitar cuenta</h2>
      <select aria-label="Colaborador" className="w-full rounded-xl border p-3" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy}>
        <option value="">Selecciona un colaborador sin cuenta</option>{eligible.map((e) => <option key={e.id} value={e.id}>{e.employeeNumber} · {e.fullName} · {e.department.name}</option>)}
      </select><select aria-label="Rol operativo" className="w-full rounded-xl border p-3" value={role} onChange={(e) => setRole(e.target.value as "EMPLEADO" | "PRODUCCION")} disabled={busy}>
        <option value="EMPLEADO">Colaborador</option><option value="PRODUCCION">Producción</option></select>
      <button type="button" disabled={!selected || busy} onClick={() => void execute("create")} className="rounded-xl bg-[#0b3a82] px-6 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Procesando…" : "Crear cuenta y contraseña temporal"}</button>
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {issued && <section className="rounded-xl border border-amber-300 bg-amber-50 p-5"><h2 className="font-bold">Credenciales temporales (visibles solo ahora)</h2>
      <p>Número de empleado: <strong>{issued.employeeNumber}</strong></p><p>Contraseña temporal: <code className="break-all font-bold">{issued.password}</code></p>
      <button type="button" className="mt-3 rounded-lg border px-3 py-2" onClick={() => navigator.clipboard.writeText(`Empleado: ${issued.employeeNumber}\nContraseña temporal: ${issued.password}`)}>Copiar credenciales</button>
      <p className="mt-2 text-sm">Entrega la contraseña de forma privada. El colaborador deberá cambiarla al ingresar.</p></section>}
    <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="mb-4 font-bold text-[#0b3a82]">Cuentas operativas existentes</h2>
      <div className="space-y-3">{operational.map((e) => <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
        <div><p className="font-semibold">{e.fullName}</p><p className="text-xs text-slate-500">#{e.employeeNumber} · {e.corporateUser?.passwordMustChange ? "Cambio de contraseña pendiente" : "Contraseña establecida"}</p></div>
        <button type="button" disabled={busy || !e.corporateUser?.active} onClick={() => { if (window.confirm(`¿Restablecer contraseña de ${e.fullName}? Se cerrarán sus sesiones.`)) void execute("reset", e.corporateUserId!); }}
          className="rounded-xl border border-[#0b3a82] px-4 py-2 text-sm font-semibold text-[#0b3a82] disabled:opacity-50">Restablecer contraseña</button></div>)}
      </div></section></main>;
}
