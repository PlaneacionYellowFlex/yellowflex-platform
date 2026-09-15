"use client";

import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Save,
  UserRound,
  Utensils,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ServiceType = "BREAKFAST" | "LUNCH";

type MenuItem = {
  id: string;
  serviceType: ServiceType;
  name: string;
  description: string | null;
  price: string;
};

type MenuDay = {
  serviceDate: string;
  items: MenuItem[];
};

type MenuWeek = {
  id: string;
  weekStart: string;
  days: MenuDay[];
};

type EmployeeProfile = {
  employeeNumber: string;
  fullName: string;
  position: string;
  department: {
    code: string;
    name: string;
  };
  workShift: {
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
  };
};

type FoodPolicy = {
  isNightShift: boolean;
  workdays: number[];
  maximumServicesPerDay: number;
  allowedServiceTypes: ServiceType[];
  serviceLabel: string;
};

type OrderSummary = {
  id: string;
  status: string;
  itemCount: number;
  unitPrice: string;
  totalAmount: string;
  confirmedAt: string;
};

type ReservationState = {
  weekStart: string;
  isOpen: boolean;
  pinMustChange: boolean;
  menuItemIds: string[];
  employee: EmployeeProfile;
  policy: FoodPolicy;
  isConfirmed: boolean;
  order: OrderSummary | null;
};

const serviceLabels: Record<ServiceType, string> = {
  BREAKFAST: "Desayuno",
  LUNCH: "Comida",
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function formatWeek(date: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

function formatDay(date: string) {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(date));
}

function getUtcWeekday(date: string) {
  return new Date(date).getUTCDay();
}

function sameDate(first: string, second: string) {
  return new Date(first).getTime() === new Date(second).getTime();
}

export default function EmployeeAccess() {
  const [message, setMessage] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmationStep, setConfirmationStep] = useState<0 | 1 | 2>(0);
  const [menu, setMenu] = useState<MenuWeek[]>();
  const [reservationState, setReservationState] =
    useState<ReservationState>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  async function loadWeeklyData() {
    const [menuResponse, reservationsResponse] =
      await Promise.all([
        fetch("/api/food-services/menu", {
          cache: "no-store",
        }),
        fetch("/api/food-services/reservations", {
          cache: "no-store",
        }),
      ]);

    const menuPayload = (await menuResponse.json()) as {
      data?: MenuWeek[];
      error?: string;
    };

    const reservationsPayload =
      (await reservationsResponse.json()) as {
        data?: ReservationState;
        error?: string;
      };

    if (!menuResponse.ok) {
      throw new Error(
        menuPayload.error ??
          "No fue posible consultar el menú.",
      );
    }

    if (!reservationsResponse.ok) {
      throw new Error(
        reservationsPayload.error ??
          "No fue posible consultar tus reservaciones.",
      );
    }

    const state = reservationsPayload.data;

    setMenu(menuPayload.data ?? []);

    if (state) {
      setReservationState(state);
      setSelectedIds(state.menuItemIds);
      setConfirmationStep(0);
    }
  }

  useEffect(() => {
    let active = true;

    async function restoreExistingSession() {
      try {
        await loadWeeklyData();
      } catch {
        // No existe una sesión Food Services válida.
        // Se conserva el acceso tradicional mediante número de empleado y PIN.
      } finally {
        if (active) {
          setIsCheckingSession(false);
        }
      }
    }

    void restoreExistingSession();

    return () => {
      active = false;
    };
  }, []);

  async function submit(formData: FormData) {
    try {
      setIsLoading(true);
      setMessage(undefined);

      const response = await fetch(
        "/api/food-services/employee-access",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            employeeNumber:
              formData.get("employeeNumber"),
            pin: formData.get("pin"),
          }),
        },
      );

      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "No fue posible validar el acceso.",
        );
      }

      await loadWeeklyData();

      setMessage(
        "Identificación confirmada. Tu menú se ajustó automáticamente a tu turno.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible validar el acceso.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function changePersonalPin() {
    if (!/^\d{6}$/.test(newPin)) {
      setMessage(
        "Tu nuevo PIN debe contener exactamente 6 dígitos.",
      );
      return;
    }

    if (newPin !== confirmPin) {
      setMessage("Los PIN no coinciden.");
      return;
    }

    try {
      setIsChangingPin(true);
      setMessage(undefined);

      const response = await fetch(
        "/api/food-services/change-pin",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            newPin,
            confirmPin,
          }),
        },
      );

      const payload = (await response.json()) as {
        data?: {
          changed: boolean;
          pinMustChange: boolean;
          pinUpdatedAt: string;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "No fue posible crear tu PIN personal.",
        );
      }

      setNewPin("");
      setConfirmPin("");

      await loadWeeklyData();

      setMessage(
        "PIN personal creado correctamente. Tu acceso ya está habilitado.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible crear tu PIN personal.",
      );
    } finally {
      setIsChangingPin(false);
    }
  }
  const targetWeek =
    menu && reservationState
      ? menu.find((week) =>
          sameDate(
            week.weekStart,
            reservationState.weekStart,
          ),
        )
      : undefined;

  const visibleDays = useMemo(() => {
    if (!targetWeek || !reservationState) {
      return [];
    }

    return targetWeek.days
      .filter((day) =>
        reservationState.policy.workdays.includes(
          getUtcWeekday(day.serviceDate),
        ),
      )
      .map((day) => ({
        ...day,
        items: day.items.filter((item) =>
          reservationState.policy.allowedServiceTypes.includes(
            item.serviceType,
          ),
        ),
      }));
  }, [targetWeek, reservationState]);

  const visibleItemIds = useMemo(
    () =>
      new Set(
        visibleDays.flatMap((day) =>
          day.items.map((item) => item.id),
        ),
      ),
    [visibleDays],
  );

  const visibleSelectedIds = selectedIds.filter((id) =>
    visibleItemIds.has(id),
  );

  const selectedTotal = useMemo(() => {
    if (!targetWeek) {
      return 0;
    }

    const priceById = new Map(
      targetWeek.days.flatMap((day) =>
        day.items.map(
          (item) =>
            [item.id, Number(item.price)] as const,
        ),
      ),
    );

    return selectedIds.reduce(
      (total, id) =>
        total + (priceById.get(id) ?? 0),
      0,
    );
  }, [selectedIds, targetWeek]);

  function selectItem(
    item: MenuItem,
    parentDay: MenuDay,
  ) {
    if (
      !reservationState?.isOpen ||
      reservationState.isConfirmed
    ) {
      return;
    }

    const policy = reservationState.policy;

    if (
      !policy.allowedServiceTypes.includes(
        item.serviceType,
      ) ||
      !policy.workdays.includes(
        getUtcWeekday(parentDay.serviceDate),
      )
    ) {
      return;
    }

    setSelectedIds((current) => {
      if (current.includes(item.id)) {
        return current.filter(
          (id) => id !== item.id,
        );
      }

      const dayItemIds = parentDay.items.map(
        (candidate) => candidate.id,
      );

      const selectedForDay = current.filter((id) =>
        dayItemIds.includes(id),
      );

      if (
        selectedForDay.length >=
        policy.maximumServicesPerDay
      ) {
        if (policy.maximumServicesPerDay === 1) {
          return [
            ...current.filter(
              (id) => !dayItemIds.includes(id),
            ),
            item.id,
          ];
        }

        return current;
      }

      const sameServiceIds = parentDay.items
        .filter(
          (candidate) =>
            candidate.serviceType ===
            item.serviceType,
        )
        .map((candidate) => candidate.id);

      return [
        ...current.filter(
          (id) => !sameServiceIds.includes(id),
        ),
        item.id,
      ];
    });

    setMessage(undefined);
  }

  async function saveWeek() {
    try {
      setIsSaving(true);
      setMessage(undefined);

      const response = await fetch(
        "/api/food-services/reservations",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            menuItemIds: selectedIds,
          }),
        },
      );

      const payload = (await response.json()) as {
        data?: {
          selectedCount: number;
          weekStart: string;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "No fue posible guardar tu selección semanal.",
        );
      }

      setConfirmationStep(1);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible guardar tu selección semanal.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmOrder() {
    try {
      setIsConfirming(true);
      setMessage(undefined);

      const response = await fetch(
        "/api/food-services/reservations/confirm",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            menuItemIds: selectedIds,
          }),
        },
      );

      const payload = (await response.json()) as {
        data?: {
          id: string;
          itemCount: number;
          totalAmount: string;
          confirmedAt: string;
          isConfirmed: boolean;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "No fue posible confirmar tu pedido.",
        );
      }

      await loadWeeklyData();

      setMessage(
        `Pedido confirmado. ${payload.data?.itemCount ?? selectedIds.length} platillo(s) · Total de nómina ${moneyFormatter.format(Number(payload.data?.totalAmount ?? selectedTotal))}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No fue posible confirmar tu pedido.",
      );
    } finally {
      setIsConfirming(false);
      setConfirmationStep(0);
    }
  }

  return (
    <div className="space-y-6">
      {!menu && isCheckingSession && (
        <div className="flex min-h-40 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70">
          <div className="text-center">
            <LoaderCircle className="mx-auto size-6 animate-spin text-[#0b3a82]" />
            <p className="mt-3 text-sm font-semibold text-slate-600">
              Validando tu sesión...
            </p>
          </div>
        </div>
      )}

      {!menu && !isCheckingSession && (
        <form action={submit} className="space-y-5">
          <div>
            <label
              htmlFor="employeeNumber"
              className="text-sm font-semibold text-slate-700"
            >
              Número de empleado
            </label>

            <input
              id="employeeNumber"
              name="employeeNumber"
              required
              inputMode="numeric"
              autoComplete="username"
              className="mt-2 h-13 w-full rounded-xl border border-slate-300 px-4 text-lg outline-none transition focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div>
            <label
              htmlFor="pin"
              className="text-sm font-semibold text-slate-700"
            >
              PIN personal
            </label>

            <input
              id="pin"
              name="pin"
              required
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              pattern="[0-9]*"
              className="mt-2 h-13 w-full rounded-xl border border-slate-300 px-4 text-lg outline-none transition focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <button
            disabled={isLoading}
            className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-5 text-base font-bold text-white transition hover:bg-[#082d66] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <LockKeyhole className="size-5" />
            )}

            {isLoading
              ? "Validando..."
              : "Ver mi menú semanal"}
          </button>
        </form>
      )}

      {message && (
        <p
          role="status"
          className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm leading-6 text-slate-600"
        >
          {message}
        </p>
      )}

      {menu && reservationState?.pinMustChange && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-[#0b3a82] to-[#164f9d] px-6 py-6 text-white">
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#f4b400] ring-1 ring-white/20">
                <ShieldCheck className="size-6" />
              </span>

              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-100">
                  Activación de credencial
                </p>

                <h2 className="mt-2 text-xl font-bold">
                  Crea tu PIN personal
                </h2>

                <p className="mt-2 text-sm leading-6 text-blue-100">
                  Tu acceso temporal fue validado. Ahora crea un PIN personal de 6 dígitos.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-5 p-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Colaborador identificado
              </p>

              <p className="mt-2 font-bold text-slate-900">
                {reservationState.employee.fullName}
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Número de empleado {reservationState.employee.employeeNumber}
              </p>
            </div>

            <div>
              <label
                htmlFor="newPersonalPin"
                className="text-sm font-semibold text-slate-700"
              >
                Nuevo PIN
              </label>

              <input
                id="newPersonalPin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={newPin}
                onChange={(event) =>
                  setNewPin(
                    event.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6),
                  )
                }
                placeholder="6 dígitos"
                className="mt-2 h-13 w-full rounded-xl border border-slate-300 px-4 text-lg tracking-[0.25em] outline-none transition focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPersonalPin"
                className="text-sm font-semibold text-slate-700"
              >
                Confirmar PIN
              </label>

              <input
                id="confirmPersonalPin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={confirmPin}
                onChange={(event) =>
                  setConfirmPin(
                    event.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6),
                  )
                }
                placeholder="Repite los 6 dígitos"
                className="mt-2 h-13 w-full rounded-xl border border-slate-300 px-4 text-lg tracking-[0.25em] outline-none transition focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <button
              type="button"
              onClick={changePersonalPin}
              disabled={
                isChangingPin ||
                newPin.length !== 6 ||
                confirmPin.length !== 6
              }
              className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-5 text-base font-bold text-white transition hover:bg-[#082d66] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isChangingPin ? (
                <LoaderCircle className="size-5 animate-spin" />
              ) : (
                <ShieldCheck className="size-5" />
              )}

              {isChangingPin
                ? "Creando PIN..."
                : "Crear mi PIN personal"}
            </button>

            <p className="text-center text-xs leading-5 text-slate-400">
              Este PIN sustituirá la credencial temporal utilizada para tu primer acceso.
            </p>
          </div>
        </section>
      )}
      {menu && reservationState && !reservationState.pinMustChange && (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-gradient-to-r from-[#0b3a82] to-[#164f9d] px-5 py-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-100">
                    Colaborador identificado
                  </p>
                  <h2 className="mt-2 text-xl font-bold">
                    {reservationState.employee.fullName}
                  </h2>
                  <p className="mt-1 text-sm text-blue-100">
                    Nómina{" "}
                    {
                      reservationState.employee
                        .employeeNumber
                    }
                  </p>
                </div>

                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#f4b400] ring-1 ring-white/20">
                  <UserRound className="size-5" />
                </span>
              </div>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="flex gap-3 rounded-xl bg-slate-50 p-3">
                <BriefcaseBusiness className="mt-0.5 size-4 shrink-0 text-[#0b3a82]" />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Puesto
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {reservationState.employee.position}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 rounded-xl bg-slate-50 p-3">
                <Building2 className="mt-0.5 size-4 shrink-0 text-[#0b3a82]" />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Departamento
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {
                      reservationState.employee
                        .department.name
                    }
                  </p>
                </div>
              </div>

              <div className="flex gap-3 rounded-xl bg-slate-50 p-3 sm:col-span-2">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-[#f4b400]" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Turno
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {
                      reservationState.employee
                        .workShift.code
                    }{" "}
                    ·{" "}
                    {
                      reservationState.employee
                        .workShift.name
                    }
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {
                      reservationState.employee
                        .workShift.startTime
                    }{" "}
                    –{" "}
                    {
                      reservationState.employee
                        .workShift.endTime
                    }{" "}
                    ·{" "}
                    {
                      reservationState.policy
                        .serviceLabel
                    }
                  </p>
                </div>
              </div>
            </div>
          </section>

          <div
            className={`rounded-2xl border p-4 ${
              reservationState.isConfirmed
                ? "border-blue-200 bg-blue-50"
                : reservationState.isOpen
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex items-start gap-3">
              {reservationState.isConfirmed ? (
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#0b3a82]" />
              ) : (
                <CalendarDays
                  className={`mt-0.5 size-5 shrink-0 ${
                    reservationState.isOpen
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }`}
                />
              )}

              <div>
                <p className="font-bold text-slate-900">
                  {reservationState.isConfirmed
                    ? "Pedido confirmado"
                    : reservationState.isOpen
                      ? "Reservaciones abiertas"
                      : "Reservaciones cerradas"}
                </p>

                <p className="mt-1 text-sm leading-5 text-slate-600">
                  {reservationState.isConfirmed
                    ? "Tu pedido quedó registrado definitivamente y ya no puede modificarse."
                    : reservationState.isOpen
                      ? "Puedes modificar tu selección hasta confirmar definitivamente tu pedido o hasta el sábado a las 11:59 p. m."
                      : "La selección semanal ya no puede modificarse."}
                </p>
              </div>
            </div>
          </div>

          {!targetWeek ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-500">
              El Chef todavía no ha publicado el menú
              correspondiente a la próxima semana.
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b47c00]">
                  Próxima semana
                </p>

                <h2 className="mt-1 text-xl font-bold text-[#0b3a82]">
                  Semana del{" "}
                  {formatWeek(targetWeek.weekStart)}
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {reservationState.policy.isNightShift
                    ? "Tu jornada nocturna permite un alimento de turno por cada día laboral."
                    : "Puedes seleccionar desayuno, comida, ambos o ninguno en cada uno de tus días laborales."}
                </p>
              </div>

              {visibleDays.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-500">
                  No hay servicios publicados para los días
                  correspondientes a tu turno.
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleDays.map((day) => (
                    <section
                      key={day.serviceDate}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="text-sm font-bold capitalize text-[#0b3a82]">
                          {formatDay(day.serviceDate)}
                        </p>

                        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 ring-1 ring-slate-200">
                          Día laboral
                        </span>
                      </div>

                      <div className="space-y-5 p-4">
                        {reservationState.policy.allowedServiceTypes.map(
                          (serviceType) => {
                            const options =
                              day.items.filter(
                                (item) =>
                                  item.serviceType ===
                                  serviceType,
                              );

                            if (
                              options.length === 0
                            ) {
                              return null;
                            }

                            const label =
                              reservationState.policy
                                .isNightShift
                                ? reservationState
                                    .policy
                                    .serviceLabel
                                : serviceLabels[
                                    serviceType
                                  ];

                            return (
                              <div key={serviceType}>
                                <div className="mb-2 flex items-center gap-2">
                                  <Utensils className="size-4 text-[#f4b400]" />
                                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                    {label}
                                  </p>
                                </div>

                                <div className="space-y-2">
                                  {options.map(
                                    (item) => {
                                      const selected =
                                        selectedIds.includes(
                                          item.id,
                                        );

                                      return (
                                        <button
                                          key={
                                            item.id
                                          }
                                          type="button"
                                          disabled={
                                            !reservationState.isOpen ||
                                            reservationState.isConfirmed
                                          }
                                          onClick={() =>
                                            selectItem(
                                              item,
                                              day,
                                            )
                                          }
                                          className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition ${
                                            selected
                                              ? "border-[#0b3a82] bg-blue-50 ring-1 ring-[#0b3a82]"
                                              : "border-slate-200 bg-white hover:border-slate-300"
                                          } disabled:cursor-not-allowed disabled:opacity-70`}
                                        >
                                          <div className="min-w-0">
                                            <p className="text-sm font-bold text-slate-900">
                                              {
                                                item.name
                                              }
                                            </p>

                                            {item.description && (
                                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                                {
                                                  item.description
                                                }
                                              </p>
                                            )}

                                            <p className="mt-2 text-xs font-bold text-[#0b3a82]">
                                              {moneyFormatter.format(
                                                Number(
                                                  item.price,
                                                ),
                                              )}
                                            </p>
                                          </div>

                                          <span
                                            className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
                                              selected
                                                ? "border-[#0b3a82] bg-[#0b3a82] text-white"
                                                : "border-slate-300 text-transparent"
                                            }`}
                                          >
                                            <Check className="size-4" />
                                          </span>
                                        </button>
                                      );
                                    },
                                  )}
                                </div>
                              </div>
                            );
                          },
                        )}

                        {day.items.length === 0 && (
                          <p className="text-sm text-slate-400">
                            No hay alimentos disponibles
                            para este día.
                          </p>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              )}

              <div className="sticky bottom-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {reservationState.isConfirmed
                        ? "Pedido definitivo"
                        : "Selección semanal"}
                    </p>

                    <p className="text-lg font-bold text-[#0b3a82]">
                      {visibleSelectedIds.length}{" "}
                      {visibleSelectedIds.length === 1
                        ? "platillo"
                        : "platillos"}
                    </p>

                    <p className="mt-1 text-sm font-semibold text-slate-600">
                      Total de nómina:{" "}
                      <span className="text-[#0b3a82]">
                        {moneyFormatter.format(
                          reservationState.order
                            ? Number(
                                reservationState.order
                                  .totalAmount,
                              )
                            : selectedTotal,
                        )}
                      </span>
                    </p>
                  </div>

                  {reservationState.isConfirmed ? (
                    <ShieldCheck className="size-7 text-[#0b3a82]" />
                  ) : visibleSelectedIds.length > 0 ? (
                    <CheckCircle2 className="size-6 text-emerald-600" />
                  ) : null}
                </div>

                {reservationState.isConfirmed ? (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                    <p className="text-sm font-bold text-[#0b3a82]">
                      Pedido bloqueado
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      El importe mostrado corresponde al descuento de nómina asociado a los platillos confirmados.
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={saveWeek}
                    disabled={
                      isSaving ||
                      !reservationState.isOpen ||
                      visibleSelectedIds.length === 0
                    }
                    className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-5 text-sm font-bold text-white transition hover:bg-[#082d66] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaving ? (
                      <LoaderCircle className="size-5 animate-spin" />
                    ) : (
                      <Save className="size-5" />
                    )}

                    {isSaving
                      ? "Preparando pedido..."
                      : "Revisar y confirmar mi pedido"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {confirmationStep > 0 &&
        reservationState &&
        !reservationState.isConfirmed && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-100 px-6 py-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-[#0b3a82]">
                    {confirmationStep === 1 ? (
                      <CheckCircle2 className="size-6" />
                    ) : (
                      <LockKeyhole className="size-6" />
                    )}
                  </span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b47c00]">
                      Confirmación {confirmationStep} de 2
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-slate-900">
                      {confirmationStep === 1
                        ? "¿Estás seguro de tu pedido?"
                        : "Confirmación definitiva"}
                    </h3>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Platillos
                    </p>
                    <p className="mt-1 text-xl font-bold text-[#0b3a82]">
                      {visibleSelectedIds.length}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Total
                    </p>
                    <p className="mt-1 text-xl font-bold text-[#0b3a82]">
                      {moneyFormatter.format(selectedTotal)}
                    </p>
                  </div>
                </div>

                <p className="text-sm leading-6 text-slate-600">
                  {confirmationStep === 1
                    ? "Revisa la cantidad de platillos y el total antes de continuar."
                    : "Al confirmar, tu pedido quedará bloqueado y el importe se considerará para descuento de nómina. Esta acción no puede deshacerse."}
                </p>

                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={isConfirming}
                    onClick={() =>
                      setConfirmationStep(
                        confirmationStep === 2 ? 1 : 0,
                      )
                    }
                    className="h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {confirmationStep === 1
                      ? "Regresar y revisar"
                      : "Volver"}
                  </button>

                  <button
                    type="button"
                    disabled={isConfirming}
                    onClick={() => {
                      if (confirmationStep === 1) {
                        setConfirmationStep(2);
                        return;
                      }

                      void confirmOrder();
                    }}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-4 text-sm font-bold text-white transition hover:bg-[#082d66] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isConfirming ? (
                      <LoaderCircle className="size-5 animate-spin" />
                    ) : confirmationStep === 1 ? (
                      <Check className="size-5" />
                    ) : (
                      <LockKeyhole className="size-5" />
                    )}

                    {isConfirming
                      ? "Confirmando..."
                      : confirmationStep === 1
                        ? "Sí, continuar"
                        : "Confirmar pedido"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}