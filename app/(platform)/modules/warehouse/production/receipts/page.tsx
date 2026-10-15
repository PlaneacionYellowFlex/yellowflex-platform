"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Custody = {
  id: string;
  folio: string;
  quantity: number;
  unit: string;
  status: string;
  enteredAt: string;
  referenceType: string | null;
  referenceNumber: string | null;
  notes: string | null;
  item: {
    id: string;
    code: string;
    description: string;
    baseUnit: string;
  };
  custodianArea: {
    id: string;
    code: string;
    name: string;
  };
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
};

const qty = (value: number) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(value);

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export default function ProductionReceiptsPage() {
  const [custodies, setCustodies] = useState<Custody[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Custody | null>(null);
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    setError("");

    try {
      const response = await fetch("/api/warehouse/production/receipts", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "No fue posible consultar las entregas.");
      }

      setCustodies(body.custodies);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible consultar las entregas.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openReceipt(custody: Custody) {
    setSelected(custody);
    setReceivedQuantity(String(custody.quantity));
    setNotes("");
    setError("");
    setSuccess("");
  }

  async function receive(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/warehouse/custodies/${selected.id}/receive`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receivedQuantity: Number(receivedQuantity),
            notes,
          }),
        },
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "No fue posible confirmar la recepción.");
      }

      setSuccess(
        `${body.custody.folio} recibido correctamente por Producción.`,
      );
      setSelected(null);
      setReceivedQuantity("");
      setNotes("");
      await load(true);
    } catch (receiveError) {
      setError(
        receiveError instanceof Error
          ? receiveError.message
          : "No fue posible confirmar la recepción.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <Link
        href="/modules/warehouse"
        className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a Almacén
      </Link>

      <header className="rounded-3xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">
          <PackageCheck className="h-4 w-4" />
          Producción · Recepción
        </div>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-950">
              Material pendiente de recibir
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Producción confirma físicamente el material entregado por Almacén.
              La custodia permanece dentro de YellowFlex.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-blue-950"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
          <CheckCircle2 className="h-5 w-5" />
          {success}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-600">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Consultando entregas…
        </div>
      ) : custodies.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
          <h2 className="mt-3 font-bold text-blue-950">
            Producción no tiene entregas pendientes
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Todas las custodias en tránsito han sido atendidas.
          </p>
        </div>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {custodies.map((custody) => (
            <article
              key={custody.id}
              className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">
                    {custody.folio}
                  </p>
                  <h2 className="mt-2 text-lg font-bold text-blue-950">
                    {custody.item.code}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {custody.item.description}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-blue-950">
                    {qty(custody.quantity)}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-slate-500">
                    {custody.unit}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                <p className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4" />
                  En tránsito desde {dateTime(custody.enteredAt)}
                </p>
                {(custody.referenceType || custody.referenceNumber) && (
                  <p>
                    Referencia:{" "}
                    {[custody.referenceType, custody.referenceNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <p>Entregado por: {custody.createdBy.name}</p>
              </div>

              <button
                type="button"
                onClick={() => openReceipt(custody)}
                className="mt-5 w-full rounded-xl bg-blue-950 px-4 py-3 text-sm font-bold text-white"
              >
                Confirmar recepción
              </button>
            </article>
          ))}
        </section>
      )}

      {selected && (
        <section className="rounded-3xl border border-blue-200 bg-blue-50/40 p-6 shadow-sm">
          <h2 className="text-xl font-bold text-blue-950">
            Confirmar recepción · {selected.item.code}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Almacén declaró una entrega de{" "}
            <strong>
              {qty(selected.quantity)} {selected.unit}
            </strong>
            .
          </p>

          <form onSubmit={receive} className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-500">
                Cantidad físicamente recibida
              </label>
              <input
                type="number"
                min="0"
                step="0.001"
                required
                value={receivedQuantity}
                onChange={(event) => setReceivedQuantity(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-800"
              />
            </div>

            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-500">
                Observaciones de recepción
              </label>
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Opcional"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-800"
              />
            </div>

            <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              Si la cantidad física no coincide con lo declarado por Almacén,
              Platform no cerrará la recepción. La diferencia deberá
              investigarse; ninguna pieza se ajustará automáticamente.
            </div>

            <div className="sm:col-span-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Recibir material
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
