"use client";

import {
  Banknote,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Coffee,
  Download,
  ReceiptText,
  RefreshCw,
  UsersRound,
  Utensils,
  UtensilsCrossed,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type BillingWeek = {
  id: string;
  weekStart: string;
};

type BillingService = {
  reservationId: string;
  menuItemId: string;
  serviceDate: string;
  serviceType: "BREAKFAST" | "LUNCH";
  name: string;
  menuPrice: string;
};

type BillingOrder = {
  id: string;
  week: BillingWeek;
  employee: {
    id: string;
    employeeNumber: string;
    fullName: string;
    position: string | null;
    status: string;
    department: {
      id: string;
      code: string;
      name: string;
    };
    workShift: {
      id: string;
      code: string;
      name: string;
      startTime: string;
      endTime: string;
    } | null;
  };
  itemCount: number;
  unitPrice: string;
  totalAmount: string;
  confirmedAt: string;
  services: BillingService[];
};

type BillingData = {
  totals: {
    orders: number;
    employees: number;
    services: number;
    amount: string;
  };
  weeks: BillingWeek[];
  orders: BillingOrder[];
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

const weekFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const serviceDateFormatter = new Intl.DateTimeFormat(
  "es-MX",
  {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  },
);

function money(value: string | number) {
  return moneyFormatter.format(Number(value));
}

function capitalize(value: string) {
  if (!value) {
    return value;
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function serviceLabel(
  serviceType: BillingService["serviceType"],
) {
  return serviceType === "BREAKFAST"
    ? "Desayuno"
    : "Comida";
}

export default function HrBillingDashboard() {
  const [data, setData] = useState<BillingData>();
  const [selectedWeekId, setSelectedWeekId] =
    useState("");
  const [expandedOrderId, setExpandedOrderId] =
    useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string>();

  const loadBilling = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(undefined);

      const response = await fetch(
        "/api/food-services/hr/billing",
        { cache: "no-store" },
      );

      const payload = (await response.json()) as {
        data?: BillingData;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(
          payload.error ??
            "No fue posible consultar los cobros.",
        );
      }

      setData(payload.data);

      setSelectedWeekId((current) => {
        if (
          current &&
          payload.data?.weeks.some(
            (week) => week.id === current,
          )
        ) {
          return current;
        }

        return payload.data?.weeks[0]?.id ?? "";
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible consultar los cobros.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const selectedWeek = data?.weeks.find(
    (week) => week.id === selectedWeekId,
  );

  const visibleOrders = useMemo(
    () =>
      data?.orders.filter(
        (order) =>
          order.week.id === selectedWeekId,
      ) ?? [],
    [data, selectedWeekId],
  );

  const periodTotals = useMemo(() => {
    const employees = new Set(
      visibleOrders.map(
        (order) => order.employee.id,
      ),
    ).size;

    return {
      orders: visibleOrders.length,
      employees,
      services: visibleOrders.reduce(
        (total, order) =>
          total + order.itemCount,
        0,
      ),
      amount: visibleOrders.reduce(
        (total, order) =>
          total + Number(order.totalAmount),
        0,
      ),
    };
  }, [visibleOrders]);

  async function exportBilling() {
    if (!selectedWeekId || visibleOrders.length === 0) {
      setError(
        "Selecciona una semana con cargos antes de exportar.",
      );
      return;
    }

    try {
      setIsExporting(true);
      setError(undefined);

      const response = await fetch(
        `/api/food-services/hr/billing/export?weekId=${encodeURIComponent(
          selectedWeekId,
        )}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        let message =
          "No fue posible generar el archivo de nómina.";

        try {
          const payload = (await response.json()) as {
            error?: string;
          };

          message = payload.error ?? message;
        } catch {
          // La respuesta de error puede no ser JSON.
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition =
        response.headers.get("content-disposition");
      const fileNameMatch = disposition?.match(
        /filename\*?=(?:UTF-8''|")?([^";]+)/i,
      );
      const fileName = fileNameMatch?.[1]
        ? decodeURIComponent(
            fileNameMatch[1].replace(/"/g, ""),
          )
        : "YellowFlex_FoodServices_Nomina.xlsx";

      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = downloadUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "No fue posible generar el archivo de nómina.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  function changeWeek(weekId: string) {
    setSelectedWeekId(weekId);
    setExpandedOrderId(undefined);
  }

  function toggleOrder(orderId: string) {
    setExpandedOrderId((current) =>
      current === orderId
        ? undefined
        : orderId,
    );
  }

  if (isLoading && !data) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <RefreshCw className="mx-auto size-7 animate-spin text-[#0B3A82]" />

        <p className="mt-4 text-sm font-semibold text-slate-500">
          Calculando cargos de Food Services...
        </p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
        <p className="font-bold text-red-700">
          {error}
        </p>

        <button
          type="button"
          onClick={() => void loadBilling()}
          className="mt-4 rounded-xl bg-[#0B3A82] px-4 py-2.5 text-sm font-bold text-white"
        >
          Reintentar
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-[#0B3A82] to-[#164f9d] px-6 py-7 text-white lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[#F4B400]">
                Control administrativo
              </p>

              <h2 className="mt-2 text-2xl font-black">
                Concentrado de cobros
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
                Cargos generados por pedidos
                confirmados. La recolección del
                alimento no modifica el importe a
                nómina.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void exportBilling()}
                disabled={
                  isExporting ||
                  !selectedWeekId ||
                  visibleOrders.length === 0
                }
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#F4B400] px-4 text-sm font-black text-[#0B3A82] transition hover:bg-[#ffc62b] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download
                  className={`size-4 ${
                    isExporting
                      ? "animate-pulse"
                      : ""
                  }`}
                />

                {isExporting
                  ? "Generando..."
                  : "Exportar Excel"}
              </button>

              <button
                type="button"
                onClick={() => void loadBilling()}
                disabled={isLoading || isExporting}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-[#0B3A82] transition hover:bg-blue-50 disabled:opacity-60"
              >
                <RefreshCw
                  className={`size-4 ${
                    isLoading
                      ? "animate-spin"
                      : ""
                  }`}
                />

                Actualizar
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 p-5 lg:px-8">
          <label className="block max-w-sm">
            <span className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">
              Semana de cobro
            </span>

            <div className="relative mt-2">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#0B3A82]" />

              <select
                value={selectedWeekId}
                onChange={(event) =>
                  changeWeek(event.target.value)
                }
                className="h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pl-10 pr-10 text-sm font-bold text-slate-700 outline-none focus:border-[#0B3A82] focus:ring-4 focus:ring-blue-100"
              >
                {data?.weeks.map((week) => (
                  <option
                    key={week.id}
                    value={week.id}
                  >
                    Semana del{" "}
                    {weekFormatter.format(
                      new Date(week.weekStart),
                    )}
                  </option>
                ))}
              </select>

              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            </div>
          </label>
        </div>

        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Colaboradores"
            value={periodTotals.employees}
            icon={
              <UsersRound className="size-5" />
            }
          />

          <Kpi
            label="Pedidos confirmados"
            value={periodTotals.orders}
            icon={
              <ReceiptText className="size-5" />
            }
          />

          <Kpi
            label="Servicios cobrables"
            value={periodTotals.services}
            icon={
              <UtensilsCrossed className="size-5" />
            }
          />

          <Kpi
            label="Total a nómina"
            value={money(periodTotals.amount)}
            icon={
              <Banknote className="size-5" />
            }
            emphasized
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-black text-slate-950">
              Detalle por colaborador
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              {selectedWeek
                ? `Semana del ${weekFormatter.format(
                    new Date(
                      selectedWeek.weekStart,
                    ),
                  )}`
                : "Sin periodo seleccionado"}
            </p>
          </div>

          <p className="text-sm font-black text-[#0B3A82]">
            {money(periodTotals.amount)}
          </p>
        </div>

        {visibleOrders.length === 0 ? (
          <div className="p-10 text-center text-sm font-semibold text-slate-500">
            No existen pedidos confirmados para
            este periodo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr className="text-xs font-black uppercase tracking-wide text-slate-400">
                  <th className="px-6 py-4">
                    Nómina
                  </th>

                  <th className="px-6 py-4">
                    Colaborador
                  </th>

                  <th className="px-6 py-4">
                    Departamento
                  </th>

                  <th className="px-6 py-4">
                    Turno
                  </th>

                  <th className="px-6 py-4 text-center">
                    Servicios
                  </th>

                  <th className="px-6 py-4 text-right">
                    P. unitario
                  </th>

                  <th className="px-6 py-4 text-right">
                    Total
                  </th>

                  <th className="px-6 py-4 text-right">
                    Detalle
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {visibleOrders.map((order) => {
                  const isExpanded =
                    expandedOrderId === order.id;

                  return (
                    <Fragment key={order.id}>
                      <tr className="align-top transition hover:bg-slate-50/70">
                        <td className="px-6 py-5 text-sm font-black text-[#0B3A82]">
                          {
                            order.employee
                              .employeeNumber
                          }
                        </td>

                        <td className="px-6 py-5">
                          <p className="text-sm font-bold text-slate-900">
                            {
                              order.employee
                                .fullName
                            }
                          </p>

                          <p className="mt-1 text-xs text-slate-500">
                            {order.employee
                              .position ??
                              "Sin puesto"}
                          </p>

                          <p className="mt-2 text-[11px] font-semibold text-slate-400">
                            Confirmado{" "}
                            {dateFormatter.format(
                              new Date(
                                order.confirmedAt,
                              ),
                            )}
                          </p>
                        </td>

                        <td className="px-6 py-5 text-sm font-semibold text-slate-600">
                          {
                            order.employee
                              .department.name
                          }
                        </td>

                        <td className="px-6 py-5 text-sm font-semibold text-slate-600">
                          {order.employee
                            .workShift?.code ??
                            "—"}
                        </td>

                        <td className="px-6 py-5 text-center text-sm font-black text-slate-900">
                          {order.itemCount}
                        </td>

                        <td className="px-6 py-5 text-right text-sm font-semibold text-slate-600">
                          {money(
                            order.unitPrice,
                          )}
                        </td>

                        <td className="px-6 py-5 text-right text-base font-black text-[#0B3A82]">
                          {money(
                            order.totalAmount,
                          )}
                        </td>

                        <td className="px-6 py-5 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              toggleOrder(
                                order.id,
                              )
                            }
                            aria-expanded={
                              isExpanded
                            }
                            className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-[#0B3A82] transition hover:border-blue-200 hover:bg-blue-50"
                          >
                            {isExpanded ? (
                              <>
                                Ocultar
                                <ChevronUp className="size-4" />
                              </>
                            ) : (
                              <>
                                Ver detalle
                                <ChevronDown className="size-4" />
                              </>
                            )}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={8}
                            className="bg-slate-50/80 px-6 py-0"
                          >
                            <div className="py-6">
                              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#b27f00]">
                                      Desglose del
                                      cargo
                                    </p>

                                    <p className="mt-1 text-sm font-bold text-slate-900">
                                      {
                                        order
                                          .employee
                                          .fullName
                                      }
                                    </p>
                                  </div>

                                  <div className="text-left sm:text-right">
                                    <p className="text-xs font-semibold text-slate-400">
                                      Pedido
                                      confirmado
                                    </p>

                                    <p className="mt-1 text-sm font-black text-[#0B3A82]">
                                      {money(
                                        order.totalAmount,
                                      )}
                                    </p>
                                  </div>
                                </div>

                                {order.services
                                  .length === 0 ? (
                                  <div className="p-5 text-sm font-semibold text-slate-500">
                                    Este pedido no
                                    contiene servicios
                                    asociados.
                                  </div>
                                ) : (
                                  <div className="divide-y divide-slate-100">
                                    {order.services.map(
                                      (
                                        service,
                                      ) => (
                                        <div
                                          key={
                                            service.reservationId
                                          }
                                          className="grid gap-4 px-5 py-4 md:grid-cols-[180px_140px_minmax(220px,1fr)_120px] md:items-center"
                                        >
                                          <div>
                                            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">
                                              Fecha
                                            </p>

                                            <p className="mt-1 text-sm font-bold text-slate-700">
                                              {capitalize(
                                                serviceDateFormatter.format(
                                                  new Date(
                                                    service.serviceDate,
                                                  ),
                                                ),
                                              )}
                                            </p>
                                          </div>

                                          <div>
                                            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">
                                              Servicio
                                            </p>

                                            <div className="mt-1 flex items-center gap-2">
                                              {service.serviceType ===
                                              "BREAKFAST" ? (
                                                <Coffee className="size-4 text-[#b27f00]" />
                                              ) : (
                                                <Utensils className="size-4 text-[#0B3A82]" />
                                              )}

                                              <span className="text-sm font-bold text-slate-700">
                                                {serviceLabel(
                                                  service.serviceType,
                                                )}
                                              </span>
                                            </div>
                                          </div>

                                          <div>
                                            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">
                                              Platillo
                                            </p>

                                            <p className="mt-1 text-sm font-bold text-slate-900">
                                              {
                                                service.name
                                              }
                                            </p>
                                          </div>

                                          <div className="md:text-right">
                                            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">
                                              Importe
                                            </p>

                                            <p className="mt-1 text-sm font-black text-[#0B3A82]">
                                              {money(
                                                service.menuPrice,
                                              )}
                                            </p>
                                          </div>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                )}

                                <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                                    <ReceiptText className="size-4 text-[#0B3A82]" />

                                    {
                                      order
                                        .services
                                        .length
                                    }{" "}
                                    {order.services
                                      .length ===
                                    1
                                      ? "servicio"
                                      : "servicios"}{" "}
                                    confirmado
                                    {order.services
                                      .length ===
                                    1
                                      ? ""
                                      : "s"}
                                  </div>

                                  <div className="flex items-baseline gap-3">
                                    <span className="text-xs font-black uppercase tracking-wide text-slate-400">
                                      Total del
                                      pedido
                                    </span>

                                    <span className="text-xl font-black text-[#0B3A82]">
                                      {money(
                                        order.totalAmount,
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  emphasized = false,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  emphasized?: boolean;
}) {
  return (
    <div className="bg-white p-6">
      <div
        className={`flex size-10 items-center justify-center rounded-xl ${
          emphasized
            ? "bg-amber-50 text-[#b27f00]"
            : "bg-blue-50 text-[#0B3A82]"
        }`}
      >
        {icon}
      </div>

      <p className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>

      <p
        className={`mt-2 text-3xl font-black tracking-tight ${
          emphasized
            ? "text-[#b27f00]"
            : "text-slate-950"
        }`}
      >
        {value}
      </p>
    </div>
  );
}