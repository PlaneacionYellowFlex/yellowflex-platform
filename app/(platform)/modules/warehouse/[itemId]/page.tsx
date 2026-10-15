"use client";

import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  FileText,
  Loader2,
  MapPin,
  PackageCheck,
  UserRound,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Location = {
  id: string;
  code: string;
  name: string;
  warehouseName: string;
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

type Movement = {
  id: string;
  folio: string;
  type: string;
  quantity: number;
  unit: string;
  originLocation: Location | null;
  destinationLocation: Location | null;
  referenceType: string | null;
  referenceNumber: string | null;
  notes: string | null;
  occurredAt: string;
  actor: { id: string; name: string; email: string } | null;
};

type Detail = {
  item: {
    id: string;
    code: string;
    description: string;
    baseUnit: string;
    active: boolean;
  };
  summary: {
    controlledQuantity: number;
    operationalCustodyQuantity: number;
    yellowflexQuantity: number;
    locationCount: number;
    movementCount: number;
    custodyCount: number;
  };
  balances: Balance[];
  movements: Movement[];
  custodies: Array<{
    id: string;
    folio: string;
    quantity: number;
    unit: string;
    status: string;
    custodianArea: { id: string; code: string; name: string };
    nextActionArea: { id: string; code: string; name: string } | null;
    reason: string | null;
    referenceType: string | null;
    referenceNumber: string | null;
    notes: string | null;
    enteredAt: string;
    createdBy: { id: string; name: string; email: string };
  }>;
};

const qty = (value: number) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(value);

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const movementLabels: Record<string, string> = {
  INITIAL_BALANCE: "Saldo inicial",
  EXTERNAL_RECEIPT: "Entrada externa",
  EXTERNAL_ISSUE: "Salida externa",
  INTERNAL_TRANSFER: "Transferencia interna",
  OPERATIONAL_HANDOFF: "Entrega operativa",
  OPERATIONAL_RETURN: "Devolución operativa",
  ADJUSTMENT_IN: "Ajuste de entrada",
  ADJUSTMENT_OUT: "Ajuste de salida",
};

export default function WarehouseItemPage() {
  const params = useParams<{ itemId: string }>();
  const itemId = params.itemId;

  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/warehouse/inventory/${itemId}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error || "No fue posible consultar el expediente del artículo.",
          );
        }

        if (mounted) setData(body);
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No fue posible cargar el expediente.",
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
  }, [itemId]);

  if (loading) {
    return (
      <main className="flex min-h-[55vh] items-center justify-center text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Cargando expediente…
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Link
          href="/modules/warehouse"
          className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Almacén
        </Link>
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          {error || "No fue posible cargar el expediente."}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
      <Link
        href="/modules/warehouse"
        className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a inventario
      </Link>

      <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-6 sm:px-8">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">
            <Warehouse className="h-4 w-4" />
            Expediente de artículo
          </div>

          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-blue-950">
                  {data.item.code}
                </h1>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                  {data.item.active ? "Activo" : "Inactivo"}
                </span>
              </div>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                {data.item.description}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/modules/warehouse/handoffs/new?itemId=${data.item.id}`}
                className="inline-flex items-center justify-center rounded-xl bg-blue-950 px-4 py-3 text-sm font-bold text-white"
              >
                Entregar a Producción
              </Link>
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-5 py-4 text-right">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-700">
                  Total YellowFlex
                </p>
                <p className="mt-1 text-3xl font-bold text-blue-950">
                  {qty(data.summary.yellowflexQuantity)}
                </p>
                <p className="text-xs font-bold uppercase text-slate-500">
                  {data.item.baseUnit}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            icon={<Boxes className="h-4 w-4" />}
            label="Existencia controlada"
            value={`${qty(data.summary.controlledQuantity)} ${data.item.baseUnit}`}
          />
          <Metric
            icon={<PackageCheck className="h-4 w-4" />}
            label="Custodia operativa"
            value={`${qty(data.summary.operationalCustodyQuantity)} ${data.item.baseUnit}`}
          />
          <Metric
            icon={<MapPin className="h-4 w-4" />}
            label="Ubicaciones con existencia"
            value={qty(data.summary.locationCount)}
          />
          <Metric
            icon={<FileText className="h-4 w-4" />}
            label="Movimientos consultados"
            value={qty(data.summary.movementCount)}
          />
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-blue-950">Distribución física</h2>
          <p className="mt-1 text-xs text-slate-500">
            Existencia actual reconstruida por ubicación controlada.
          </p>
        </div>

        {data.balances.filter((balance) => balance.quantity !== 0).length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">
            Este artículo no tiene existencia en ubicaciones controladas.
          </div>
        ) : (
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
            {data.balances
              .filter((balance) => balance.quantity !== 0)
              .map((balance) => (
                <div
                  key={balance.locationId}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-amber-700" />
                        <p className="font-bold text-blue-950">
                          {balance.locationCode}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {balance.warehouseName}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-blue-950">
                        {qty(balance.quantity)}
                      </p>
                      <p className="text-[10px] font-bold uppercase text-slate-500">
                        {balance.baseUnit}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>


      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-blue-950">Custodia operativa</h2>
          <p className="mt-1 text-xs text-slate-500">
            Material fuera de ubicación controlada que continúa dentro de YellowFlex.
          </p>
        </div>

        {data.custodies.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">
            Este artículo no tiene custodias operativas activas.
          </div>
        ) : (
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
            {data.custodies.map((custody) => (
              <div
                key={custody.id}
                className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">
                      {custody.folio}
                    </p>
                    <p className="mt-1 font-bold text-blue-950">
                      {custody.custodianArea.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Estado: {custody.status === "IN_TRANSIT" ? "EN TRÁNSITO" : custody.status === "AVAILABLE" ? "RECIBIDO / DISPONIBLE" : custody.status}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-blue-950">
                      {qty(custody.quantity)}
                    </p>
                    <p className="text-[10px] font-bold uppercase text-slate-500">
                      {custody.unit}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Desde {dateTime(custody.enteredAt)}
                </p>
                {(custody.referenceType || custody.referenceNumber) && (
                  <p className="mt-1 text-xs text-slate-500">
                    Referencia: {[custody.referenceType, custody.referenceNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-blue-950">
            Historial de movimientos
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Trazabilidad cronológica del libro mayor. Esta pantalla es de consulta;
            no modifica existencias.
          </p>
        </div>

        {data.movements.length === 0 ? (
          <div className="px-6 py-10 text-sm text-slate-500">
            No existen movimientos registrados para este artículo.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.movements.map((movement) => (
              <article key={movement.id} className="px-5 py-5">
                <div className="grid gap-4 lg:grid-cols-[170px_150px_1fr_180px] lg:items-start">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Folio
                    </p>
                    <p className="mt-1 text-sm font-bold text-blue-950">
                      {movement.folio}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {dateTime(movement.occurredAt)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Movimiento
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">
                      {movementLabels[movement.type] ?? movement.type}
                    </p>
                    <p className="mt-1 text-lg font-bold text-blue-950">
                      {qty(movement.quantity)}{" "}
                      <span className="text-xs uppercase text-slate-500">
                        {movement.unit}
                      </span>
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Flujo
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <LocationChip
                        location={movement.originLocation}
                        emptyLabel={movement.type === "OPERATIONAL_RETURN" ? "PRODUCCIÓN" : "Origen externo"}
                      />
                      <ArrowRight className="h-4 w-4 text-slate-300" />
                      <LocationChip
                        location={movement.destinationLocation}
                        emptyLabel={movement.type === "OPERATIONAL_HANDOFF" ? "PRODUCCIÓN" : "Destino externo"}
                      />
                    </div>

                    {(movement.referenceType ||
                      movement.referenceNumber ||
                      movement.notes) && (
                      <div className="mt-3 text-xs text-slate-500">
                        {(movement.referenceType ||
                          movement.referenceNumber) && (
                          <p>
                            Referencia:{" "}
                            {[movement.referenceType, movement.referenceNumber]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {movement.notes && (
                          <p className="mt-1">{movement.notes}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Registrado por
                    </p>
                    <div className="mt-2 flex items-start gap-2">
                      <UserRound className="mt-0.5 h-4 w-4 text-slate-400" />
                      <div>
                        <p className="text-sm font-semibold text-slate-700">
                          {movement.actor?.name || "Sistema"}
                        </p>
                        {movement.actor?.email && (
                          <p className="mt-0.5 break-all text-xs text-slate-500">
                            {movement.actor.email}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-3">
          <PackageCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Total YellowFlex = existencia en ubicaciones controladas + custodia
            operativa activa fuera de ubicación controlada. Una entrega a
            Producción reduce el saldo del Layout, pero no elimina el material
            del inventario de YellowFlex.
          </p>
        </div>
      </div>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white px-6 py-5">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <p className="text-[10px] font-black uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-2 text-xl font-bold text-blue-950">{value}</p>
    </div>
  );
}

function LocationChip({
  location,
  emptyLabel,
}: {
  location: Location | null;
  emptyLabel: string;
}) {
  if (!location) {
    return (
      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500">
        {emptyLabel}
      </span>
    );
  }

  return (
    <span className="rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-900">
      {location.code}
    </span>
  );
}
