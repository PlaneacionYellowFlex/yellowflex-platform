import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  Bus,
  CalendarDays,
  Clock3,
  FileText,
  GraduationCap,
  IdCard,
  Mail,
  MapPin,
  Phone,
  History,
  MoveRight,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import EmployeeMovementForm from "@/components/rrhh/employee-movement-form";
import EmployeeCredentialCard from "@/components/rrhh/employee-credential-card";
import EmployeeProfileForm from "@/components/rrhh/employee-profile-form";
import { getEmployeeById } from "@/lib/rrhh/service";

export const dynamic = "force-dynamic";

type EmployeePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EmployeePage({
  params,
}: EmployeePageProps) {
  const { id } = await params;
  const employee = await getEmployeeById(id);

  if (!employee) {
    notFound();
  }

  const profile = employee.profile;
  const manager = profile?.manager;
  const movements = employee.movements;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/modules/rrhh"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-[#0b3a82]"
        >
          <ArrowLeft className="size-4" />
          Volver al Maestro de colaboradores
        </Link>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="h-2 bg-[#f4b400]" />

        <div className="p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-start">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#0b3a82]">
                <UserRound className="size-9" />
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b27f00]">
                    Expediente digital
                  </p>

                  <StatusBadge status={employee.status} />
                </div>

                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                  {employee.fullName}
                </h1>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
                  <span className="flex items-center gap-2">
                    <IdCard className="size-4" />
                    {employee.employeeNumber}
                  </span>

                  <span className="flex items-center gap-2">
                    <BriefcaseBusiness className="size-4" />
                    {employee.position ?? "Sin puesto asignado"}
                  </span>

                  <span className="flex items-center gap-2">
                    <Building2 className="size-4" />
                    {employee.department.name}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Estado del expediente
              </p>

              <div className="mt-2 flex items-center gap-2">
                <ShieldCheck
                  className={
                    profile
                      ? "size-5 text-emerald-600"
                      : "size-5 text-amber-500"
                  }
                />

                <span className="font-bold text-slate-900">
                  {profile ? "Perfil RH disponible" : "Perfil RH pendiente"}
                </span>
              </div>

              <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
                {profile
                  ? "El colaborador cuenta con información complementaria de Recursos Humanos."
                  : "La identidad corporativa existe, pero todavía no se ha capturado su expediente RH."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <InformationCard
            eyebrow="Información laboral"
            title="Estructura organizacional"
            icon={BriefcaseBusiness}
          >
            <InformationGrid>
              <InformationItem
                label="Número de empleado"
                value={employee.employeeNumber}
                icon={IdCard}
              />

              <InformationItem
                label="Puesto"
                value={employee.position ?? "Sin información"}
                icon={BriefcaseBusiness}
              />

              <InformationItem
                label="Departamento"
                value={employee.department.name}
                secondary={employee.department.code}
                icon={Building2}
              />

              <InformationItem
                label="Turno"
                value={employee.workShift?.name ?? "Sin turno asignado"}
                secondary={
                  employee.workShift
                    ? `${employee.workShift.startTime} – ${employee.workShift.endTime}`
                    : undefined
                }
                icon={Clock3}
              />

              <InformationItem
                label="Fecha de ingreso"
                value={formatDate(profile?.hireDate)}
                icon={CalendarDays}
              />

              <InformationItem
                label="Jefe directo"
                value={manager?.fullName ?? "Sin información"}
                secondary={
                  manager
                    ? [
                        manager.position,
                        manager.department.name,
                        `Empleado ${manager.employeeNumber}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined
                }
                icon={UsersRound}
              />

              <InformationItem
                label="Tipo de contrato"
                value={formatContractType(profile?.contractType)}
                icon={FileText}
              />

              <InformationItem
                label="Estatus laboral"
                value={employee.status === "ACTIVE" ? "Activo" : "Inactivo"}
                icon={ShieldCheck}
              />
            </InformationGrid>
          </InformationCard>

          <InformationCard
            eyebrow="Información personal"
            title="Contacto y datos generales"
            icon={UserRound}
          >
            <InformationGrid>
              <InformationItem
                label="Fecha de nacimiento"
                value={formatDate(profile?.birthDate)}
                icon={CalendarDays}
              />

              <InformationItem
                label="Teléfono"
                value={profile?.phone ?? "Sin información"}
                icon={Phone}
              />

              <InformationItem
                label="Correo"
                value={profile?.email ?? "Sin información"}
                icon={Mail}
              />

              <InformationItem
                label="Ruta de transporte"
                value={profile?.transportRoute ?? "Sin información"}
                icon={Bus}
              />
            </InformationGrid>
          </InformationCard>

          <InformationCard
            eyebrow="Administración RH"
            title="Registrar movimiento"
            icon={MoveRight}
          >
            <p className="mb-6 max-w-3xl text-sm leading-6 text-slate-500">
              Registra cambios laborales conservando la trazabilidad del
              colaborador. Cada movimiento actualizará su situación actual y
              quedará registrado en el historial laboral.
            </p>

            <EmployeeMovementForm
              employeeId={employee.id}
              employeeStatus={employee.status}
              currentPosition={employee.position}
              currentDepartmentId={employee.department.id}
              currentWorkShiftId={employee.workShift?.id ?? null}
            />
          </InformationCard>

          <InformationCard
            eyebrow="Trazabilidad RH"
            title="Historial laboral"
            icon={History}
          >
            {movements.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                <History className="mx-auto size-9 text-slate-300" />
                <h3 className="mt-4 text-sm font-bold text-slate-900">
                  Sin movimientos registrados
                </h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  El historial comenzará a construirse con los movimientos
                  realizados desde YellowFlex Platform. No se generan
                  movimientos históricos ficticios a partir del estado actual.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {movements.map((movement) => (
                  <MovementTimelineItem
                    key={movement.id}
                    movement={movement}
                  />
                ))}
              </div>
            )}
          </InformationCard>

          <InformationCard
            eyebrow="Administración RH"
            title="Editar información del expediente"
            icon={FileText}
          >
            <p className="mb-6 max-w-3xl text-sm leading-6 text-slate-500">
              Actualiza únicamente la información complementaria del
              colaborador. Los datos de identidad, puesto, departamento,
              turno y jefe directo se administran mediante sus procesos
              corporativos correspondientes.
            </p>

            <EmployeeProfileForm
              employeeId={employee.id}
              initialData={{
                birthDate: formatDateForInput(profile?.birthDate),
                hireDate: formatDateForInput(profile?.hireDate),
                contractType: profile?.contractType ?? null,
                phone: profile?.phone ?? "",
                email: profile?.email ?? "",
                transportRoute: profile?.transportRoute ?? "",
              }}
            />
          </InformationCard>

          {employee.status === "INACTIVE" && (
            <InformationCard
              eyebrow="Baja"
              title="Información de terminación"
              icon={FileText}
            >
              <InformationGrid>
                <InformationItem
                  label="Fecha de baja"
                  value={formatDate(profile?.terminationDate)}
                  icon={CalendarDays}
                />

                <InformationItem
                  label="Motivo"
                  value={profile?.terminationReason ?? "Sin información"}
                  icon={FileText}
                />
              </InformationGrid>
            </InformationCard>
          )}
        </div>

        <aside className="space-y-6">
          <EmployeeCredentialCard
            employeeId={employee.id}
            employeeStatus={employee.status}
            pinMustChange={employee.pinMustChange}
            pinUpdatedAt={
              employee.pinUpdatedAt
                ? employee.pinUpdatedAt.toISOString()
                : null
            }
          />

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b27f00]">
              Expediente RH
            </p>

            <h2 className="mt-2 text-lg font-bold text-slate-900">
              Cobertura de información
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Esta sección crecerá conforme integremos los procesos
              especializados de Recursos Humanos.
            </p>

            <div className="mt-6 space-y-3">
              <ModuleStatus
                label="Datos generales"
                status={profile ? "Disponible" : "Pendiente"}
                ready={Boolean(profile)}
              />

              <ModuleStatus
                label="Movimientos"
                status="Disponible"
                ready={true}
              />

              <ModuleStatus
                label="Asistencia"
                status="Próxima etapa"
                ready={false}
              />

              <ModuleStatus
                label="Capacitación"
                status="Próxima etapa"
                ready={false}
              />

              <ModuleStatus
                label="Desempeño"
                status="Próxima etapa"
                ready={false}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b27f00]">
              Próximos módulos
            </p>

            <div className="mt-5 space-y-4">
              <FutureModule
                icon={CalendarDays}
                title="Asistencia"
                description="Faltas, retardos, permisos e incidencias."
              />

              <FutureModule
                icon={GraduationCap}
                title="Desarrollo"
                description="Capacitación, habilidades y certificaciones."
              />

              <FutureModule
                icon={MapPin}
                title="Movimientos"
                description="Altas, bajas, promociones y cambios internos."
              />
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function InformationCard({
  eyebrow,
  title,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: typeof UserRound;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-[#0b3a82]">
          <Icon className="size-5" />
        </span>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b27f00]">
            {eyebrow}
          </p>

          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {title}
          </h2>
        </div>
      </div>

      <div className="mt-6">{children}</div>
    </section>
  );
}

function InformationGrid({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function InformationItem({
  label,
  value,
  secondary,
  icon: Icon,
}: {
  label: string;
  value: string;
  secondary?: string;
  icon: typeof UserRound;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />

        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>

          <p className="mt-1 break-words text-sm font-bold text-slate-800">
            {value}
          </p>

          {secondary && (
            <p className="mt-0.5 text-xs text-slate-400">
              {secondary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type EmployeeMovementRecord = {
  id: string;
  type:
    | "HIRE"
    | "POSITION_CHANGE"
    | "DEPARTMENT_CHANGE"
    | "SHIFT_CHANGE"
    | "PROMOTION"
    | "TERMINATION"
    | "REHIRE";
  effectiveDate: Date;
  reason: string | null;
  notes: string | null;
  previousStatus: "ACTIVE" | "INACTIVE" | null;
  newStatus: "ACTIVE" | "INACTIVE" | null;
  previousPosition: string | null;
  newPosition: string | null;
  previousDepartmentName: string | null;
  newDepartmentName: string | null;
  previousWorkShiftName: string | null;
  newWorkShiftName: string | null;
  registeredBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  createdAt: Date;
};

function MovementTimelineItem({
  movement,
}: {
  movement: EmployeeMovementRecord;
}) {
  const changes = getMovementChanges(movement);

  return (
    <article className="relative rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0b3a82]">
            <History className="size-5" />
          </span>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#fff8df] px-2.5 py-1 text-xs font-bold text-[#8a6200]">
                {formatMovementType(movement.type)}
              </span>

              <span className="text-xs font-medium text-slate-400">
                {formatDate(movement.effectiveDate)}
              </span>
            </div>

            {movement.reason && (
              <p className="mt-3 text-sm font-semibold text-slate-800">
                {movement.reason}
              </p>
            )}
          </div>
        </div>

        <div className="text-left sm:text-right">
          <p className="text-xs font-medium text-slate-400">
            Registrado por
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-600">
            {movement.registeredBy?.name ?? "Sistema / pendiente de identidad"}
          </p>
        </div>
      </div>

      {changes.length > 0 && (
        <div className="mt-5 grid gap-3">
          {changes.map((change) => (
            <div
              key={change.label}
              className="rounded-xl border border-slate-100 bg-slate-50 p-4"
            >
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                {change.label}
              </p>

              <div className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
                <span className="font-medium text-slate-500">
                  {change.previous}
                </span>
                <MoveRight className="size-4 shrink-0 text-[#b27f00]" />
                <span className="font-bold text-slate-900">
                  {change.next}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {movement.notes && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-400">Notas</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {movement.notes}
          </p>
        </div>
      )}
    </article>
  );
}

function getMovementChanges(movement: EmployeeMovementRecord) {
  const changes: Array<{
    label: string;
    previous: string;
    next: string;
  }> = [];

  if (
    movement.previousStatus &&
    movement.newStatus &&
    movement.previousStatus !== movement.newStatus
  ) {
    changes.push({
      label: "Estatus",
      previous: formatEmployeeStatus(movement.previousStatus),
      next: formatEmployeeStatus(movement.newStatus),
    });
  }

  if (movement.previousPosition !== movement.newPosition) {
    changes.push({
      label: "Puesto",
      previous: movement.previousPosition ?? "Sin puesto",
      next: movement.newPosition ?? "Sin puesto",
    });
  }

  if (
    movement.previousDepartmentName !== movement.newDepartmentName
  ) {
    changes.push({
      label: "Departamento",
      previous: movement.previousDepartmentName ?? "Sin departamento",
      next: movement.newDepartmentName ?? "Sin departamento",
    });
  }

  if (movement.previousWorkShiftName !== movement.newWorkShiftName) {
    changes.push({
      label: "Turno",
      previous: movement.previousWorkShiftName ?? "Sin turno",
      next: movement.newWorkShiftName ?? "Sin turno",
    });
  }

  return changes;
}

function formatMovementType(
  type: EmployeeMovementRecord["type"],
) {
  switch (type) {
    case "HIRE":
      return "Alta";
    case "POSITION_CHANGE":
      return "Cambio de puesto";
    case "DEPARTMENT_CHANGE":
      return "Cambio de departamento";
    case "SHIFT_CHANGE":
      return "Cambio de turno";
    case "PROMOTION":
      return "Promoción";
    case "TERMINATION":
      return "Baja";
    case "REHIRE":
      return "Reingreso";
  }
}

function formatEmployeeStatus(status: "ACTIVE" | "INACTIVE") {
  return status === "ACTIVE" ? "Activo" : "Inactivo";
}

function ModuleStatus({
  label,
  status,
  ready,
}: {
  label: string;
  status: string;
  ready: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
      <span className="text-sm font-semibold text-slate-700">
        {label}
      </span>

      <span
        className={
          ready
            ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
            : "rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-500"
        }
      >
        {status}
      </span>
    </div>
  );
}

function FutureModule({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0b3a82]">
        <Icon className="size-4" />
      </span>

      <div>
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          {description}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "ACTIVE" | "INACTIVE";
}) {
  const active = status === "ACTIVE";

  return (
    <span
      className={
        active
          ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
          : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500"
      }
    >
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

function formatDate(value: Date | null | undefined) {
  if (!value) {
    return "Sin información";
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatDateForInput(value: Date | null | undefined) {
  if (!value) {
    return "";
  }

  return value.toISOString().slice(0, 10);
}

function formatContractType(
  value:
    | "INDEFINITE"
    | "FIXED_TERM"
    | "TEMPORARY"
    | "TRAINING"
    | "OTHER"
    | null
    | undefined,
) {
  switch (value) {
    case "INDEFINITE":
      return "Indeterminado";
    case "FIXED_TERM":
      return "Tiempo determinado";
    case "TEMPORARY":
      return "Temporal";
    case "TRAINING":
      return "Capacitación inicial";
    case "OTHER":
      return "Otro";
    default:
      return "Sin información";
  }
}

