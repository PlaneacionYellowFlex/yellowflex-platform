"use client";

import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  History,
  RotateCcw,
  Search,
  TimerReset,
  UserRound,
  UsersRound,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

type Employee = {
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

type TimeValue = {
  totalMinutes: number;
  hours: number;
  minutes: number;
  label: string;
};

type Debtor = {
  employee: Employee;
  balance: TimeValue;
};

type TimeControlSummary = {
  totals: {
    activeEmployees: number;
    employeesWithDebt: number;
    employeesWithoutDebt: number;
    pending: TimeValue;
    generated: TimeValue;
    recovered: TimeValue;
  };
  debtors: Debtor[];
};

type MovementType =
  | "DEBT"
  | "RECOVERY"
  | "CREDIT_ADJUSTMENT"
  | "DEBIT_ADJUSTMENT";

type MovementReason =
  | "LATE_ARRIVAL"
  | "ABSENCE"
  | "EARLY_DEPARTURE"
  | "PERMISSION"
  | "OTHER";

type TimeMovement = {
  id: string;
  type: MovementType;
  reason: MovementReason;
  minutes: number;
  effectiveDate: string;
  notes: string | null;
  registeredById: string | null;
  registeredBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  effectMinutes: number;
};

type EmployeeHistory = {
  employee: Employee;
  balance: TimeValue;
  movements: TimeMovement[];
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

const movementLabels: Record<MovementType, string> = {
  DEBT: "Tiempo pendiente",
  RECOVERY: "Reposición",
  CREDIT_ADJUSTMENT: "Ajuste a favor",
  DEBIT_ADJUSTMENT: "Ajuste de deuda",
};

const reasonLabels: Record<MovementReason, string> = {
  LATE_ARRIVAL: "Llegada tardía",
  ABSENCE: "Falta",
  EARLY_DEPARTURE: "Salida anticipada",
  PERMISSION: "Permiso",
  OTHER: "Otro",
};

function getToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);

  return local.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  const date = new Date(value);

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatSignedMinutes(minutes: number) {
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remaining = absolute % 60;

  if (hours > 0) {
    return `${sign}${hours} h ${remaining} min`;
  }

  return `${sign}${remaining} min`;
}

async function getApiError(response: Response) {
  try {
    const payload = (await response.json()) as ApiErrorPayload;

    return (
      payload.message ??
      payload.error ??
      "No fue posible completar la operación."
    );
  } catch {
    return "No fue posible completar la operación.";
  }
}

export default function TimeControlDashboard({
  initialEmployees,
  initialSummary,
}: {
  initialEmployees: Employee[];
  initialSummary: TimeControlSummary;
}) {
  const [employees] = useState(initialEmployees);
  const [summary, setSummary] = useState(initialSummary);
  const [search, setSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] =
    useState<string | null>(null);
  const [history, setHistory] =
    useState<EmployeeHistory | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [movementType, setMovementType] =
    useState<MovementType>("DEBT");
  const [reason, setReason] =
    useState<MovementReason>("LATE_ARRIVAL");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("");
  const [effectiveDate, setEffectiveDate] =
    useState(getToday());
  const [notes, setNotes] = useState("");

  const activeEmployees = useMemo(
    () =>
      employees.filter(
        (employee) => employee.status === "ACTIVE",
      ),
    [employees],
  );

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-MX");

    if (!term) {
      return activeEmployees.slice(0, 12);
    }

    return activeEmployees
      .filter((employee) => {
        const searchable = [
          employee.employeeNumber,
          employee.fullName,
          employee.position ?? "",
          employee.department.name,
        ]
          .join(" ")
          .toLocaleLowerCase("es-MX");

        return searchable.includes(term);
      })
      .slice(0, 20);
  }, [activeEmployees, search]);

  const selectedEmployee = useMemo(
    () =>
      activeEmployees.find(
        (employee) => employee.id === selectedEmployeeId,
      ) ?? null,
    [activeEmployees, selectedEmployeeId],
  );

  const totalMinutes =
    Math.max(0, Number.parseInt(hours || "0", 10) || 0) *
      60 +
    Math.max(
      0,
      Number.parseInt(minutes || "0", 10) || 0,
    );

  async function refreshSummary() {
    const response = await fetch("/api/rrhh/time-control", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(await getApiError(response));
    }

    const payload = (await response.json()) as {
      data: TimeControlSummary;
    };

    setSummary(payload.data);
  }

  async function loadHistory(employeeId: string) {
    setLoadingHistory(true);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/rrhh/time-control/${employeeId}`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(await getApiError(response));
      }

      const payload = (await response.json()) as {
        data: EmployeeHistory;
      };

      setHistory(payload.data);
    } catch (error) {
      setHistory(null);
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible consultar el historial.",
      });
    } finally {
      setLoadingHistory(false);
    }
  }

  async function selectEmployee(employeeId: string) {
    setSelectedEmployeeId(employeeId);
    await loadHistory(employeeId);
  }

  async function submitMovement(event: FormEvent) {
    event.preventDefault();

    if (!selectedEmployeeId) {
      setFeedback({
        type: "error",
        message: "Selecciona un colaborador.",
      });
      return;
    }

    if (totalMinutes <= 0) {
      setFeedback({
        type: "error",
        message:
          "Captura al menos un minuto para registrar el movimiento.",
      });
      return;
    }

    if (totalMinutes > 10080) {
      setFeedback({
        type: "error",
        message:
          "Un movimiento no puede superar 168 horas.",
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/rrhh/time-control/${selectedEmployeeId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: movementType,
            reason,
            minutes: totalMinutes,
            effectiveDate,
            notes,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiError(response));
      }

      await Promise.all([
        loadHistory(selectedEmployeeId),
        refreshSummary(),
      ]);

      setHours("0");
      setMinutes("");
      setNotes("");

      setFeedback({
        type: "success",
        message:
          movementType === "RECOVERY"
            ? "La reposición se registró correctamente."
            : "El movimiento de tiempo se registró correctamente.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible registrar el movimiento.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Saldo pendiente"
          value={summary.totals.pending.label}
          detail={`${summary.totals.employeesWithDebt} colaboradores con tiempo pendiente`}
          icon={Clock3}
          emphasis
        />

        <MetricCard
          label="Tiempo generado"
          value={summary.totals.generated.label}
          detail="Deuda y ajustes acumulados"
          icon={ArrowUpRight}
        />

        <MetricCard
          label="Tiempo recuperado"
          value={summary.totals.recovered.label}
          detail="Reposiciones y ajustes a favor"
          icon={ArrowDownRight}
        />

        <MetricCard
          label="Personal al corriente"
          value={`${summary.totals.employeesWithoutDebt}/${summary.totals.activeEmployees}`}
          detail="Colaboradores sin saldo pendiente"
          icon={CheckCircle2}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b3a82]">
                  Colaboradores
                </p>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">
                  Seleccionar colaborador
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Busca por nombre, número, puesto o departamento.
                </p>
              </div>

              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#0b3a82]">
                <UsersRound className="size-5" />
              </span>
            </div>

            <div className="relative mt-5">
              <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Buscar colaborador..."
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#0b3a82] focus:bg-white focus:ring-4 focus:ring-blue-50"
              />
            </div>
          </div>

          <div className="max-h-[520px] overflow-y-auto p-3">
            {filteredEmployees.map((employee) => {
              const selected =
                employee.id === selectedEmployeeId;

              const debtor = summary.debtors.find(
                (item) =>
                  item.employee.id === employee.id,
              );

              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => selectEmployee(employee.id)}
                  className={`mb-2 flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
                    selected
                      ? "border-[#0b3a82] bg-blue-50/70 shadow-sm"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${
                      selected
                        ? "bg-[#0b3a82] text-white"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <UserRound className="size-5" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900">
                      {employee.fullName}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      #{employee.employeeNumber}
                      {" · "}
                      {employee.department.name}
                    </span>
                  </span>

                  {debtor && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                      {debtor.balance.label}
                    </span>
                  )}
                </button>
              );
            })}

            {filteredEmployees.length === 0 && (
              <div className="px-4 py-12 text-center">
                <Search className="mx-auto size-6 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  Sin coincidencias
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Intenta con otro nombre o número de empleado.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {!selectedEmployee ? (
            <EmptyEmployeeState />
          ) : (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#0b3a82] text-white shadow-sm">
                      <UserRound className="size-6" />
                    </span>

                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                        Colaborador seleccionado
                      </p>
                      <h2 className="mt-1 truncate text-xl font-bold text-slate-950">
                        {selectedEmployee.fullName}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        #{selectedEmployee.employeeNumber}
                        {" · "}
                        {selectedEmployee.department.name}
                      </p>
                      {selectedEmployee.position && (
                        <p className="mt-1 text-xs text-slate-400">
                          {selectedEmployee.position}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4 sm:text-right">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">
                      Saldo pendiente
                    </p>
                    <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                      {loadingHistory
                        ? "..."
                        : history?.balance.label ?? "0 min"}
                    </p>
                  </div>
                </div>
              </section>

              <form
                onSubmit={submitMovement}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b3a82]">
                      Nuevo movimiento
                    </p>
                    <h3 className="mt-1 text-lg font-bold text-slate-950">
                      Registrar tiempo
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Captura una incidencia, reposición o ajuste.
                    </p>
                  </div>

                  <span className="flex size-11 items-center justify-center rounded-2xl bg-amber-50 text-[#b77900]">
                    <TimerReset className="size-5" />
                  </span>
                </div>

                <div className="mt-6 grid gap-5 md:grid-cols-2">
                  <Field label="Movimiento">
                    <select
                      value={movementType}
                      onChange={(event) =>
                        setMovementType(
                          event.target.value as MovementType,
                        )
                      }
                      className={inputClass}
                    >
                      <option value="DEBT">
                        Tiempo pendiente
                      </option>
                      <option value="RECOVERY">
                        Reposición
                      </option>
                      <option value="DEBIT_ADJUSTMENT">
                        Ajuste de deuda
                      </option>
                      <option value="CREDIT_ADJUSTMENT">
                        Ajuste a favor
                      </option>
                    </select>
                  </Field>

                  <Field label="Motivo">
                    <select
                      value={reason}
                      onChange={(event) =>
                        setReason(
                          event.target.value as MovementReason,
                        )
                      }
                      className={inputClass}
                    >
                      <option value="LATE_ARRIVAL">
                        Llegada tardía
                      </option>
                      <option value="ABSENCE">Falta</option>
                      <option value="EARLY_DEPARTURE">
                        Salida anticipada
                      </option>
                      <option value="PERMISSION">
                        Permiso
                      </option>
                      <option value="OTHER">Otro</option>
                    </select>
                  </Field>

                  <Field label="Horas">
                    <input
                      type="number"
                      min="0"
                      max="168"
                      step="1"
                      value={hours}
                      onChange={(event) =>
                        setHours(event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Minutos">
                    <input
                      type="number"
                      min="0"
                      max="59"
                      step="1"
                      value={minutes}
                      onChange={(event) =>
                        setMinutes(event.target.value)
                      }
                      placeholder="0"
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Fecha">
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(event) =>
                        setEffectiveDate(event.target.value)
                      }
                      required
                      className={inputClass}
                    />
                  </Field>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                    <p className="text-xs font-semibold text-slate-500">
                      Tiempo a registrar
                    </p>
                    <p className="mt-1 text-xl font-black text-[#0b3a82]">
                      {totalMinutes > 0
                        ? formatSignedMinutes(totalMinutes).replace(
                            "+",
                            "",
                          )
                        : "0 min"}
                    </p>
                  </div>

                  <div className="md:col-span-2">
                    <Field label="Notas">
                      <textarea
                        value={notes}
                        onChange={(event) =>
                          setNotes(event.target.value)
                        }
                        rows={3}
                        maxLength={1000}
                        placeholder="Detalle adicional de la incidencia o reposición..."
                        className={`${inputClass} h-auto resize-none py-3`}
                      />
                    </Field>
                  </div>
                </div>

                {feedback && (
                  <div
                    className={`mt-5 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
                      feedback.type === "success"
                        ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                        : "border-red-100 bg-red-50 text-red-700"
                    }`}
                  >
                    {feedback.type === "success" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span>{feedback.message}</span>
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-slate-400">
                    Los movimientos quedan registrados en el historial
                    del colaborador.
                  </p>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#0b3a82] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#082e68] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? (
                      <RotateCcw className="size-4 animate-spin" />
                    ) : (
                      <Clock3 className="size-4" />
                    )}
                    {submitting
                      ? "Registrando..."
                      : "Registrar movimiento"}
                  </button>
                </div>
              </form>

              <HistoryPanel
                history={history}
                loading={loadingHistory}
              />
            </>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b3a82]">
              Seguimiento RH
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">
              Saldos pendientes
            </h2>
          </div>

          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
            {summary.totals.employeesWithDebt} pendientes
          </span>
        </div>

        {summary.debtors.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CheckCircle2 className="mx-auto size-8 text-emerald-500" />
            <p className="mt-3 font-bold text-slate-900">
              Todo el personal está al corriente
            </p>
            <p className="mt-1 text-sm text-slate-500">
              No existen saldos de tiempo pendientes.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-6 py-4">Colaborador</th>
                  <th className="px-6 py-4">Departamento</th>
                  <th className="px-6 py-4">Puesto</th>
                  <th className="px-6 py-4 text-right">
                    Saldo
                  </th>
                  <th className="px-6 py-4 text-right">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.debtors.map((item) => (
                  <tr
                    key={item.employee.id}
                    className="transition hover:bg-slate-50/70"
                  >
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-slate-900">
                        {item.employee.fullName}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        #{item.employee.employeeNumber}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {item.employee.department.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {item.employee.position ?? "Sin puesto"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">
                        {item.balance.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          selectEmployee(item.employee.id)
                        }
                        className="text-sm font-bold text-[#0b3a82] hover:underline"
                      >
                        Administrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-50";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  emphasis = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Clock3;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border bg-white p-5 shadow-sm ${
        emphasis
          ? "border-amber-200"
          : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            {value}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {detail}
          </p>
        </div>

        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${
            emphasis
              ? "bg-amber-50 text-[#b77900]"
              : "bg-blue-50 text-[#0b3a82]"
          }`}
        >
          <Icon className="size-5" />
        </span>
      </div>
    </div>
  );
}

function EmptyEmployeeState() {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <div>
        <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-blue-50 text-[#0b3a82]">
          <UserRound className="size-7" />
        </span>
        <h2 className="mt-5 text-xl font-bold text-slate-950">
          Selecciona un colaborador
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
          Consulta su saldo, registra tiempo pendiente o
          reposiciones y revisa la trazabilidad completa.
        </p>
      </div>
    </div>
  );
}

function HistoryPanel({
  history,
  loading,
}: {
  history: EmployeeHistory | null;
  loading: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b3a82]">
            Trazabilidad
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-950">
            Historial de movimientos
          </h3>
        </div>

        <span className="flex size-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <History className="size-5" />
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 px-6 py-12 text-sm text-slate-500">
          <RotateCcw className="size-4 animate-spin" />
          Consultando historial...
        </div>
      ) : !history || history.movements.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <History className="mx-auto size-7 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">
            Sin movimientos registrados
          </p>
          <p className="mt-1 text-xs text-slate-400">
            La trazabilidad aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {history.movements.map((movement) => {
            const increasesDebt = movement.effectMinutes > 0;

            return (
              <div
                key={movement.id}
                className="flex gap-4 px-6 py-5"
              >
                <span
                  className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl ${
                    increasesDebt
                      ? "bg-amber-50 text-amber-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {increasesDebt ? (
                    <ArrowUpRight className="size-4" />
                  ) : (
                    <ArrowDownRight className="size-4" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-bold text-slate-900">
                      {movementLabels[movement.type]}
                    </p>

                    <p
                      className={`text-sm font-black ${
                        increasesDebt
                          ? "text-amber-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {formatSignedMinutes(
                        movement.effectMinutes,
                      )}
                    </p>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>
                      {reasonLabels[movement.reason]}
                    </span>
                    <span>·</span>
                    <span>
                      {formatDate(movement.effectiveDate)}
                    </span>
                  </div>

                  {movement.notes && (
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {movement.notes}
                    </p>
                  )}

                  <p className="mt-2 text-[11px] text-slate-400">
                    {movement.registeredBy
                      ? `Registrado por ${movement.registeredBy.name}`
                      : "Registro administrativo RH"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}