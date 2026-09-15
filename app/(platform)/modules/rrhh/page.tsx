import {
  ArrowRight,
  Building2,
  Clock3,
  UserCheck,
  UserX,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import PageHeader from "@/components/page-header";
import EmployeeDirectory from "@/components/rrhh/employee-directory";
import { getEmployees } from "@/lib/rrhh/service";
import { getTimeControlSummary } from "@/lib/rrhh/time-control-service";

export const dynamic = "force-dynamic";

export default async function HumanResourcesPage() {
  const [employees, timeControl] = await Promise.all([
    getEmployees(),
    getTimeControlSummary(),
  ]);

  const activeEmployees = employees.filter(
    (employee) => employee.status === "ACTIVE",
  ).length;

  const inactiveEmployees = employees.filter(
    (employee) => employee.status === "INACTIVE",
  ).length;

  const departments = new Set(
    employees.map((employee) => employee.department.id),
  ).size;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="YellowFlex · Recursos Humanos"
        title="Maestro de colaboradores"
        description="Fuente corporativa de personas, estructura organizacional y administración de personal."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Colaboradores"
          value={employees.length}
          detail="Registros totales"
          icon={UsersRound}
        />

        <MetricCard
          label="Activos"
          value={activeEmployees}
          detail="Colaboradores activos"
          icon={UserCheck}
        />

        <MetricCard
          label="Inactivos"
          value={inactiveEmployees}
          detail="Colaboradores inactivos"
          icon={UserX}
        />

        <MetricCard
          label="Departamentos"
          value={departments}
          detail="Con personal registrado"
          icon={Building2}
        />
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[1fr_auto]">
          <div className="p-6 sm:p-7">
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#0B3A82]">
                <Clock3 className="size-5" />
              </span>

              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0B3A82]">
                  Gestión RH
                </p>

                <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">
                  Control de tiempo
                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Administra llegadas tardías, faltas, salidas
                  anticipadas, permisos, tiempo pendiente y
                  reposiciones de cada colaborador.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 p-6 lg:min-w-[310px] lg:border-l lg:border-t-0">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-500">
                  Con saldo pendiente
                </p>

                <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                  {timeControl.totals.employeesWithDebt}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500">
                  Tiempo pendiente
                </p>

                <p className="mt-1 text-2xl font-black tracking-tight text-[#B77900]">
                  {timeControl.totals.pending.label}
                </p>
              </div>
            </div>

            <Link
              href="/modules/rrhh/time-control"
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#0B3A82] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#082E68]"
            >
              Administrar tiempo
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <EmployeeDirectory employees={employees} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof UsersRound;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">
            {label}
          </p>

          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            {value}
          </p>

          <p className="mt-1 text-xs text-slate-400">
            {detail}
          </p>
        </div>

        <span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-[#0B3A82]">
          <Icon className="size-5" />
        </span>
      </div>
    </div>
  );
}