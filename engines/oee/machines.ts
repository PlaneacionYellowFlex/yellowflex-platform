import type { OeeWorkbookData } from "@/types/oee";
import { resolveMachine } from "@/lib/catalogs";
export type OeeMachineStatus =
  | "positive"
  | "attention"
  | "critical"
  | "inactive";

export type OeeMachineHistoryRecord = {
  week: number;
  availableMinutes: number;
  usedMinutes: number;
  unusedMinutes: number;
  registeredDowntimeMinutes: number;
  unclassifiedMinutes: number;
  utilization: number;
};

export type OeeMachineAnalyticsRecord = {
  key: string;
  machine: string;
  department: string;
  week: number;

  availableMinutes: number;
  usedMinutes: number;
  unusedMinutes: number;
  registeredDowntimeMinutes: number;
  unclassifiedMinutes: number;

  utilization: number;
  documentedPercentage: number;

  departmentUnclassifiedImpact: number;
  plantUnclassifiedImpact: number;

  status: OeeMachineStatus;
  executiveHeadline: string;
  executiveMessage: string;

  history: OeeMachineHistoryRecord[];
};

export type OeeMachineAnalytics = {
  week: number;
  totalMachines: number;
  activeMachines: number;
  inactiveMachines: number;
  machinesWithUnclassifiedTime: number;
  totalUnclassifiedMinutes: number;
  machines: OeeMachineAnalyticsRecord[];
};

type MachineAccumulator = {
  machine: string;
  department: string;
  availableMinutes: number;
  usedMinutes: number;
  registeredDowntimeMinutes: number;
};

type MachineWeekMap = Map<
  number,
  Map<string, MachineAccumulator>
>;

function roundValue(
  value: number,
  decimals = 6,
): number {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

function formatMinutes(value: number): string {
  return Math.round(value).toLocaleString("es-MX");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}



function getHistoryWeeks(
  data: OeeWorkbookData,
): number[] {
  const availableWeeks = Array.from(
    new Set(
      data.operationalRows
        .map((row) => row.week)
        .filter(
          (week) =>
            Number.isFinite(week) &&
            week <= data.currentWeek,
        ),
    ),
  ).sort((left, right) => left - right);

  return availableWeeks.slice(-4);
}

function buildMachineWeekMap(
  data: OeeWorkbookData,
  historyWeeks: number[],
): MachineWeekMap {
  const historyWeekSet = new Set(historyWeeks);
  const weekMap: MachineWeekMap = new Map();

  for (const row of data.operationalRows) {
    if (!historyWeekSet.has(row.week)) {
      continue;
    }

    const machine = row.machine.trim();

if (!machine) {
  continue;
}

const definition = resolveMachine(machine);

const key =
  definition?.id ??
  machine.toUpperCase().replace(/\s+/g, "_");

const department =
  definition?.department ??
  row.department.trim();


    const machineMap =
      weekMap.get(row.week) ??
      new Map<string, MachineAccumulator>();

    const current = machineMap.get(key) ?? {
      machine,
      department,
      availableMinutes: 0,
      usedMinutes: 0,
      registeredDowntimeMinutes: 0,
    };

    current.availableMinutes +=
      row.availableMinutes;

    current.usedMinutes +=
      row.usedMinutes;

    current.registeredDowntimeMinutes +=
      row.downtimeMinutes;

    machineMap.set(key, current);
    weekMap.set(row.week, machineMap);
  }

  return weekMap;
}

function getMachineStatus(
  availableMinutes: number,
  utilization: number,
  unclassifiedMinutes: number,
): OeeMachineStatus {
  if (availableMinutes <= 0) {
    return "inactive";
  }

  if (
    utilization >= 0.9 &&
    unclassifiedMinutes <= 0
  ) {
    return "positive";
  }

  if (
    utilization < 0.75 ||
    unclassifiedMinutes >= 1440
  ) {
    return "critical";
  }

  return "attention";
}

function buildExecutiveHeadline(
  status: OeeMachineStatus,
  unclassifiedMinutes: number,
): string {
  if (status === "inactive") {
    return "Máquina sin tiempo disponible registrado";
  }

  if (unclassifiedMinutes > 0) {
    return "Capacidad no utilizada sin causa documentada";
  }

  if (status === "positive") {
    return "Desempeño operativo favorable";
  }

  if (status === "critical") {
    return "Desempeño operativo crítico";
  }

  return "Desempeño operativo requiere atención";
}

function buildExecutiveMessage(
  machine: string,
  utilization: number,
  unclassifiedMinutes: number,
  plantImpact: number,
  availableMinutes: number,
): string {
  if (availableMinutes <= 0) {
    return (
      `${machine} no presenta tiempo disponible ` +
      "registrado durante la semana seleccionada."
    );
  }

  if (unclassifiedMinutes > 0) {
    return (
      `${machine} alcanzó una utilización de ` +
      `${formatPercent(utilization)} y concentra ` +
      `${formatMinutes(
        unclassifiedMinutes,
      )} minutos sin clasificación, equivalentes al ` +
      `${formatPercent(
        plantImpact,
      )} del total no clasificado de la planta.`
    );
  }

  return (
    `${machine} alcanzó una utilización de ` +
    `${formatPercent(utilization)}. La diferencia entre ` +
    "el tiempo disponible y el utilizado cuenta con " +
    "registro de paro."
  );
}

function buildHistoryRecord(
  week: number,
  machine:
    | MachineAccumulator
    | undefined,
): OeeMachineHistoryRecord {
  const availableMinutes =
    machine?.availableMinutes ?? 0;

  const usedMinutes =
    machine?.usedMinutes ?? 0;

  const registeredDowntimeMinutes =
    machine?.registeredDowntimeMinutes ?? 0;

  const unusedMinutes = Math.max(
    availableMinutes - usedMinutes,
    0,
  );

  const unclassifiedMinutes = Math.max(
    unusedMinutes - registeredDowntimeMinutes,
    0,
  );

  const utilization =
    availableMinutes > 0
      ? usedMinutes / availableMinutes
      : 0;

  return {
    week,
    availableMinutes: roundValue(
      availableMinutes,
      2,
    ),
    usedMinutes: roundValue(
      usedMinutes,
      2,
    ),
    unusedMinutes: roundValue(
      unusedMinutes,
      2,
    ),
    registeredDowntimeMinutes: roundValue(
      registeredDowntimeMinutes,
      2,
    ),
    unclassifiedMinutes: roundValue(
      unclassifiedMinutes,
      2,
    ),
    utilization: roundValue(utilization),
  };
}

export function buildOeeMachineAnalytics(
  data: OeeWorkbookData,
): OeeMachineAnalytics {
  const historyWeeks = getHistoryWeeks(data);
  const machineWeekMap = buildMachineWeekMap(
    data,
    historyWeeks,
  );

  const allMachineKeys = new Set<string>();

  for (const machineMap of machineWeekMap.values()) {
    for (const key of machineMap.keys()) {
      allMachineKeys.add(key);
    }
  }

  const currentMachineMap =
    machineWeekMap.get(data.currentWeek) ??
    new Map<string, MachineAccumulator>();

  const baseMachines = Array.from(
    allMachineKeys,
  ).map((key) => {
    const identity =
      currentMachineMap.get(key) ??
      historyWeeks
        .map((week) =>
          machineWeekMap.get(week)?.get(key),
        )
        .find(
          (
            machine,
          ): machine is MachineAccumulator =>
            Boolean(machine),
        );

    if (!identity) {
      return null;
    }

    const currentMachine =
      currentMachineMap.get(key);

    const current = buildHistoryRecord(
      data.currentWeek,
      currentMachine,
    );

    const documentedPercentage =
      current.unusedMinutes > 0
        ? Math.min(
            current.registeredDowntimeMinutes /
              current.unusedMinutes,
            1,
          )
        : 1;

    const history = historyWeeks.map((week) =>
      buildHistoryRecord(
        week,
        machineWeekMap.get(week)?.get(key),
      ),
    );

    return {
      key,
      machine: identity.machine,
      department:
  resolveMachine(identity.machine)
    ?.department ??
  identity.department,
      availableMinutes:
        current.availableMinutes,
      usedMinutes: current.usedMinutes,
      registeredDowntimeMinutes:
        current.registeredDowntimeMinutes,
      unusedMinutes: current.unusedMinutes,
      unclassifiedMinutes:
        current.unclassifiedMinutes,
      utilization: current.utilization,
      documentedPercentage,
      history,
    };
  }).filter(
    (
      machine,
    ): machine is NonNullable<
      typeof machine
    > => machine !== null,
  );

  const totalUnclassifiedMinutes =
    baseMachines.reduce(
      (total, machine) =>
        total + machine.unclassifiedMinutes,
      0,
    );

  const departmentUnclassifiedTotals =
    new Map<string, number>();

  for (const machine of baseMachines) {
    const definition = resolveMachine(
  machine.machine,
);

const departmentKey =
  definition?.department ??
  resolveMachine(machine.machine)
  ?.department ??
machine.department.toUpperCase()

    const current =
      departmentUnclassifiedTotals.get(
        departmentKey,
      ) ?? 0;

    departmentUnclassifiedTotals.set(
      departmentKey,
      current + machine.unclassifiedMinutes,
    );
  }

  const machines: OeeMachineAnalyticsRecord[] =
    baseMachines
      .map((machine) => {
        const departmentTotal =
          departmentUnclassifiedTotals.get(
            machine.department.toUpperCase(),
          ) ?? 0;

        const departmentUnclassifiedImpact =
          departmentTotal > 0
            ? machine.unclassifiedMinutes /
              departmentTotal
            : 0;

        const plantUnclassifiedImpact =
          totalUnclassifiedMinutes > 0
            ? machine.unclassifiedMinutes /
              totalUnclassifiedMinutes
            : 0;

        const status = getMachineStatus(
          machine.availableMinutes,
          machine.utilization,
          machine.unclassifiedMinutes,
        );

        return {
          key: machine.key,
          machine: machine.machine,
          department: machine.department,
          week: data.currentWeek,

          availableMinutes: roundValue(
            machine.availableMinutes,
            2,
          ),

          usedMinutes: roundValue(
            machine.usedMinutes,
            2,
          ),

          unusedMinutes: roundValue(
            machine.unusedMinutes,
            2,
          ),

          registeredDowntimeMinutes:
            roundValue(
              machine.registeredDowntimeMinutes,
              2,
            ),

          unclassifiedMinutes: roundValue(
            machine.unclassifiedMinutes,
            2,
          ),

          utilization: roundValue(
            machine.utilization,
          ),

          documentedPercentage: roundValue(
            machine.documentedPercentage,
          ),

          departmentUnclassifiedImpact:
            roundValue(
              departmentUnclassifiedImpact,
            ),

          plantUnclassifiedImpact:
            roundValue(
              plantUnclassifiedImpact,
            ),

          status,

          executiveHeadline:
            buildExecutiveHeadline(
              status,
              machine.unclassifiedMinutes,
            ),

          executiveMessage:
            buildExecutiveMessage(
              machine.machine,
              machine.utilization,
              machine.unclassifiedMinutes,
              plantUnclassifiedImpact,
              machine.availableMinutes,
            ),

          history: machine.history,
        };
      })
     .sort((left, right) => {
  const leftDefinition = resolveMachine(left.machine);
  const rightDefinition = resolveMachine(right.machine);

  const leftOrder = leftDefinition?.displayOrder ?? 9999;
  const rightOrder = rightDefinition?.displayOrder ?? 9999;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.machine.localeCompare(
    right.machine,
    "es-MX",
  );
});

  const activeMachines = machines.filter(
    (machine) =>
      machine.status !== "inactive",
  ).length;

  const inactiveMachines =
    machines.length - activeMachines;

  const machinesWithUnclassifiedTime =
    machines.filter(
      (machine) =>
        machine.unclassifiedMinutes > 0,
    ).length;

  return {
    week: data.currentWeek,
    totalMachines: machines.length,
    activeMachines,
    inactiveMachines,
    machinesWithUnclassifiedTime,
    totalUnclassifiedMinutes: roundValue(
      totalUnclassifiedMinutes,
      2,
    ),
    machines,
  };
}