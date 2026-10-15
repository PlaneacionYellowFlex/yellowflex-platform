"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  PackageSearch,
  Send,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  code: string;
  description: string;
  baseUnit: string;
};

type Balance = {
  itemId: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  warehouseName: string;
  quantity: number;
  unit: string;
};

type HandoffResult = {
  movement: { id: string; folio: string };
  custody: {
    id: string;
    folio: string;
    status: string;
    custodianArea: string;
  };
  item: Item;
  origin: { id: string; code: string; warehouseName: string };
  quantity: number;
  availableBefore: number;
  availableAfter: number;
};

const qty = (value: number) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(value);

export default function WarehouseHandoffPage() {
  const searchParams = useSearchParams();
  const initialItemId = searchParams.get("itemId") ?? "";

  const [items, setItems] = useState<Item[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [itemId, setItemId] = useState(initialItemId);
  const [originLocationId, setOriginLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [referenceType, setReferenceType] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<HandoffResult | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const response = await fetch("/api/warehouse/movements/handoffs", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "No fue posible preparar la entrega.");
        }

        if (mounted) {
          setItems(body.items);
          setBalances(body.balances);
        }
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No fue posible preparar la entrega.",
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedItem = items.find((item) => item.id === itemId) ?? null;

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items.slice(0, 30);
    return items
      .filter(
        (item) =>
          item.code.toLowerCase().includes(term) ||
          item.description.toLowerCase().includes(term),
      )
      .slice(0, 30);
  }, [items, search]);

  const itemBalances = balances.filter(
    (balance) => balance.itemId === itemId && balance.quantity > 0,
  );

  const selectedBalance =
    itemBalances.find(
      (balance) => balance.locationId === originLocationId,
    ) ?? null;

  function selectItem(id: string) {
    setItemId(id);
    setOriginLocationId("");
    setQuantity("");
    setResult(null);
    const item = items.find((candidate) => candidate.id === id);
    if (item) setSearch(`${item.code} · ${item.description}`);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/warehouse/movements/handoffs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          originLocationId,
          quantity: Number(quantity),
          referenceType,
          referenceNumber,
          notes,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "No fue posible registrar la entrega.");
      }

      setResult(body);
      setBalances((current) =>
        current
          .map((balance) =>
            balance.itemId === itemId &&
            balance.locationId === originLocationId
              ? { ...balance, quantity: body.availableAfter }
              : balance,
          )
          .filter((balance) => balance.quantity > 0),
      );
      setQuantity("");
      setNotes("");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No fue posible registrar la entrega.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-[55vh] items-center justify-center text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Preparando entrega…
      </main>
    );
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
          <Warehouse className="h-4 w-4" />
          Custodia operativa
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-blue-950">
          Entrega de material a Producción
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          El material saldrá de una ubicación controlada de Almacén, pero no
          saldrá de YellowFlex. Se abrirá una custodia operativa para Producción.
        </p>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      {result && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <h2 className="font-bold text-emerald-950">
                Entrega registrada correctamente
              </h2>
              <p className="mt-1 text-sm text-emerald-900">
                {qty(result.quantity)} {result.item.baseUnit} salieron de{" "}
                <strong>{result.origin.code}</strong> y quedaron bajo custodia
                operativa de <strong>{result.custody.custodianArea}</strong>.
              </p>
              <div className="mt-3 grid gap-2 text-xs text-emerald-900 sm:grid-cols-2">
                <p>Movimiento: <strong>{result.movement.folio}</strong></p>
                <p>Custodia: <strong>{result.custody.folio}</strong></p>
                <p>Antes en ubicación: <strong>{qty(result.availableBefore)}</strong></p>
                <p>Después en ubicación: <strong>{qty(result.availableAfter)}</strong></p>
              </div>
              <Link
                href={`/modules/warehouse/${result.item.id}`}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-950 px-4 py-2.5 text-sm font-bold text-white"
              >
                Ver expediente actualizado
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      <form
        onSubmit={submit}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Artículo
            </label>
            <div className="relative mt-2">
              <PackageSearch className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (itemId) {
                    setItemId("");
                    setOriginLocationId("");
                  }
                }}
                placeholder="Buscar por código o descripción…"
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm outline-none focus:border-blue-800"
              />
            </div>

            {!selectedItem && (
              <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-slate-200">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectItem(item.id)}
                    className="block w-full border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-blue-50"
                  >
                    <span className="font-bold text-blue-950">{item.code}</span>
                    <span className="ml-2 text-sm text-slate-600">
                      {item.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Ubicación de origen
            </label>
            <select
              value={originLocationId}
              onChange={(event) => setOriginLocationId(event.target.value)}
              disabled={!selectedItem}
              required
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-800 disabled:bg-slate-100"
            >
              <option value="">Seleccionar ubicación</option>
              {itemBalances.map((balance) => (
                <option key={balance.locationId} value={balance.locationId}>
                  {balance.locationCode} · {qty(balance.quantity)} {balance.unit}
                </option>
              ))}
            </select>
            {selectedBalance && (
              <p className="mt-2 text-xs text-slate-500">
                Disponible:{" "}
                <strong className="text-blue-950">
                  {qty(selectedBalance.quantity)} {selectedBalance.unit}
                </strong>
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Cantidad entregada
            </label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
              disabled={!selectedBalance}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-800 disabled:bg-slate-100"
            />
            <p className="mt-2 text-xs text-slate-500">
              Unidad: <strong>{selectedItem?.baseUnit ?? "—"}</strong>
            </p>
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Tipo de referencia
            </label>
            <input
              value={referenceType}
              onChange={(event) => setReferenceType(event.target.value)}
              placeholder="Ej. Orden de producción"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-800"
            />
          </div>

          <div>
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Número de referencia
            </label>
            <input
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
              placeholder="Ej. OP-000123"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-800"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="text-xs font-black uppercase tracking-wider text-slate-500">
              Observaciones
            </label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Información útil de la entrega…"
              className="mt-2 w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-800"
            />
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-5 text-slate-500">
            Esta operación no es una salida externa. El material continúa
            formando parte del inventario de YellowFlex y queda trazado mediante
            una custodia operativa.
          </p>
          <button
            type="submit"
            disabled={
              saving ||
              !itemId ||
              !originLocationId ||
              !quantity ||
              Number(quantity) <= 0
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-950 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Confirmar entrega
          </button>
        </div>
      </form>
    </main>
  );
}
