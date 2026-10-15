"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PackagePlus,
  Search,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  code: string;
  description: string;
  baseUnit: string;
};

type Location = {
  id: string;
  code: string;
  name: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
};

type Catalog = {
  items: Item[];
  locations: Location[];
};

type CreatedMovement = {
  id: string;
  folio: string;
  itemId: string;
  itemCode: string;
  quantity: number;
  unit: string;
  destinationLocation: {
    id: string;
    code: string;
    warehouseName: string;
  } | null;
  occurredAt: string;
};

const qty = (value: number) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(value);

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export default function NewWarehouseReceiptPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedMovement | null>(null);

  const [itemQuery, setItemQuery] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [referenceType, setReferenceType] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const response = await fetch("/api/warehouse/movements", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error || "No fue posible cargar los catálogos de Almacén.",
          );
        }

        if (mounted) setCatalog(body);
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No fue posible cargar la recepción.",
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

  const selectedItem = catalog?.items.find((item) => item.id === itemId) ?? null;

  const visibleItems = useMemo(() => {
    if (!catalog) return [];
    const query = normalize(itemQuery.trim());

    if (!query) return catalog.items.slice(0, 12);

    return catalog.items
      .filter((item) =>
        normalize(`${item.code} ${item.description}`).includes(query),
      )
      .slice(0, 12);
  }, [catalog, itemQuery]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    setCreated(null);

    try {
      const response = await fetch("/api/warehouse/movements", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          quantity,
          destinationLocationId,
          referenceType,
          referenceNumber,
          notes,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "No fue posible registrar la entrada.");
      }

      setCreated(body.movement);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No fue posible registrar la entrada.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-[55vh] items-center justify-center text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Preparando recepción…
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
        Volver a inventario
      </Link>

      <header className="rounded-3xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">
          <Warehouse className="h-4 w-4" />
          YellowFlex · Warehouse
        </div>
        <div className="mt-3 flex items-start gap-4">
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-900">
            <PackagePlus className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-950">
              Recepción de material
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Registra una entrada externa hacia una ubicación controlada por
              Almacén. La existencia cambiará únicamente mediante el movimiento
              generado.
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-800">
          {error}
        </div>
      )}

      {created ? (
        <section className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="mt-1 h-8 w-8 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                Entrada registrada
              </p>
              <h2 className="mt-2 text-2xl font-bold text-blue-950">
                {created.folio}
              </h2>
              <p className="mt-3 text-sm text-slate-600">
                {created.itemCode} · {qty(created.quantity)} {created.unit} →{" "}
                {created.destinationLocation?.code}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={`/modules/warehouse/${created.itemId}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-900"
                >
                  Ver expediente actualizado
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setCreated(null);
                    setItemId("");
                    setItemQuery("");
                    setQuantity("");
                    setDestinationLocationId("");
                    setReferenceType("");
                    setReferenceNumber("");
                    setNotes("");
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-blue-950 hover:bg-slate-50"
                >
                  Registrar otra entrada
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-semibold text-blue-950">1. Artículo</h2>
            <p className="mt-1 text-xs text-slate-500">
              Busca por código o descripción.
            </p>

            {selectedItem ? (
              <div className="mt-4 flex flex-col justify-between gap-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-bold text-blue-950">{selectedItem.code}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedItem.description}
                  </p>
                  <p className="mt-1 text-xs font-bold uppercase text-slate-500">
                    Unidad base: {selectedItem.baseUnit}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setItemId("")}
                  className="text-sm font-bold text-blue-800"
                >
                  Cambiar artículo
                </button>
              </div>
            ) : (
              <>
                <label className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 focus-within:border-blue-800 focus-within:bg-white">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    value={itemQuery}
                    onChange={(event) => setItemQuery(event.target.value)}
                    placeholder="Ej. 33-012-056 o TORNILLO…"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </label>

                <div className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {visibleItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setItemId(item.id);
                        setItemQuery(`${item.code} · ${item.description}`);
                      }}
                      className="flex w-full items-center justify-between gap-4 bg-white px-4 py-3 text-left hover:bg-blue-50"
                    >
                      <div>
                        <p className="text-sm font-bold text-blue-950">
                          {item.code}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {item.description}
                        </p>
                      </div>
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        {item.baseUnit}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:grid-cols-2">
            <div>
              <h2 className="font-semibold text-blue-950">
                2. Cantidad recibida
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Se registrará en la unidad base del artículo.
              </p>
              <div className="mt-4 flex items-center rounded-xl border border-slate-200 bg-slate-50 focus-within:border-blue-800 focus-within:bg-white">
                <input
                  required
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="0"
                  className="min-w-0 flex-1 bg-transparent px-4 py-3 text-lg font-bold outline-none"
                />
                <span className="px-4 text-xs font-black uppercase text-slate-500">
                  {selectedItem?.baseUnit || "Unidad"}
                </span>
              </div>
            </div>

            <div>
              <h2 className="font-semibold text-blue-950">
                3. Ubicación destino
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Ubicación física donde se recibe el material.
              </p>
              <select
                required
                value={destinationLocationId}
                onChange={(event) =>
                  setDestinationLocationId(event.target.value)
                }
                className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-800 focus:bg-white"
              >
                <option value="">Selecciona una ubicación…</option>
                {catalog?.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} · {location.warehouseName}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-semibold text-blue-950">
              4. Documento y evidencia operativa
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Identifica el documento que respalda la recepción.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Tipo de referencia
                </span>
                <input
                  value={referenceType}
                  onChange={(event) => setReferenceType(event.target.value)}
                  placeholder="Ej. OC, REMISIÓN, FACTURA"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-800 focus:bg-white"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Número de referencia
                </span>
                <input
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                  placeholder="Ej. OC-4587"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-800 focus:bg-white"
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Observaciones
              </span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                placeholder="Condición de recepción, proveedor, empaque, aclaraciones…"
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-800 focus:bg-white"
              />
            </label>
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={
                saving ||
                !itemId ||
                !destinationLocationId ||
                !(Number(quantity) > 0)
              }
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-950 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackagePlus className="h-4 w-4" />
              )}
              {saving ? "Registrando…" : "Confirmar entrada"}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
