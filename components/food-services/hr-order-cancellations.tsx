"use client";

import { useCallback, useEffect, useState } from "react";

type Order = {
  id: string; status: string; itemCount: number; payrollStatus: string;
  employee: { fullName: string; employeeNumber: string }; menuWeek: { weekStart: string };
  cancellation: { reason: string; createdAt: string; previousStatus: string; newStatus: string; actor: { name: string } } | null;
};

export default function HrOrderCancellations() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [canCancel, setCanCancel] = useState(false);
  const [selected, setSelected] = useState<Order>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/food-services/hr/orders", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible consultar pedidos");
    setOrders(data.orders); setCanCancel(data.canCancel);
  }, []);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);

  async function cancel() {
    if (!selected || reason.trim().length < 5 || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/food-services/hr/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: selected.id, reason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No fue posible cancelar");
      setSelected(undefined); setReason(""); setSuccess("Pedido cancelado. Sus reservas se excluyen de demanda y de nómina.");
      await load();
      // Refresh the financial dashboard so it cannot retain cancelled charges on screen.
      window.dispatchEvent(new Event("food-orders-changed"));
    } catch (e) { setError(e instanceof Error ? e.message : "No fue posible cancelar"); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
    <h2 className="text-xl font-black text-[#0B3A82]">Cancelación excepcional de pedidos</h2>
    <p className="mt-2 text-sm text-slate-600">Últimos 100 pedidos. Solo RH con autorización específica puede cancelar. Los cargos exportados, procesados o sin verificar requieren conciliación y ajuste controlado.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="mt-3 text-sm text-green-800">{success}</p>}
    <ul className="mt-4 divide-y divide-slate-100">{orders.map(order => <li key={order.id} className="py-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><p className="font-bold text-slate-900">{order.employee.fullName}</p>
          <p className="text-sm text-slate-600">{order.employee.employeeNumber} · Semana del {new Date(order.menuWeek.weekStart).toLocaleDateString("es-MX", { timeZone: "UTC" })} · {order.itemCount} servicios</p>
          <p className="mt-1 text-sm font-semibold text-[#0B3A82]">{order.status === "CANCELLED" ? "Cancelado" : "Confirmado"}</p>
          {order.status === "CONFIRMED" && order.payrollStatus !== "PENDING" && <p className="text-xs text-amber-800">Cancelación simple bloqueada: {order.payrollStatus === "UNVERIFIED" ? "situación de nómina sin verificar" : "cargo exportado o procesado"}.</p>}
        </div>
        {canCancel && order.status === "CONFIRMED" && order.payrollStatus === "PENDING" && <button type="button" disabled={busy} onClick={() => { setSelected(order); setReason(""); setError(""); setSuccess(""); }} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-[#0B3A82]">Cancelar pedido</button>}
      </div>
      {order.cancellation && <p className="mt-2 text-sm text-slate-600">Confirmado → Cancelado · {order.cancellation.actor.name} · {new Date(order.cancellation.createdAt).toLocaleString("es-MX")} · Motivo: {order.cancellation.reason}</p>}
    </li>)}</ul>
    {selected && <div role="dialog" aria-modal="true" aria-labelledby="cancel-food-title" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
      <form onSubmit={e => { e.preventDefault(); void cancel(); }} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="cancel-food-title" className="text-lg font-black text-[#0B3A82]">Confirmar cancelación excepcional</h3>
        <p className="mt-3 text-sm text-slate-700">Se cancelarán el pedido de {selected.employee.fullName} y todas sus reservas. El colaborador no podrá reactivarlo. Esta acción conservará el historial y no ajustará nómina procesada.</p>
        <label className="mt-4 block text-sm font-bold">Motivo obligatorio<textarea autoFocus required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3" /></label>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} onClick={() => setSelected(undefined)} className="rounded-xl border px-4 py-2">Volver</button><button type="submit" disabled={busy || reason.trim().length < 5} className="rounded-xl bg-[#F4B400] px-4 py-2 font-bold text-[#0B3A82] disabled:opacity-50">{busy ? "Cancelando…" : "Confirmar cancelación"}</button></div>
      </form>
    </div>}
  </section>;
}
