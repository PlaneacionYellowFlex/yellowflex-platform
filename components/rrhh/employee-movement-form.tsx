"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Clock3,
  FileText,
  LoaderCircle,
  RotateCcw,
  Save,
  TrendingUp,
  UserMinus,
} from "lucide-react";

type EmployeeStatus = "ACTIVE" | "INACTIVE";

type MovementType =
  | "POSITION_CHANGE"
  | "DEPARTMENT_CHANGE"
  | "SHIFT_CHANGE"
  | "PROMOTION"
  | "TERMINATION"
  | "REHIRE";

type Department = {
  id: string;
  code: string;
  name: string;
};

type WorkShift = {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
};

type CatalogsResponse = {
  data?: {
    departments: Department[];
    workShifts: WorkShift[];
  };
  error?: string;
};

type ApiResponse = {
  data?: unknown;
  error?: string;
  code?: string;
  details?: Record<string, string[] | undefined>;
};

type EmployeeMovementFormProps = {
  employeeId: string;
  employeeStatus: EmployeeStatus;
  currentPosition: string | null;
  currentDepartmentId: string;
  currentWorkShiftId: string | null;
};

export default function EmployeeMovementForm({
  employeeId,
  employeeStatus,
  currentPosition,
  currentDepartmentId,
  currentWorkShiftId,
}: EmployeeMovementFormProps) {
  const router = useRouter();

  const initialType: MovementType =
    employeeStatus === "ACTIVE"
      ? "POSITION_CHANGE"
      : "REHIRE";

  const [type, setType] = useState<MovementType>(initialType);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [newDepartmentId, setNewDepartmentId] = useState("");
  const [newWorkShiftId, setNewWorkShiftId] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [workShifts, setWorkShifts] = useState<WorkShift[]>([]);

  const [loadingCatalogs, setLoadingCatalogs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalogs() {
      setLoadingCatalogs(true);

      try {
        const response = await fetch("/api/rrhh/catalogs", {
          method: "GET",
          cache: "no-store",
        });

        const payload =
          (await response.json()) as CatalogsResponse;

        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error ??
              "No fue posible cargar los catálogos de RH.",
          );
        }

        if (!cancelled) {
          setDepartments(payload.data.departments);
          setWorkShifts(payload.data.workShifts);
        }
      } catch (catalogError) {
        if (!cancelled) {
          setError(
            catalogError instanceof Error
              ? catalogError.message
              : "No fue posible cargar los catálogos de RH.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingCatalogs(false);
        }
      }
    }

    void loadCatalogs();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDepartment = useMemo(
    () =>
      departments.find(
        (department) => department.id === newDepartmentId,
      ) ?? null,
    [departments, newDepartmentId],
  );

  const selectedWorkShift = useMemo(
    () =>
      workShifts.find(
        (workShift) => workShift.id === newWorkShiftId,
      ) ?? null,
    [workShifts, newWorkShiftId],
  );

  const requiresPosition =
    type === "POSITION_CHANGE" || type === "PROMOTION";

  const requiresDepartment =
    type === "DEPARTMENT_CHANGE" || type === "REHIRE";

  const requiresWorkShift = type === "SHIFT_CHANGE";

  const showPosition =
    requiresPosition ||
    type === "REHIRE";

  const showDepartment =
    requiresDepartment ||
    type === "PROMOTION";

  const showWorkShift =
    requiresWorkShift ||
    type === "PROMOTION" ||
    type === "REHIRE";

  const requiresReason = type === "TERMINATION";

  function handleTypeChange(nextType: MovementType) {
    setType(nextType);
    setMessage(null);
    setError(null);

    setNewPosition("");
    setNewDepartmentId("");
    setNewWorkShiftId("");
    setReason("");
    setNotes("");
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setMessage(null);
    setError(null);

    if (!effectiveDate) {
      setError("La fecha efectiva es obligatoria.");
      return;
    }

    if (requiresPosition && !newPosition.trim()) {
      setError("El nuevo puesto es obligatorio.");
      return;
    }

    if (requiresDepartment && !newDepartmentId) {
      setError("El nuevo departamento es obligatorio.");
      return;
    }

    if (requiresWorkShift && !newWorkShiftId) {
      setError("El nuevo turno es obligatorio.");
      return;
    }

    if (requiresReason && !reason.trim()) {
      setError("El motivo de baja es obligatorio.");
      return;
    }

    if (type === "TERMINATION") {
      const confirmed = window.confirm(
        "Esta acción cambiará el estatus del colaborador a INACTIVO. ¿Deseas registrar la baja?",
      );

      if (!confirmed) {
        return;
      }
    }

    setSaving(true);

    try {
      const response = await fetch(
        `/api/rrhh/employees/${employeeId}/movements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type,
            effectiveDate,
            reason,
            notes,
            newPosition,
            newDepartmentId,
            newWorkShiftId,
          }),
        },
      );

      const payload = (await response.json()) as ApiResponse;

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "No fue posible registrar el movimiento.",
        );
      }

      setMessage("Movimiento registrado correctamente.");

      setReason("");
      setNotes("");
      setNewPosition("");
      setNewDepartmentId("");
      setNewWorkShiftId("");

      router.refresh();
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : "No fue posible registrar el movimiento.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <p className="text-sm font-bold text-slate-700">
          Tipo de movimiento
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {employeeStatus === "ACTIVE" ? (
            <>
              <MovementButton
                active={type === "POSITION_CHANGE"}
                label="Cambio de puesto"
                icon={BriefcaseBusiness}
                onClick={() =>
                  handleTypeChange("POSITION_CHANGE")
                }
              />

              <MovementButton
                active={type === "DEPARTMENT_CHANGE"}
                label="Cambio de departamento"
                icon={Building2}
                onClick={() =>
                  handleTypeChange("DEPARTMENT_CHANGE")
                }
              />

              <MovementButton
                active={type === "SHIFT_CHANGE"}
                label="Cambio de turno"
                icon={Clock3}
                onClick={() =>
                  handleTypeChange("SHIFT_CHANGE")
                }
              />

              <MovementButton
                active={type === "PROMOTION"}
                label="Promoción"
                icon={TrendingUp}
                onClick={() => handleTypeChange("PROMOTION")}
              />

              <MovementButton
                active={type === "TERMINATION"}
                label="Baja"
                icon={UserMinus}
                onClick={() =>
                  handleTypeChange("TERMINATION")
                }
                danger
              />
            </>
          ) : (
            <MovementButton
              active={type === "REHIRE"}
              label="Reingreso"
              icon={RotateCcw}
              onClick={() => handleTypeChange("REHIRE")}
            />
          )}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Fecha efectiva"
          icon={CalendarDays}
          required
        >
          <input
            type="date"
            value={effectiveDate}
            onChange={(event) =>
              setEffectiveDate(event.target.value)
            }
            required
            className={inputClassName}
          />
        </FormField>

        {showPosition && (
          <FormField
            label={
              type === "REHIRE"
                ? "Puesto al reingreso"
                : "Nuevo puesto"
            }
            icon={BriefcaseBusiness}
            required={requiresPosition}
          >
            <input
              type="text"
              value={newPosition}
              onChange={(event) =>
                setNewPosition(event.target.value)
              }
              maxLength={150}
              required={requiresPosition}
              placeholder={currentPosition ?? "Nuevo puesto"}
              className={inputClassName}
            />
          </FormField>
        )}

        {showDepartment && (
          <FormField
            label={
              type === "REHIRE"
                ? "Departamento de reingreso"
                : "Nuevo departamento"
            }
            icon={Building2}
            required={requiresDepartment}
          >
            <select
              value={newDepartmentId}
              onChange={(event) =>
                setNewDepartmentId(event.target.value)
              }
              required={requiresDepartment}
              disabled={loadingCatalogs}
              className={inputClassName}
            >
              <option value="">
                {loadingCatalogs
                  ? "Cargando departamentos..."
                  : "Seleccionar departamento"}
              </option>

              {departments.map((department) => (
                <option
                  key={department.id}
                  value={department.id}
                  disabled={
                    type === "DEPARTMENT_CHANGE" &&
                    department.id === currentDepartmentId
                  }
                >
                  {department.name} · {department.code}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {showWorkShift && (
          <FormField
            label={
              type === "REHIRE"
                ? "Turno de reingreso"
                : "Nuevo turno"
            }
            icon={Clock3}
            required={requiresWorkShift}
          >
            <select
              value={newWorkShiftId}
              onChange={(event) =>
                setNewWorkShiftId(event.target.value)
              }
              required={requiresWorkShift}
              disabled={loadingCatalogs}
              className={inputClassName}
            >
              <option value="">
                {loadingCatalogs
                  ? "Cargando turnos..."
                  : "Seleccionar turno"}
              </option>

              {workShifts.map((workShift) => (
                <option
                  key={workShift.id}
                  value={workShift.id}
                  disabled={
                    type === "SHIFT_CHANGE" &&
                    workShift.id === currentWorkShiftId
                  }
                >
                  {workShift.name} · {workShift.startTime} –{" "}
                  {workShift.endTime}
                </option>
              ))}
            </select>
          </FormField>
        )}

        <FormField
          label={
            type === "TERMINATION"
              ? "Motivo de baja"
              : "Motivo"
          }
          icon={ArrowRightLeft}
          required={requiresReason}
        >
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={250}
            required={requiresReason}
            placeholder={
              type === "TERMINATION"
                ? "Especifica el motivo de la baja"
                : "Motivo del movimiento"
            }
            className={inputClassName}
          />
        </FormField>
      </div>

      <FormField label="Notas" icon={FileText}>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Información adicional del movimiento"
          className={`${inputClassName} resize-y`}
        />
      </FormField>

      {(selectedDepartment || selectedWorkShift) && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#0b3a82]">
            Selección
          </p>

          <div className="mt-2 space-y-1 text-sm text-slate-600">
            {selectedDepartment && (
              <p>
                Departamento:{" "}
                <strong className="text-slate-800">
                  {selectedDepartment.name}
                </strong>
              </p>
            )}

            {selectedWorkShift && (
              <p>
                Turno:{" "}
                <strong className="text-slate-800">
                  {selectedWorkShift.name}
                </strong>{" "}
                ({selectedWorkShift.startTime} –{" "}
                {selectedWorkShift.endTime})
              </p>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end border-t border-slate-100 pt-5">
        <button
          type="submit"
          disabled={saving || loadingCatalogs}
          className="inline-flex min-w-48 items-center justify-center gap-2 rounded-xl bg-[#0b3a82] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#082e68] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Registrando...
            </>
          ) : (
            <>
              <Save className="size-4" />
              Registrar movimiento
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function MovementButton({
  active,
  label,
  icon: Icon,
  onClick,
  danger = false,
}: {
  active: boolean;
  label: string;
  icon: typeof BriefcaseBusiness;
  onClick: () => void;
  danger?: boolean;
}) {
  const activeClass = danger
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-[#0b3a82] bg-blue-50 text-[#0b3a82]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-bold transition ${
        active
          ? activeClass
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

function FormField({
  label,
  icon: Icon,
  required = false,
  children,
}: {
  label: string;
  icon: typeof CalendarDays;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
        <Icon className="size-4 text-slate-400" />
        {label}
        {required && (
          <span className="text-[#b27f00]">*</span>
        )}
      </span>

      {children}
    </label>
  );
}

const inputClassName =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-[#0b3a82] focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";