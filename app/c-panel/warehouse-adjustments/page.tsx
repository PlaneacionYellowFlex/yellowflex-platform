"use client";

import { useCallback, useEffect, useState } from "react";

type AuditEntry = { id: string; actor: string; target: string; action: string; reason: string; createdAt: string };

type UserPermission = {
  id: string;
  name: string;
  email: string;
  canApproveWarehouseAdjustments: boolean;
};

export default function WarehouseAdjustmentPermissionsPage() {
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<UserPermission | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/warehouse/adjustment-permissions", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No fue posible consultar los permisos.");
      setUsers(data.users);
      setAudit(data.audit ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de consulta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = users.filter(user =>
    (user.name + " " + user.email).toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );

  async function save() {
    if (!pending || busyId || reason.trim().length < 10) return;
    setBusyId(pending.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/warehouse/adjustment-permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: pending.id,
          canApproveWarehouseAdjustments: !pending.canApproveWarehouseAdjustments,
          reason: reason.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No fue posible actualizar el permiso.");
      setNotice(data.changed ? "Permiso actualizado y registrado en la bitácora." : "El permiso ya tenía ese valor.");
      setPending(null);
      setReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error al guardar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-white px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 border-b border-amber-300 pb-5">
          <p className="text-sm font-semibold uppercase tracking-widest text-amber-700">YellowFlex · C-PANEL</p>
          <h1 className="mt-2 text-3xl font-bold text-blue-950">Autorizaciones de ajustes de inventario</h1>
          <p className="mt-2 text-slate-600">Otorga o retira el permiso de aprobar ajustes. Cada cambio requiere un motivo y queda registrado.</p>
        </div>

        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
        {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">{notice}</p>}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label htmlFor="search" className="font-medium">Buscar usuario</label>
          <input id="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Nombre o correo" className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:outline-2 focus:outline-blue-600" />
          <button type="button" onClick={() => void load()} disabled={loading || busyId !== null}
            className="cursor-pointer rounded-lg border border-blue-900 px-4 py-2 text-blue-950 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">
            Actualizar
          </button>
        </div>

        {loading ? <p role="status">Consultando autorizaciones…</p> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-blue-950 text-white"><tr><th className="p-4">Colaborador</th><th className="p-4">Estado</th><th className="p-4">Acción</th></tr></thead>
              <tbody>
                {filtered.map(user => (
                  <tr key={user.id} className="border-t border-slate-200">
                    <td className="p-4"><span className="font-semibold">{user.name}</span><span className="block text-slate-500">{user.email}</span></td>
                    <td className="p-4">{user.canApproveWarehouseAdjustments ? "Autorizado" : "Sin autorización"}</td>
                    <td className="p-4">
                      <button type="button" disabled={busyId !== null} onClick={() => { setPending(user); setReason(""); setNotice(""); }}
                        className="cursor-pointer rounded-lg bg-blue-950 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                        {user.canApproveWarehouseAdjustments ? "Revocar acceso" : "Conceder acceso"}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={3} className="p-5 text-center text-slate-500">No hay usuarios que coincidan.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <section className="mt-10" aria-labelledby="audit-title">
          <h2 id="audit-title" className="text-xl font-bold text-blue-950">Historial de autorizaciones</h2>
          <p className="mt-1 text-sm text-slate-600">Últimos 50 cambios registrados.</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="bg-blue-950 text-white"><tr><th className="p-3">Fecha</th><th className="p-3">Responsable</th><th className="p-3">Colaborador</th><th className="p-3">Acción</th><th className="p-3">Motivo</th></tr></thead>
              <tbody>{audit.map(entry => <tr key={entry.id} className="border-t border-slate-200"><td className="p-3">{new Date(entry.createdAt).toLocaleString("es-MX")}</td><td className="p-3">{entry.actor}</td><td className="p-3">{entry.target}</td><td className="p-3">{entry.action === "GRANT_ADJUSTMENT_APPROVAL" ? "Concedido" : "Revocado"}</td><td className="p-3">{entry.reason}</td></tr>)}
                {audit.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-500">Sin cambios registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {pending && (
          <div role="dialog" aria-modal="true" aria-labelledby="confirmation-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
              <h2 id="confirmation-title" className="text-xl font-bold text-blue-950">
                {pending.canApproveWarehouseAdjustments ? "Revocar autorización" : "Conceder autorización"}
              </h2>
              <p className="mt-3 text-slate-700">Usuario: <strong>{pending.name}</strong></p>
              <p className="mt-2 text-sm text-slate-600">Esta acción cambia la facultad de aprobar ajustes de inventario y quedará auditada.</p>
              <label htmlFor="reason" className="mt-5 block font-medium">Motivo del cambio (mínimo 10 caracteres)</label>
              <textarea id="reason" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-300 p-3 focus:outline-2 focus:outline-blue-600" />
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" disabled={busyId !== null} onClick={() => setPending(null)}
                  className="cursor-pointer rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
                <button type="button" disabled={busyId !== null || reason.trim().length < 10} onClick={() => void save()}
                  className="cursor-pointer rounded-lg bg-blue-950 px-4 py-2 text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {busyId ? "Guardando…" : "Confirmar cambio"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
