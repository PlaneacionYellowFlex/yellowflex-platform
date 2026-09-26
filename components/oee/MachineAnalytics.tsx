"use client";

import { useMemo, useState } from "react";

import type {
  OeeMachine,
  OeeMachineHistoryRecord,
} from "./types";

import {
  formatPercent,
  getStatusBadge,
} from "./utils";

type Props = {
  machines: OeeMachine[];
};

type DepartmentGroup = {
  key: string;
  name: string;
  machines: OeeMachine[];
  averageUtilization: number;
};

const TARGET_UTILIZATION = 0.85;

function normalizeDepartment(department: string): string {
  return department.trim().toUpperCase();
}

function getDepartmentLabel(department: string): string {
  const normalized = normalizeDepartment(department);

  if (normalized.includes("INYE")) {
    return "Inyección";
  }

  if (normalized.includes("ROTO") || normalized.includes("ROTOMOL")) {
    return "Rotomoldeo";
  }

  return department.trim() || "Sin departamento";
}

function buildDepartmentGroups(
  machines: OeeMachine[],
): DepartmentGroup[] {
  const groups = new Map<string, OeeMachine[]>();

  for (const machine of machines) {
    const label = getDepartmentLabel(machine.department);
    const key = normalizeDepartment(label);
    const current = groups.get(key) ?? [];

    current.push(machine);
    groups.set(key, current);
  }

  return Array.from(groups.entries())
    .map(([key, departmentMachines]) => {
      const name = getDepartmentLabel(
        departmentMachines[0]?.department ?? key,
      );

      const averageUtilization =
        departmentMachines.length > 0
          ? departmentMachines.reduce(
              (total, machine) => total + machine.utilization,
              0,
            ) / departmentMachines.length
          : 0;

      return {
        key,
        name,
        machines: [...departmentMachines].sort(
          (left, right) =>
            left.machine.localeCompare(right.machine, "es-MX"),
        ),
        averageUtilization,
      };
    })
    .sort((left, right) => {
      const priority = (department: string): number => {
        if (department.includes("INYE")) return 0;
        if (department.includes("ROTO")) return 1;
        return 2;
      };

      return (
        priority(left.key) - priority(right.key) ||
        left.name.localeCompare(right.name, "es-MX")
      );
    });
}

function MiniHistoryChart({
  history,
}: {
  history: OeeMachineHistoryRecord[];
}) {
  const orderedHistory = [...history]
    .sort((left, right) => left.week - right.week)
    .slice(-4);

  const width = 420;
  const height = 180;
  const padding = {
    top: 34,
    right: 22,
    bottom: 34,
    left: 18,
  };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xPosition = (index: number): number => {
    if (orderedHistory.length <= 1) {
      return padding.left + plotWidth / 2;
    }

    return (
      padding.left +
      (index / (orderedHistory.length - 1)) * plotWidth
    );
  };

  const yPosition = (value: number): number =>
    padding.top +
    (1 - Math.min(Math.max(value, 0), 1)) * plotHeight;

  const linePoints = orderedHistory
    .map(
      (record, index) =>
        `${xPosition(index)},${yPosition(record.utilization)}`,
    )
    .join(" ");

  const areaPoints =
    orderedHistory.length > 0
      ? [
          `${xPosition(0)},${padding.top + plotHeight}`,
          ...orderedHistory.map(
            (record, index) =>
              `${xPosition(index)},${yPosition(record.utilization)}`,
          ),
          `${xPosition(orderedHistory.length - 1)},${padding.top + plotHeight}`,
        ].join(" ")
      : "";

  const targetY = yPosition(TARGET_UTILIZATION);
  const currentIndex = orderedHistory.length - 1;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          Histórico de utilización
        </p>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-bold text-[#9a7600]">
          Meta 85%
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Histórico de utilización de las últimas cuatro semanas"
        className="w-full"
      >
        <defs>
          <linearGradient
            id="machine-history-area"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#12355b" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#12355b" stopOpacity="0.02" />
          </linearGradient>
        </defs>

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
          strokeWidth="2"
          strokeDasharray="7 7"
        />

        {orderedHistory.length > 0 && (
          <polygon
            points={areaPoints}
            fill="url(#machine-history-area)"
          />
        )}

        {orderedHistory.length > 1 && (
          <polyline
            points={linePoints}
            fill="none"
            stroke="#12355b"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {orderedHistory.map((record, index) => {
          const x = xPosition(index);
          const y = yPosition(record.utilization);
          const isCurrent = index === currentIndex;
          const isNearTarget =
            Math.abs(record.utilization - TARGET_UTILIZATION) <= 0.025;
          const labelY = isNearTarget ? y + 24 : y - 14;

          return (
            <g key={record.week}>
              <circle
                cx={x}
                cy={y}
                r={isCurrent ? 8 : 6}
                fill={
                  record.utilization >= TARGET_UTILIZATION
                    ? "#16a34a"
                    : record.utilization >= 0.65
                      ? "#d6a800"
                      : "#dc2626"
                }
                stroke="#ffffff"
                strokeWidth={isCurrent ? 4 : 3}
              />
              <text
                x={x}
                y={labelY}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill={isCurrent ? "#12355b" : "#475569"}
              >
                {formatPercent(record.utilization)}
              </text>
              <text
                x={x}
                y={height - 9}
                textAnchor="middle"
                fontSize="11"
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

function MachineCard({
  machine,
  highlighted = false,
}: {
  machine: OeeMachine;
  highlighted?: boolean;
}) {
  return (
    <article
      className={`rounded-[1.75rem] border bg-white p-5 ${
        highlighted
          ? "border-[#d6a800] ring-2 ring-[#d6a800]/15"
          : "border-slate-200"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-[#12355b]">
            {machine.machine}
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            {getDepartmentLabel(machine.department)}
          </p>
        </div>
        <span
          className={`w-fit rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] ${getStatusBadge(
            machine.status,
          )}`}
        >
          {machine.status}
        </span>
      </div>

      <div className="mt-5">
        <MiniHistoryChart history={machine.history} />
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          Utilización actual
        </p>
        <p className="mt-2 text-2xl font-bold text-[#12355b]">
          {formatPercent(machine.utilization)}
        </p>
      </div>
    </article>
  );
}

function MachineRanking({
  machines,
  selectedMachineKey,
  onSelectMachine,
}: {
  machines: OeeMachine[];
  selectedMachineKey: string | null;
  onSelectMachine: (key: string) => void;
}) {
  const activeMachines = machines.filter(
    (machine) => machine.availableMinutes > 0,
  );

  const topMachines = [...activeMachines]
    .sort(
      (left, right) =>
        right.utilization - left.utilization,
    )
    .slice(0, 5);

  const attentionMachines = [...activeMachines]
    .sort(
      (left, right) =>
        left.utilization - right.utilization,
    )
    .slice(0, 5);

  const rowClass = (key: string) =>
    `flex w-full items-center justify-between gap-4 rounded-2xl border bg-white px-4 py-3 text-left transition hover:border-[#d6a800] hover:bg-amber-50/30 ${
      selectedMachineKey === key
        ? "border-[#d6a800] ring-2 ring-[#d6a800]/10"
        : "border-slate-200"
    }`;

  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <article className="rounded-[1.75rem] border border-slate-200 bg-[#fbfcfe] p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d6a800]">
          Ranking operativo
        </p>
        <h3 className="mt-2 text-xl font-bold text-[#12355b]">
          Top 5 máquinas activas
        </h3>
        <p className="mt-2 text-xs text-slate-400">
          Selecciona una máquina para consultar su histórico.
        </p>

        <div className="mt-5 space-y-3">
          {topMachines.map((machine, index) => (
            <button
              type="button"
              key={`top-${machine.key}`}
              onClick={() => onSelectMachine(machine.key)}
              className={rowClass(machine.key)}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#12355b] text-xs font-bold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#12355b]">
                    {machine.machine}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {getDepartmentLabel(machine.department)}
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-base font-bold text-[#12355b]">
                {formatPercent(machine.utilization)}
              </span>
            </button>
          ))}
        </div>
      </article>

      <article className="rounded-[1.75rem] border border-slate-200 bg-[#fbfcfe] p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#d6a800]">
          Atención operativa
        </p>
        <h3 className="mt-2 text-xl font-bold text-[#12355b]">
          Menor utilización
        </h3>
        <p className="mt-2 text-xs text-slate-400">
          Selecciona una máquina para consultar su histórico.
        </p>

        <div className="mt-5 space-y-3">
          {attentionMachines.map((machine) => (
            <button
              type="button"
              key={`attention-${machine.key}`}
              onClick={() => onSelectMachine(machine.key)}
              className={rowClass(machine.key)}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#12355b]">
                  {machine.machine}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {getDepartmentLabel(machine.department)}
                </p>
              </div>
              <span className="shrink-0 text-base font-bold text-[#12355b]">
                {formatPercent(machine.utilization)}
              </span>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}

export default function MachineAnalytics({
  machines,
}: Props) {
  const departmentGroups = useMemo(
    () => buildDepartmentGroups(machines),
    [machines],
  );

  const [openDepartment, setOpenDepartment] =
    useState<string | null>(null);

  const [selectedMachineKey, setSelectedMachineKey] =
    useState<string | null>(null);

  const selectedMachine =
    machines.find(
      (machine) => machine.key === selectedMachineKey,
    ) ?? null;

  function toggleDepartment(
    departmentKey: string,
  ): void {
    setOpenDepartment((current) =>
      current === departmentKey
        ? null
        : departmentKey,
    );
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-6 sm:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.30em] text-[#d6a800]">
          Machine Intelligence
        </p>
        <h2 className="mt-2 text-2xl font-bold text-[#12355b]">
          Análisis por departamento
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
          Ranking operativo e histórico real de utilización por máquina.
        </p>
      </div>

      <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-8">
        <MachineRanking
          machines={machines}
          selectedMachineKey={selectedMachineKey}
          onSelectMachine={setSelectedMachineKey}
        />

        {selectedMachine && (
          <section className="rounded-[1.75rem] border border-[#d6a800]/40 bg-amber-50/20 p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d6a800]">
                  Máquina seleccionada
                </p>
                <h3 className="mt-2 text-xl font-bold text-[#12355b]">
                  Histórico de {selectedMachine.machine}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMachineKey(null)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 transition hover:border-[#d6a800] hover:text-[#12355b]"
              >
                Cerrar
              </button>
            </div>
            <MachineCard
              machine={selectedMachine}
              highlighted
            />
          </section>
        )}

        <div className="space-y-4">
          {departmentGroups.map((group) => {
            const isOpen =
              openDepartment === group.key;

            return (
              <article
                key={group.key}
                className="overflow-hidden rounded-[1.75rem] border border-slate-200"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() =>
                    toggleDepartment(group.key)
                  }
                  className="flex w-full flex-col gap-5 bg-white p-6 text-left transition hover:bg-slate-50 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.20em] text-[#d6a800]">
                      Departamento
                    </p>
                    <h3 className="mt-2 text-2xl font-bold text-[#12355b]">
                      {group.name}
                    </h3>
                    <p className="mt-2 text-sm text-slate-500">
                      {group.machines.length} máquinas registradas
                    </p>
                  </div>

                  <div className="flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 lg:w-auto lg:min-w-[310px]">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                        Utilización promedio
                      </p>
                      <p className="mt-2 text-2xl font-bold text-[#12355b]">
                        {formatPercent(
                          group.averageUtilization,
                        )}
                      </p>
                    </div>
                    <span className="text-xl font-bold text-[#d6a800]">
                      {isOpen ? "−" : "+"}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-200 bg-slate-50 p-5 sm:p-6">
                    <div className="mb-5">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d6a800]">
                        Utilización por máquina · histórico 4 semanas
                      </p>
                    </div>
                    <div className="grid gap-5 xl:grid-cols-2">
                      {group.machines.map(
                        (machine) => (
                          <MachineCard
                            key={machine.key}
                            machine={machine}
                          />
                        ),
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
