"use client";

import {
  ArrowRightLeft,
  Boxes,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Loader2,
  MapPin,
  PackageCheck,
  PackagePlus,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  locationCount: number;
};

type Balance = {
  itemId: string;
  itemCode: string;
  itemDescription: string;
  baseUnit: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  quantity: number;
};

type Data = {
  summary: {
    itemCount: number;
    locationCount: number;
    occupiedLocationCount: number;
    emptyLocationCount: number;
    balanceCount: number;
  };
  inventory: Item[];
  balances: Balance[];
};

const qty = (value: number) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(value);

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export default function WarehousePage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/warehouse/inventory", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error || "No fue posible consultar el inventario de Almacén.",
        );
      }

      setData(body);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible cargar Almacén.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!data) return [];

    const normalizedQuery = normalize(query);

    if (!normalizedQuery) return data.inventory;

    return data.inventory.filter((item) =>
      normalize(`${item.code} ${item.description} ${item.unit}`).includes(
        normalizedQuery,
      ),
    );
  }, [data, query]);

  if (loading) {
    return (
      <main className="flex min-h-[55vh] items-center justify-center text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Cargando Almacén…
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-6 sm:px-8">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">
            <Warehouse className="h-4 w-4" />
            YellowFlex · Warehouse
          </div>

          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-blue-950">
                Centro de Operaciones de Almacén
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Inventario, movimientos y custodia operativa desde un solo punto.
                La existencia continúa reconstruyéndose desde el libro mayor de movimientos.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-950 hover:bg-slate-50"
              >
                <RefreshCw className="h-4 w-4" />
                Actualizar
              </button>

            </div>
          </div>
        </div>

        {data && (
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Códigos activos"
              value={data.summary.itemCount}
              icon={<Boxes className="h-4 w-4" />}
            />
            <Metric
              label="Ubicaciones"
              value={data.summary.locationCount}
              icon={<MapPin className="h-4 w-4" />}
            />
            <Metric
              label="Ubicaciones ocupadas"
              value={data.summary.occupiedLocationCount}
            />
            <Metric
              label="Ubicaciones libres"
              value={data.summary.emptyLocationCount}
            />
          </div>
        )}
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            Operación
          </p>
          <h2 className="mt-1 text-xl font-bold text-blue-950">
            Accesos de Almacén
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Las funciones activas abren directamente su flujo operativo. Las siguientes fases ya tienen reservado su lugar.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OperationCard
            href="/modules/warehouse/receipts/new"
            icon={<PackagePlus className="h-5 w-5" />}
            title="Nueva entrada"
            description="Recibir material desde una fuente externa."
          />
          <OperationCard
            href="/modules/warehouse/transfers/new"
            icon={<ArrowRightLeft className="h-5 w-5" />}
            title="Transferencia interna"
            description="Mover existencia entre ubicaciones controladas."
          />
          <OperationCard
            href="/modules/warehouse/handoffs/new"
            icon={<Send className="h-5 w-5" />}
            title="Entregar a Producción"
            description="Liberar del Layout y abrir custodia operativa."
          />
          <OperationCard
            href="/modules/warehouse/production/receipts"
            icon={<PackageCheck className="h-5 w-5" />}
            title="Recepciones pendientes"
            description="Confirmar material entregado a Producción."
          />

          <OperationCard
            href="/modules/warehouse/returns"
            icon={<RotateCcw className="h-5 w-5" />}
            title="Devoluciones"
            description="Recibir sobrantes y devolverlos al Layout."
          />
          <OperationCard
            href="/modules/warehouse/counts"
            icon={<ClipboardCheck className="h-5 w-5" />}
            title="Conteos"
            description="Conteos cíclicos, sorpresa y diferencias."
          />
          <OperationCard
            href="/modules/warehouse/discrepancies"
            icon={<ClipboardList className="h-5 w-5" />}
            title="Investigación de Diferencias"
            description="Investigar diferencias de conteo, documentar causas y registrar resoluciones."
          />
          <OperationCard
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Conciliación SAP"
            description="Comparar existencia física contra snapshots corporativos."
            pending
          />
          <OperationCard
            href="/modules/warehouse/production/material"
            icon={<ClipboardList className="h-5 w-5" />}
            title="Custodias"
            description="Consumir material o devolver sobrantes desde Producción."
          />
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {data && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <h2 className="font-semibold text-blue-950">
                  Existencia por artículo
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {visible.length} de {data.inventory.length} códigos visibles.
                </p>
              </div>

              <label className="flex w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 focus-within:border-blue-800 focus-within:bg-white">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar código o descripción…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <PackageSearch className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                No encontramos artículos con ese criterio.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visible.map((item) => (
                <Link
                  key={item.id}
                  href={`/modules/warehouse/${item.id}`}
                  className="grid gap-3 px-5 py-4 transition hover:bg-blue-50/50 md:grid-cols-[150px_1fr_150px_130px_24px] md:items-center"
                >
                  <span className="font-bold text-blue-950">{item.code}</span>

                  <span>
                    <span className="block text-sm font-medium">
                      {item.description}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500 md:hidden">
                      {item.locationCount} ubicaciones
                    </span>
                  </span>

                  <span className="hidden text-sm text-slate-500 md:block">
                    {item.locationCount}{" "}
                    {item.locationCount === 1 ? "ubicación" : "ubicaciones"}
                  </span>

                  <span className="text-right">
                    <span className="block text-base font-bold text-blue-950">
                      {qty(item.quantity)}
                    </span>
                    <span className="block text-[11px] font-semibold uppercase text-slate-500">
                      {item.unit}
                    </span>
                  </span>

                  <ChevronRight className="hidden h-4 w-4 text-slate-400 md:block" />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}


function OperationCard({
  href,
  icon,
  title,
  description,
  pending = false,
}: {
  href?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  pending?: boolean;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-950">
          {icon}
        </div>
        {pending ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
            Próxima fase
          </span>
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </div>
      <h3 className="mt-4 font-bold text-blue-950">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </>
  );

  if (!pending && href) {
    return (
      <Link
        href={href}
        className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-sm"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
      {content}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white px-6 py-5">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <p className="text-xs font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-blue-950">{qty(value)}</p>
    </div>
  );
}
