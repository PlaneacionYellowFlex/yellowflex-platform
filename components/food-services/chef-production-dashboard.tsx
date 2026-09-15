"use client";

import {
  Building2,
  CalendarDays,
  ChefHat,
  Download,
  LoaderCircle,
  RefreshCw,
  UtensilsCrossed,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type DepartmentSummary = {
  id: string;
  code: string;
  name: string;
  quantity: number;
};

type ShiftSummary = {
  id: string | null;
  code: string;
  name: string;
  startTime: string | null;
  endTime: string | null;
  quantity: number;
};

type ProductionService = {
  id: string;
  serviceType: "BREAKFAST" | "LUNCH";
  name: string;
  price: string;
  confirmed: number;
  consumed: number;
  pending: number;
  employeeConfirmed: number;
  extraordinary: number;
  departments: DepartmentSummary[];
  shifts: ShiftSummary[];
};

type ProductionDay = {
  id: string;
  serviceDate: string;
  confirmedServices: number;
  consumedServices: number;
  pendingServices: number;
  services: ProductionService[];
};

type ProductionSummary = {
  week: {
    id: string;
    weekStart: string;
    publishedAt: string | null;
  } | null;
  totals: {
    confirmedServices: number;
    consumedServices: number;
    pendingServices: number;
    extraordinaryServices: number;
  };
  days: ProductionDay[];
};

const dayFormatter = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const weekFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function capitalize(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function serviceLabel(serviceType: ProductionService["serviceType"]) {
  return serviceType === "BREAKFAST" ? "Desayuno" : "Comida";
}

export default function ChefProductionDashboard() {
  const [data, setData] = useState<ProductionSummary>();
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string>();

  const loadProduction = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(undefined);

      const response = await fetch(
        "/api/food-services/chef/menu?view=production",
        {
          cache: "no-store",
        },
      );

      const payload = (await response.json()) as {
        data?: ProductionSummary;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "No fue posible consultar la producción de cocina.",
        );
      }

      setData(payload.data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible consultar la producción de cocina.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProduction();
  }, [loadProduction]);

  async function exportBilling() {
    if (!data?.week) {
      setError("No existe una semana publicada para exportar.");
      return;
    }

    try {
      setIsExporting(true);
      setError(undefined);

      const response = await fetch(
        `/api/food-services/chef/billing/export?weekId=${encodeURIComponent(
          data.week.id,
        )}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        let message = "No fue posible generar el corte Excel.";

        try {
          const payload = (await response.json()) as { error?: string };
          message = payload.error ?? message;
        } catch {
          // La respuesta de error puede no ser JSON.
        }

        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition");
      const fileNameMatch = disposition?.match(
        /filename\*?=(?:UTF-8''|")?([^";]+)/i,
      );
      const fileName = fileNameMatch?.[1]
        ? decodeURIComponent(fileNameMatch[1].replace(/"/g, ""))
        : "YellowFlex_FoodServices_Corte.xlsx";

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
          : "No fue posible generar el corte Excel.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  if (isLoading && !data) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex min-h-48 items-center justify-center">
          <div className="text-center">
            <LoaderCircle className="mx-auto size-8 animate-spin text-[#0B3A82]" />
            <p className="mt-4 text-sm font-semibold text-slate-500">
              Consultando producción de cocina...
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
        <p className="font-bold text-red-700">
          No fue posible cargar Producción de Cocina
        </p>

        <p className="mt-2 text-sm text-slate-600">
          {error}
        </p>

        <button
          type="button"
          onClick={() => void loadProduction()}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#0B3A82] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#082d66]"
        >
          <RefreshCw className="size-4" />
          Reintentar
        </button>
      </section>
    );
  }

  if (!data?.week) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-[#b27f00]">
            <ChefHat className="size-6" />
          </span>

          <div>
            <h2 className="text-xl font-bold text-slate-950">
              Producción de Cocina
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Todavía no existe una semana publicada para calcular la
              producción.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const activeDays = data.days.filter(
    (day) => day.services.length > 0,
  );

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3A82] to-[#164f9d] px-6 py-7 text-white lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#F4B400]">
              <ChefHat className="size-5" />

              <p className="text-xs font-black uppercase tracking-[0.2em]">
                Operación de cocina
              </p>
            </div>

            <h2 className="mt-3 text-2xl font-black tracking-tight">
              Producción de Cocina
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
              Cantidades definitivas de colaboradores y servicios extraordinarios
              para la semana publicada.
            </p>

            <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold ring-1 ring-white/15">
              <CalendarDays className="size-4 text-[#F4B400]" />
              Semana del{" "}
              {weekFormatter.format(
                new Date(data.week.weekStart),
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={isExporting}
              onClick={() => void exportBilling()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#F4B400] px-4 text-sm font-black text-[#0B3A82] transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExporting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {isExporting ? "Generando..." : "Descargar corte Excel"}
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => void loadProduction()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-[#0B3A82] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                className={`size-4 ${
                  isLoading ? "animate-spin" : ""
                }`}
              />
              Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white px-6 py-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              Total semanal a preparar
            </p>

            <div className="mt-2 flex items-end gap-3">
              <p className="text-5xl font-black tracking-tight text-[#0B3A82]">
                {data.totals.confirmedServices}
              </p>

              <p className="pb-1 text-sm font-bold text-slate-500">
                servicios a preparar
              </p>
            </div>
          </div>

          <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-bold leading-5 text-amber-800">
              El total integra pedidos confirmados de colaboradores y consumos
              extraordinarios autorizados por RH.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 lg:p-8">
        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {activeDays.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
            <UtensilsCrossed className="mx-auto size-7 text-slate-400" />

            <p className="mt-3 font-bold text-slate-700">
              La semana publicada todavía no tiene servicios
              disponibles.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {activeDays.map((day) => (
              <article
                key={day.id}
                className="overflow-hidden rounded-2xl border border-slate-200"
              >
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-base font-black text-slate-900">
                      {capitalize(
                        dayFormatter.format(
                          new Date(day.serviceDate),
                        ),
                      )}
                    </p>

                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {day.confirmedServices} servicio(s) a preparar
                    </p>
                  </div>

                  <div className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-black text-[#0B3A82]">
                    Total del día: {day.confirmedServices}
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {day.services.map((service) => (
                    <div
                      key={service.id}
                      className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_180px]"
                    >
                      <div>
                        <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-[#0B3A82]">
                          {serviceLabel(service.serviceType)}
                        </span>

                        <h3 className="mt-3 text-lg font-black text-slate-950">
                          {service.name}
                        </h3>

                        {service.extraordinary > 0 && (
                          <div className="mt-3 inline-flex rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-black text-[#8a6200]">
                            + {service.extraordinary} extraordinario{service.extraordinary === 1 ? "" : "s"} autorizado{service.extraordinary === 1 ? "" : "s"}
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          {service.shifts.map((shift) => (
                            <span
                              key={shift.id ?? shift.code}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600"
                            >
                              Turno {shift.code}: {shift.quantity}
                            </span>
                          ))}

                          {service.departments.map(
                            (department) => (
                              <span
                                key={department.id}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600"
                              >
                                <Building2 className="size-3.5 text-[#0B3A82]" />
                                {department.name}:{" "}
                                {department.quantity}
                              </span>
                            ),
                          )}
                        </div>
                      </div>

                      <div className="flex min-h-28 flex-col items-center justify-center rounded-2xl border border-blue-100 bg-blue-50/60 px-5 py-4 text-center">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#0B3A82]">
                          Preparar
                        </p>

                        <p className="mt-1 text-4xl font-black tracking-tight text-[#0B3A82]">
                          {service.confirmed}
                        </p>

                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          porción
                          {service.confirmed === 1 ? "" : "es"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
