"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  CircleDollarSign,
  Coffee,
  History,
  LoaderCircle,
  Rocket,
  Save,
  Soup,
  Utensils,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

type ServiceType = "BREAKFAST" | "LUNCH";

type ApiMenuItem = {
  id: string;
  serviceType: ServiceType;
  name: string;
  description: string | null;
  price: string;
};

type ApiMenuDay = {
  id: string;
  serviceDate: string;
  items: ApiMenuItem[];
};

type ApiMenuWeek = {
  id: string;
  weekStart: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  days: ApiMenuDay[];
};

type ChefHistoryWeek = {
  id: string;
  weekStart: string;
  status: "PUBLISHED";
  publishedAt: string | null;
  activeServices: number;
  maximumServices: number;
  days: ApiMenuDay[];
};

type EditableService = {
  enabled: boolean;
  name: string;
  description: string;
};

type EditableDay = {
  serviceDate: string;
  breakfast: EditableService;
  lunch: EditableService;
};

type MenuResponse = {
  data?: ApiMenuWeek;
  error?: string;
};

type HistoryResponse = {
  data?: ChefHistoryWeek[];
  error?: string;
};

type PublishResponse = {
  data?: {
    menuWeek: ApiMenuWeek;
    activeServices: number;
    maximumServices: number;
  };
  error?: string;
};

const SERVICE_PRICE = 25;
const MAXIMUM_SERVICES = 14;

const dayFormatter = new Intl.DateTimeFormat(
  "es-MX",
  {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  },
);

const weekFormatter = new Intl.DateTimeFormat(
  "es-MX",
  {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  },
);

const publishedFormatter = new Intl.DateTimeFormat(
  "es-MX",
  {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
);

function emptyService(): EditableService {
  return {
    enabled: false,
    name: "",
    description: "",
  };
}

function getService(
  items: ApiMenuItem[],
  serviceType: ServiceType,
): EditableService {
  const item = items.find(
    (currentItem) =>
      currentItem.serviceType === serviceType,
  );

  if (!item) {
    return emptyService();
  }

  return {
    enabled: true,
    name: item.name,
    description: item.description ?? "",
  };
}

function mapWeekToEditableDays(
  week: ApiMenuWeek,
): EditableDay[] {
  return week.days.map((day) => ({
    serviceDate: day.serviceDate,
    breakfast: getService(
      day.items,
      "BREAKFAST",
    ),
    lunch: getService(
      day.items,
      "LUNCH",
    ),
  }));
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

async function fetchChefMenu(
  signal?: AbortSignal,
): Promise<ApiMenuWeek> {
  const response = await fetch(
    "/api/food-services/chef/menu",
    {
      cache: "no-store",
      signal,
    },
  );

  const payload =
    (await response.json()) as MenuResponse;

  if (!response.ok || !payload.data) {
    throw new Error(
      payload.error ??
        "No fue posible cargar el menú.",
    );
  }

  return payload.data;
}

async function fetchChefMenuHistory(
  signal?: AbortSignal,
): Promise<ChefHistoryWeek[]> {
  const response = await fetch(
    "/api/food-services/chef/menu?view=history",
    {
      cache: "no-store",
      signal,
    },
  );

  const payload =
    (await response.json()) as HistoryResponse;

  if (!response.ok || !payload.data) {
    throw new Error(
      payload.error ??
        "No fue posible cargar el historial de menús.",
    );
  }

  return payload.data;
}

function ServiceEditor({
  type,
  value,
  disabled,
  onChange,
}: {
  type: ServiceType;
  value: EditableService;
  disabled: boolean;
  onChange: (value: EditableService) => void;
}) {
  const isBreakfast = type === "BREAKFAST";

  const title = isBreakfast
    ? "Desayuno"
    : "Comida";

  const description = isBreakfast
    ? "Servicio matutino"
    : "Servicio vespertino";

  const Icon = isBreakfast ? Coffee : Soup;

  function update(
    changes: Partial<EditableService>,
  ) {
    onChange({
      ...value,
      ...changes,
    });
  }

  return (
    <div
      className={`rounded-2xl border transition ${
        value.enabled
          ? "border-blue-200 bg-blue-50/40"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
              value.enabled
                ? "bg-[#0b3a82] text-white"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            <Icon className="size-5" />
          </div>

          <div className="min-w-0">
            <p className="font-bold text-slate-900">
              {title}
            </p>

            <p className="text-xs text-slate-500">
              {description} · $25.00
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            update({
              enabled: !value.enabled,
            })
          }
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
            value.enabled
              ? "bg-[#0b3a82]"
              : "bg-slate-200"
          }`}
          aria-label={`${
            value.enabled
              ? "Desactivar"
              : "Activar"
          } ${title}`}
        >
          <span
            className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition-all ${
              value.enabled
                ? "left-6"
                : "left-1"
            }`}
          />
        </button>
      </div>

      {value.enabled && (
        <div className="space-y-4 border-t border-blue-100 p-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Platillo
            </label>

            <input
              type="text"
              value={value.name}
              disabled={disabled}
              maxLength={120}
              placeholder={
                isBreakfast
                  ? "Ej. Chilaquiles con huevo"
                  : "Ej. Pollo en salsa verde"
              }
              onChange={(event) =>
                update({
                  name: event.target.value,
                })
              }
              className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Descripción
              <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">
                opcional
              </span>
            </label>

            <textarea
              value={value.description}
              disabled={disabled}
              maxLength={500}
              rows={2}
              placeholder="Información adicional del platillo"
              onChange={(event) =>
                update({
                  description:
                    event.target.value,
                })
              }
              className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PublishConfirmation({
  activeServices,
  isPublishing,
  onCancel,
  onConfirm,
}: {
  activeServices: number;
  isPublishing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const missingServices =
    MAXIMUM_SERVICES - activeServices;

  const isComplete =
    activeServices === MAXIMUM_SERVICES;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-menu-title"
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
          <div
            className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
              isComplete
                ? "bg-emerald-50 text-emerald-600"
                : "bg-amber-50 text-amber-600"
            }`}
          >
            {isComplete ? (
              <CheckCircle2 className="size-6" />
            ) : (
              <AlertTriangle className="size-6" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2
              id="publish-menu-title"
              className="text-xl font-bold tracking-tight text-slate-900"
            >
              Publicar semana
            </h2>

            <p className="mt-1 text-sm leading-6 text-slate-500">
              Esta acción cerrará la edición del
              menú y lo dejará disponible para el
              flujo de reservaciones.
            </p>
          </div>

          <button
            type="button"
            disabled={isPublishing}
            onClick={onCancel}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Cerrar confirmación"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div
            className={`rounded-2xl border p-4 ${
              isComplete
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  Cobertura semanal
                </p>

                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {activeServices} /{" "}
                  {MAXIMUM_SERVICES}
                </p>
              </div>

              <Utensils
                className={`size-7 ${
                  isComplete
                    ? "text-emerald-600"
                    : "text-amber-600"
                }`}
              />
            </div>
          </div>

          {!isComplete && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="text-sm font-bold text-amber-900">
                Hay {missingServices} servicio
                {missingServices === 1
                  ? ""
                  : "s"}{" "}
                sin configurar.
              </p>

              <p className="mt-1 text-sm leading-6 text-amber-800">
                Los servicios no configurados no
                estarán disponibles para
                reservación. Puedes publicar de
                todas formas si esta planeación es
                correcta.
              </p>
            </div>
          )}

          <p className="text-sm leading-6 text-slate-500">
            Una vez publicada, esta semana quedará
            bloqueada para edición.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 p-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isPublishing}
            onClick={onCancel}
            className="h-12 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Revisar menú
          </button>

          <button
            type="button"
            disabled={isPublishing}
            onClick={onConfirm}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-5 text-sm font-bold text-white transition hover:bg-[#082d66] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPublishing ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <Rocket className="size-5" />
            )}

            {isPublishing
              ? "Publicando..."
              : "Confirmar publicación"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChefMenuManager() {
  const [week, setWeek] =
    useState<ApiMenuWeek>();

  const [days, setDays] = useState<
    EditableDay[]
  >([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [isSaving, setIsSaving] =
    useState(false);

  const [isPublishing, setIsPublishing] =
    useState(false);

  const [
    showPublishConfirmation,
    setShowPublishConfirmation,
  ] = useState(false);

  const [message, setMessage] =
    useState<string>();

  const [error, setError] =
    useState<string>();

  const [history, setHistory] = useState<
    ChefHistoryWeek[]
  >([]);

  const [historyError, setHistoryError] =
    useState<string>();

  const [expandedHistoryId, setExpandedHistoryId] =
    useState<string>();

  useEffect(() => {
    const controller =
      new AbortController();

    fetchChefMenuHistory(controller.signal)
      .then((historyWeeks) => {
        setHistory(historyWeeks);
      })
      .catch((historyLoadError: unknown) => {
        if (
          historyLoadError instanceof DOMException &&
          historyLoadError.name === "AbortError"
        ) {
          return;
        }

        setHistoryError(
          historyLoadError instanceof Error
            ? historyLoadError.message
            : "No fue posible cargar el historial de menús.",
        );
      });

    fetchChefMenu(controller.signal)
      .then((menuWeek) => {
        setWeek(menuWeek);
        setDays(
          mapWeekToEditableDays(menuWeek),
        );
      })
      .catch((loadError: unknown) => {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "No fue posible cargar el menú.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  const activeServices = useMemo(
    () =>
      days.reduce(
        (total, day) =>
          total +
          Number(day.breakfast.enabled) +
          Number(day.lunch.enabled),
        0,
      ),
    [days],
  );

  const completedServices = useMemo(
    () =>
      days.reduce(
        (total, day) =>
          total +
          Number(
            day.breakfast.enabled &&
              day.breakfast.name.trim()
                .length > 0,
          ) +
          Number(
            day.lunch.enabled &&
              day.lunch.name.trim().length >
                0,
          ),
        0,
      ),
    [days],
  );

  const isEditable =
    week?.status === "DRAFT";

  const hasIncompleteService =
    activeServices !== completedServices;

  function updateService(
    dayIndex: number,
    service: "breakfast" | "lunch",
    value: EditableService,
  ) {
    setMessage(undefined);
    setError(undefined);

    setDays((currentDays) =>
      currentDays.map(
        (day, currentIndex) =>
          currentIndex === dayIndex
            ? {
                ...day,
                [service]: value,
              }
            : day,
      ),
    );
  }

  async function reloadMenu() {
    try {
      setIsLoading(true);
      setMessage(undefined);
      setError(undefined);

      const menuWeek =
        await fetchChefMenu();

      setWeek(menuWeek);
      setDays(
        mapWeekToEditableDays(menuWeek),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No fue posible cargar el menú.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function saveMenu() {
    if (!week) {
      return;
    }

    if (hasIncompleteService) {
      setMessage(undefined);
      setError(
        "Cada servicio activado debe tener el nombre del platillo.",
      );
      return;
    }

    try {
      setIsSaving(true);
      setMessage(undefined);
      setError(undefined);

      const payload = {
        weekStart: week.weekStart,
        days: days.map((day) => ({
          serviceDate: day.serviceDate,
          items: [
            ...(day.breakfast.enabled
              ? [
                  {
                    serviceType:
                      "BREAKFAST" as const,
                    name:
                      day.breakfast.name.trim(),
                    description:
                      day.breakfast.description.trim() ||
                      null,
                  },
                ]
              : []),
            ...(day.lunch.enabled
              ? [
                  {
                    serviceType:
                      "LUNCH" as const,
                    name:
                      day.lunch.name.trim(),
                    description:
                      day.lunch.description.trim() ||
                      null,
                  },
                ]
              : []),
          ],
        })),
      };

      const response = await fetch(
        "/api/food-services/chef/menu",
        {
          method: "PUT",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const result =
        (await response.json()) as MenuResponse;

      if (!response.ok || !result.data) {
        throw new Error(
          result.error ??
            "No fue posible guardar el menú.",
        );
      }

      setWeek(result.data);
      setDays(
        mapWeekToEditableDays(result.data),
      );

      setMessage(
        "Borrador guardado correctamente.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No fue posible guardar el menú.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function requestPublish() {
    setMessage(undefined);
    setError(undefined);

    if (activeServices === 0) {
      setError(
        "Configura al menos un servicio antes de publicar la semana.",
      );
      return;
    }

    if (hasIncompleteService) {
      setError(
        "Antes de publicar, todos los servicios activados deben tener el nombre del platillo.",
      );
      return;
    }

    setShowPublishConfirmation(true);
  }

  async function publishMenu() {
    try {
      setIsPublishing(true);
      setMessage(undefined);
      setError(undefined);

      const response = await fetch(
        "/api/food-services/chef/menu",
        {
          method: "POST",
        },
      );

      const result =
        (await response.json()) as PublishResponse;

      if (
        !response.ok ||
        !result.data?.menuWeek
      ) {
        throw new Error(
          result.error ??
            "No fue posible publicar el menú.",
        );
      }

      const publishedWeek =
        result.data.menuWeek;

      setWeek(publishedWeek);
      setDays(
        mapWeekToEditableDays(
          publishedWeek,
        ),
      );

      setShowPublishConfirmation(false);

      setMessage(
        `Semana publicada correctamente con ${result.data.activeServices} de ${result.data.maximumServices} servicios.`,
      );

      try {
        const historyWeeks =
          await fetchChefMenuHistory();
        setHistory(historyWeeks);
        setHistoryError(undefined);
      } catch (historyRefreshError) {
        setHistoryError(
          historyRefreshError instanceof Error
            ? historyRefreshError.message
            : "La semana fue publicada, pero no fue posible actualizar el historial.",
        );
      }
    } catch (publishError) {
      setShowPublishConfirmation(false);

      setError(
        publishError instanceof Error
          ? publishError.message
          : "No fue posible publicar el menú.",
      );
    } finally {
      setIsPublishing(false);
    }
  }

  if (isLoading) {
    return (
      <section className="flex min-h-[420px] items-center justify-center rounded-3xl border border-slate-200 bg-white">
        <div className="text-center">
          <LoaderCircle className="mx-auto size-8 animate-spin text-[#0b3a82]" />

          <p className="mt-4 text-sm font-semibold text-slate-700">
            Preparando planeación semanal
          </p>

          <p className="mt-1 text-xs text-slate-400">
            Organizando los servicios de la
            próxima semana.
          </p>
        </div>
      </section>
    );
  }

  if (error && !week) {
    return (
      <section className="rounded-3xl border border-red-200 bg-white p-8 text-center">
        <ChefHat className="mx-auto size-9 text-red-500" />

        <h2 className="mt-4 text-lg font-bold text-slate-900">
          No fue posible abrir la planeación
        </h2>

        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
          {error}
        </p>

        <button
          type="button"
          onClick={() => void reloadMenu()}
          className="mt-6 rounded-xl bg-[#0b3a82] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#082d66]"
        >
          Intentar nuevamente
        </button>
      </section>
    );
  }

  if (!week) {
    return null;
  }

  return (
    <>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-6 sm:px-7">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#c58a00]">
                  <CalendarDays className="size-4" />
                  Próxima semana
                </div>

                <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#0b3a82]">
                  Planeación de menú
                </h2>

                <p className="mt-2 text-sm text-slate-500">
                  Semana del{" "}
                  <span className="font-semibold text-slate-700">
                    {weekFormatter.format(
                      new Date(week.weekStart),
                    )}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                    Estado
                  </p>

                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${
                        week.status === "DRAFT"
                          ? "bg-amber-400"
                          : week.status ===
                              "PUBLISHED"
                            ? "bg-emerald-500"
                            : "bg-slate-400"
                      }`}
                    />

                    <span className="text-sm font-bold text-slate-700">
                      {week.status === "DRAFT"
                        ? "Borrador"
                        : week.status ===
                            "PUBLISHED"
                          ? "Publicado"
                          : "Archivado"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
            <div className="bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-[#0b3a82]">
                  <Utensils className="size-5" />
                </div>

                <div>
                  <p className="text-xs text-slate-400">
                    Servicios activos
                  </p>

                  <p className="text-xl font-bold text-slate-900">
                    {activeServices}
                    <span className="ml-1 text-sm font-medium text-slate-400">
                      / 14
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="size-5" />
                </div>

                <div>
                  <p className="text-xs text-slate-400">
                    Platillos completos
                  </p>

                  <p className="text-xl font-bold text-slate-900">
                    {completedServices}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-[#c58a00]">
                  <CircleDollarSign className="size-5" />
                </div>

                <div>
                  <p className="text-xs text-slate-400">
                    Precio por servicio
                  </p>

                  <p className="text-xl font-bold text-slate-900">
                    ${SERVICE_PRICE.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {message && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            <CheckCircle2 className="size-5 shrink-0" />
            {message}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          {days.map((day, dayIndex) => {
            const date = new Date(
              day.serviceDate,
            );

            return (
              <section
                key={day.serviceDate}
                className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
                  <p className="text-sm font-bold text-[#0b3a82]">
                    {capitalize(
                      dayFormatter.format(date),
                    )}
                  </p>
                </div>

                <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
                  <ServiceEditor
                    type="BREAKFAST"
                    value={day.breakfast}
                    disabled={!isEditable}
                    onChange={(value) =>
                      updateService(
                        dayIndex,
                        "breakfast",
                        value,
                      )
                    }
                  />

                  <ServiceEditor
                    type="LUNCH"
                    value={day.lunch}
                    disabled={!isEditable}
                    onChange={(value) =>
                      updateService(
                        dayIndex,
                        "lunch",
                        value,
                      )
                    }
                  />
                </div>
              </section>
            );
          })}
        </div>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-[#0b3a82]">
                <History className="size-5" />
              </div>

              <div>
                <h2 className="font-bold text-[#0b3a82]">
                  Historial de menús
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Últimas 5 semanas publicadas · Solo consulta
                </p>
              </div>
            </div>

            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
              {history.length} semana
              {history.length === 1 ? "" : "s"}
            </span>
          </div>

          {historyError && (
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-800 sm:px-6">
              {historyError}
            </div>
          )}

          {history.length === 0 ? (
            <div className="px-5 py-8 text-center sm:px-6">
              <History className="mx-auto size-7 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-600">
                Aún no hay semanas publicadas.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.map((historyWeek) => {
                const isExpanded =
                  expandedHistoryId === historyWeek.id;

                return (
                  <div key={historyWeek.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedHistoryId(
                          isExpanded
                            ? undefined
                            : historyWeek.id,
                        )
                      }
                      className="flex w-full flex-col gap-4 px-5 py-4 text-left transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                      aria-expanded={isExpanded}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-slate-900">
                            Semana del{" "}
                            {weekFormatter.format(
                              new Date(historyWeek.weekStart),
                            )}
                          </p>

                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                            Publicado
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-slate-500">
                          {historyWeek.publishedAt
                            ? `Publicado ${publishedFormatter.format(
                                new Date(historyWeek.publishedAt),
                              )}`
                            : "Fecha de publicación no disponible"}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-5 sm:justify-end">
                        <div className="text-right">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                            Cobertura
                          </p>
                          <p className="mt-0.5 text-sm font-bold text-[#0b3a82]">
                            {historyWeek.activeServices} /{" "}
                            {historyWeek.maximumServices}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 text-sm font-bold text-[#0b3a82]">
                          {isExpanded
                            ? "Ocultar detalle"
                            : "Ver detalle"}
                          <ChevronDown
                            className={`size-4 transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-6">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {historyWeek.days.map((historyDay) => {
                            const breakfast =
                              historyDay.items.find(
                                (item) =>
                                  item.serviceType ===
                                  "BREAKFAST",
                              );
                            const lunch =
                              historyDay.items.find(
                                (item) =>
                                  item.serviceType ===
                                  "LUNCH",
                              );

                            return (
                              <div
                                key={historyDay.id}
                                className="rounded-2xl border border-slate-200 bg-white p-4"
                              >
                                <p className="text-sm font-bold text-[#0b3a82]">
                                  {capitalize(
                                    dayFormatter.format(
                                      new Date(
                                        historyDay.serviceDate,
                                      ),
                                    ),
                                  )}
                                </p>

                                <div className="mt-4 space-y-3">
                                  <div className="flex gap-3">
                                    <Coffee className="mt-0.5 size-4 shrink-0 text-slate-400" />
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                        Desayuno
                                      </p>
                                      <p className="mt-0.5 text-sm font-semibold text-slate-700">
                                        {breakfast?.name ??
                                          "Sin servicio"}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex gap-3">
                                    <Soup className="mt-0.5 size-4 shrink-0 text-slate-400" />
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                        Comida
                                      </p>
                                      <p className="mt-0.5 text-sm font-semibold text-slate-700">
                                        {lunch?.name ??
                                          "Sin servicio"}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="sticky bottom-4 z-20 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur sm:p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
                Planeación semanal
              </p>

              <p className="mt-1 text-sm font-semibold text-slate-700">
                {activeServices} servicio
                {activeServices === 1 ? "" : "s"}{" "}
                configurado
                {activeServices === 1 ? "" : "s"}
              </p>
            </div>

            {isEditable ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={
                    isSaving || isPublishing
                  }
                  onClick={() =>
                    void saveMenu()
                  }
                  className="flex h-12 items-center justify-center gap-2 rounded-xl border border-[#0b3a82] bg-white px-6 text-sm font-bold text-[#0b3a82] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? (
                    <LoaderCircle className="size-5 animate-spin" />
                  ) : (
                    <Save className="size-5" />
                  )}

                  {isSaving
                    ? "Guardando..."
                    : "Guardar borrador"}
                </button>

                <button
                  type="button"
                  disabled={
                    isSaving ||
                    isPublishing ||
                    activeServices === 0
                  }
                  onClick={requestPublish}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-6 text-sm font-bold text-white transition hover:bg-[#082d66] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Rocket className="size-5" />
                  Publicar semana
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="size-5" />
                Semana publicada · Edición cerrada
              </div>
            )}
          </div>
        </section>
      </div>

      {showPublishConfirmation && (
        <PublishConfirmation
          activeServices={activeServices}
          isPublishing={isPublishing}
          onCancel={() =>
            setShowPublishConfirmation(false)
          }
          onConfirm={() =>
            void publishMenu()
          }
        />
      )}
    </>
  );
}