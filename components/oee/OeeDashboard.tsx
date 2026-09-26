"use client";

import { useGlobalWeek } from "@/components/providers/GlobalWeekProvider";
import useOeeData from "@/hooks/useOeeData";

import MachineAnalytics from "./MachineAnalytics";
import WeeklyHistory from "./WeeklyHistory";

import type { OeeData, OeeMachineAnalytics } from "./types";
import { formatPercent } from "./utils";

type ExecutiveStatus =
  | "positive"
  | "attention"
  | "critical"
  | "neutral";

type ExecutiveCapacity = {
  availableMinutes: number;
  usedMinutes: number;
  unusedMinutes: number;
  registeredDowntimeMinutes: number;
  unclassifiedMinutes: number;
  documentedPercentage: number;
};

type ExecutiveDepartment = {
  key: string;
  department: string;
  status: ExecutiveStatus;
  utilization: number;
  target: number;
  targetGap: number;
  variation: number | null;
  headline: string;
  message: string;
};

type ExecutiveAnalytics = {
  week: number;
  overallStatus: ExecutiveStatus;
  headline: string;
  executiveSummary: string;
  capacity: ExecutiveCapacity;
  departments: ExecutiveDepartment[];
};

type DepartmentHistoryRecord = {
  week: number;
  availableMinutes: number;
  usedMinutes: number;
  downtimeMinutes: number;
  utilization: number;
};

type DepartmentRecord = {
  key: string;
  department: string;
  week: number;
  target: number;
  availableMinutes: number;
  usedMinutes: number;
  downtimeMinutes: number;
  utilization: number;
  targetGap: number;
  previousWeekUtilization: number | null;
  variation: number | null;
  machineCount: number;
  machines: string[];
  history: DepartmentHistoryRecord[];
};

type DepartmentAnalytics = {
  week: number;
  departments: DepartmentRecord[];
};

type DashboardPayload = OeeData & {
  executive: ExecutiveAnalytics;
  departments: DepartmentAnalytics;
  machines: OeeMachineAnalytics;
};

type DepartmentCardData = DepartmentRecord & {
  executiveStatus: ExecutiveStatus;
};

function clampPercentage(value: number): number {
  return Math.min(Math.max(value * 100, 0), 100);
}

function getStatusLabel(status: ExecutiveStatus): string {
  if (status === "positive") return "Operación favorable";
  if (status === "critical") return "Intervención requerida";
  if (status === "attention") return "Atención ejecutiva";
  return "Operación en seguimiento";
}

function getStatusStyles(status: ExecutiveStatus): string {
  if (status === "positive") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (status === "attention") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function getDepartmentStatus(
  department: DepartmentRecord,
  executiveDepartments: ExecutiveDepartment[],
): ExecutiveStatus {
  return (
    executiveDepartments.find(
      (item) => item.key === department.key,
    )?.status ?? "neutral"
  );
}

function normalizeDepartment(value: string): string {
  return value.trim().toUpperCase();
}

function findDepartment(
  departments: DepartmentCardData[],
  token: "INYE" | "ROTO",
): DepartmentCardData | undefined {
  return departments.find((department) =>
    normalizeDepartment(department.department).includes(token),
  );
}

function LoadingState() {
  return (
    <main className="min-h-screen bg-[#f7f9fc] px-6 py-16 text-slate-950">
      <div className="mx-auto flex min-h-[70vh] max-w-7xl items-center justify-center">
        <div className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-[#d6a800]" />
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.34em] text-[#d6a800]">
            YellowFlex Intelligence
          </p>
          <h1 className="mt-4 text-3xl font-bold text-[#12355b]">
            Comprendiendo la operación
          </h1>
          <p className="mt-4 leading-7 text-slate-500">
            Consolidando desempeño y comportamiento operativo de la semana activa.
          </p>
        </div>
      </div>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-white px-6 py-16 text-slate-950">
      <div className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-red-50 p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-red-700">
          No fue posible cargar OEE
        </p>
        <p className="mt-4 text-lg text-red-900">{message}</p>
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <main className="min-h-screen bg-[#f7f9fc] px-6 py-16 text-slate-950">
      <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-8">
        <p className="text-lg font-semibold text-[#12355b]">
          No existen datos disponibles para mostrar.
        </p>
      </div>
    </main>
  );
}

function WeekSelector({
  activeWeek,
  currentWeek,
  availableWeeks,
  loading,
  onChange,
}: {
  activeWeek: number | null;
  currentWeek: number;
  availableWeeks: number[];
  loading: boolean;
  onChange: (week: number) => void;
}) {
  const selectedWeek = activeWeek ?? currentWeek;
  const weeks = [...availableWeeks].sort((a, b) => b - a);

  return (
    <label className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
        Semana
      </span>
      <select
        aria-label="Seleccionar semana activa"
        value={selectedWeek || ""}
        disabled={loading}
        onChange={(event) => onChange(Number(event.target.value))}
        className="cursor-pointer bg-transparent text-sm font-bold text-[#12355b] outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {weeks.map((week) => (
          <option key={week} value={week}>
            {week}
          </option>
        ))}
      </select>
      {loading && (
        <span
          aria-label="Actualizando semana"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-[#d6a800]"
        />
      )}
    </label>
  );
}

function buildHeroSummary(departments: DepartmentCardData[]): string {
  return departments
    .map((department) => {
      const variation =
        department.variation === null
          ? "sin comparativo contra una semana anterior"
          : department.variation > 0
            ? `mejoró ${Math.abs(department.variation * 100).toFixed(1)} puntos`
            : department.variation < 0
              ? `disminuyó ${Math.abs(department.variation * 100).toFixed(1)} puntos`
              : "se mantuvo sin variación";

      return `${department.department} cerró en ${formatPercent(
        department.utilization,
      )} y ${variation}.`;
    })
    .join(" ");
}

function ExecutiveHero({
  executive,
  departments,
  currentWeek,
  activeWeek,
  availableWeeks,
  loading,
  onWeekChange,
}: {
  executive: ExecutiveAnalytics;
  departments: DepartmentCardData[];
  currentWeek: number;
  activeWeek: number | null;
  availableWeeks: number[];
  loading: boolean;
  onWeekChange: (week: number) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-5 sm:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.34em] text-[#d6a800]">
              YellowFlex Control Tower
            </p>
            <p className="mt-2 text-sm font-medium text-slate-400">
              Mission Control · Dirección
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <WeekSelector
              activeWeek={activeWeek}
              currentWeek={currentWeek}
              availableWeeks={availableWeeks}
              loading={loading}
              onChange={onWeekChange}
            />
            <span
              className={`rounded-full border px-4 py-2 text-sm font-semibold ${getStatusStyles(
                executive.overallStatus,
              )}`}
            >
              {getStatusLabel(executive.overallStatus)}
            </span>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden px-6 py-10 sm:px-8 lg:px-12 lg:py-14">
        <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-[#d6a800]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-20 h-96 w-96 rounded-full bg-[#12355b]/10 blur-3xl" />
        <div className="relative max-w-5xl">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#d6a800]">
            Executive Overview
          </p>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-[#12355b] sm:text-5xl lg:text-6xl">
            {executive.headline}
          </h1>
          <p className="mt-7 max-w-4xl text-base leading-8 text-slate-600 sm:text-lg">
            {buildHeroSummary(departments)}
          </p>
        </div>
      </div>
    </section>
  );
}

function ExecutiveKpis({
  capacity,
  departments,
  totalMachines,
}: {
  capacity: ExecutiveCapacity;
  departments: DepartmentCardData[];
  totalMachines: number;
}) {
  const generalUtilization =
    capacity.availableMinutes > 0
      ? capacity.usedMinutes / capacity.availableMinutes
      : 0;

  const injection = findDepartment(departments, "INYE");
  const rotomolding = findDepartment(departments, "ROTO");

  const cards = [
    {
      label: "Utilización general",
      value: formatPercent(generalUtilization),
      detail: "Semana activa",
    },
    {
      label: "Inyección",
      value: injection ? formatPercent(injection.utilization) : "—",
      detail: injection ? `Meta ${formatPercent(injection.target)}` : "Sin datos",
    },
    {
      label: "Rotomoldeo",
      value: rotomolding ? formatPercent(rotomolding.utilization) : "—",
      detail: rotomolding ? `Meta ${formatPercent(rotomolding.target)}` : "Sin datos",
    },
    {
      label: "Máquinas analizadas",
      value: String(totalMachines),
      detail: "Con información operativa",
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article
          key={card.label}
          className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            {card.label}
          </p>
          <p className="mt-4 text-3xl font-bold tracking-tight text-[#12355b]">
            {card.value}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {card.detail}
          </p>
        </article>
      ))}
    </section>
  );
}

function DepartmentComparison({
  departments,
}: {
  departments: DepartmentCardData[];
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#d6a800]">
            Comparativa
          </p>
          <h2 className="mt-2 text-2xl font-bold text-[#12355b]">
            Inyección vs Rotomoldeo
          </h2>
        </div>
        <p className="text-sm text-slate-500">
          Utilización y variación semanal
        </p>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {departments.map((department) => (
          <article
            key={department.key}
            className="rounded-3xl border border-slate-200 bg-[#fbfcfe] p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-400">
                  {department.department}
                </p>
                <p className="mt-2 text-4xl font-bold text-[#12355b]">
                  {formatPercent(department.utilization)}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1.5 text-xs font-bold ${getStatusStyles(
                  department.executiveStatus,
                )}`}
              >
                {department.variation === null
                  ? "Sin comparativo"
                  : `${department.variation >= 0 ? "+" : ""}${formatPercent(
                      department.variation,
                    )}`}
              </span>
            </div>

            <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[#12355b]"
                style={{ width: `${clampPercentage(department.utilization)}%` }}
              />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400">Máquinas</p>
                <p className="mt-1 font-bold text-[#12355b]">
                  {department.machineCount}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Meta</p>
                <p className="mt-1 font-bold text-[#12355b]">
                  {formatPercent(department.target)}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function getVariationText(variation: number | null): string {
  if (variation === null) {
    return "No existe una semana anterior disponible para realizar el comparativo.";
  }

  const variationPoints = Math.abs(variation * 100).toFixed(1);

  if (variation > 0) {
    return `Respecto a la semana anterior, mejoró ${variationPoints} puntos.`;
  }

  if (variation < 0) {
    return `Respecto a la semana anterior, disminuyó ${variationPoints} puntos.`;
  }

  return "Respecto a la semana anterior, se mantuvo sin variación.";
}

function getTargetText(department: DepartmentCardData): string {
  const gapPoints = Math.abs(department.targetGap * 100).toFixed(1);

  if (department.targetGap > 0) {
    return `${department.department} cerró con ${formatPercent(
      department.utilization,
    )}, ${gapPoints} puntos por encima de la meta.`;
  }

  if (department.targetGap < 0) {
    return `${department.department} cerró con ${formatPercent(
      department.utilization,
    )}, ${gapPoints} puntos por debajo de la meta.`;
  }

  return `${department.department} cerró exactamente en la meta de ${formatPercent(
    department.target,
  )}.`;
}

function DepartmentTrendChart({
  department,
}: {
  department: DepartmentCardData;
}) {
  const history = [...department.history]
    .sort((left, right) => left.week - right.week)
    .slice(-4);

  const width = 760;
  const height = 280;
  const padding = {
    top: 52,
    right: 28,
    bottom: 46,
    left: 28,
  };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xPosition = (index: number): number => {
    if (history.length <= 1) {
      return padding.left + plotWidth / 2;
    }

    return padding.left + (index / (history.length - 1)) * plotWidth;
  };

  const yPosition = (value: number): number =>
    padding.top + (1 - Math.min(Math.max(value, 0), 1)) * plotHeight;

  const points = history
    .map(
      (record, index) =>
        `${xPosition(index)},${yPosition(record.utilization)}`,
    )
    .join(" ");

  const targetY = yPosition(department.target);

  return (
    <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-slate-100 bg-[#fbfcfe] px-3 py-4 sm:px-5">
      <div className="mb-2 flex justify-end">
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold text-[#9a7600]">
          Meta {formatPercent(department.target)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Evolución de utilización de ${department.department}`}
        className="w-full"
      >
        {[0.5, 0.75, 1].map((value) => (
          <line
            key={value}
            x1={padding.left}
            x2={width - padding.right}
            y1={yPosition(value)}
            y2={yPosition(value)}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        ))}

        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={targetY}
          y2={targetY}
          stroke="#d6a800"
          strokeWidth="1.5"
          strokeDasharray="7 9"
          strokeOpacity="0.55"
        />

        {history.length > 1 && (
          <polyline
            points={points}
            fill="none"
            stroke="#12355b"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {history.map((record, index) => {
          const x = xPosition(index);
          const y = yPosition(record.utilization);
          const isCurrent = record.week === department.week;
          const isNearTarget =
            Math.abs(record.utilization - department.target) <= 0.025;
          const labelY = isNearTarget ? y + 24 : y - 17;

          return (
            <g key={`${department.key}-${record.week}`}>
              <circle
                cx={x}
                cy={y}
                r={isCurrent ? 8 : 6}
                fill={isCurrent ? "#d6a800" : "#12355b"}
                stroke="#ffffff"
                strokeWidth="4"
              />
              <text
                x={x}
                y={labelY}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill={isCurrent ? "#12355b" : "#475569"}
              >
                {formatPercent(record.utilization)}
              </text>
              <text
                x={x}
                y={height - 12}
                textAnchor="middle"
                fontSize="12"
                fontWeight={isCurrent ? "700" : "600"}
                fill={isCurrent ? "#12355b" : "#94a3b8"}
              >
                S{record.week}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DepartmentTrends({
  departments,
}: {
  departments: DepartmentCardData[];
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#d6a800]">
        Tendencia departamental
      </p>
      <h2 className="mt-2 text-2xl font-bold text-[#12355b]">
        Evolución operativa por departamento
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">
        Histórico de las últimas cuatro semanas disponibles, con meta y variación contra la semana anterior.
      </p>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        {departments.map((department) => (
          <section
            key={department.key}
            className="rounded-[1.75rem] border border-slate-200 bg-white p-5 sm:p-6"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d6a800]">
                  Departamento
                </p>
                <h3 className="mt-2 text-2xl font-bold text-[#12355b]">
                  {department.department}
                </h3>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    Utilización
                  </p>
                  <p className="mt-1 text-xl font-bold text-[#12355b]">
                    {formatPercent(department.utilization)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    Meta
                  </p>
                  <p className="mt-1 text-xl font-bold text-[#12355b]">
                    {formatPercent(department.target)}
                  </p>
                </div>
              </div>
            </div>

            <DepartmentTrendChart department={department} />

            <div className="mt-6 rounded-[1.5rem] border border-slate-100 bg-[#fbfcfe] p-5">
              <p className="text-sm leading-7 text-slate-600">
                {getTargetText(department)} {getVariationText(department.variation)}
              </p>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

export default function OeeDashboard() {
  const { activeWeek, availableWeeks, setActiveWeek } = useGlobalWeek();
  const { data, error, loading } = useOeeData();

  const initialLoading = data === null && !error;

  if (initialLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <EmptyState />;

  const dashboardData = data as DashboardPayload;
  const { executive, departments, machines, history } = dashboardData;

  const currentWeek =
    executive?.week ?? departments?.week ?? machines?.week ?? 0;

  const departmentCards: DepartmentCardData[] =
    departments?.departments?.map((department) => ({
      ...department,
      executiveStatus: getDepartmentStatus(
        department,
        executive.departments ?? [],
      ),
    })) ?? [];

  return (
    <main className="min-h-screen bg-[#f7f9fc] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <ExecutiveHero
          executive={executive}
          departments={departmentCards}
          currentWeek={currentWeek}
          activeWeek={activeWeek}
          availableWeeks={availableWeeks}
          loading={loading}
          onWeekChange={setActiveWeek}
        />

        <ExecutiveKpis
          capacity={executive.capacity}
          departments={departmentCards}
          totalMachines={machines.totalMachines}
        />

        <DepartmentComparison departments={departmentCards} />

        <DepartmentTrends departments={departmentCards} />

        <MachineAnalytics machines={machines.machines} />

        <WeeklyHistory history={history} currentWeek={currentWeek} />
      </div>
    </main>
  );
}
