import type {
  OeeOperationalRecord,
  OeeWorkbookData,
} from "@/types/oee";
import { resolveMachine } from "@/lib/catalogs";
export type OeeDepartmentKey =
  | "INJECTION"
  | "ROTOMOLDING"
  | "OTHER";

export type OeeDepartmentHistoryRecord = {
  week: number;
  availableMinutes: number;
  usedMinutes: number;
  downtimeMinutes: number;
  utilization: number;
};

export type OeeDepartmentRecord = {
  key: OeeDepartmentKey;
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
  history: OeeDepartmentHistoryRecord[];
};

export type OeeDepartmentAnalytics = {
  week: number;
  departments: OeeDepartmentRecord[];
};

type DepartmentDefinition = {
  key: OeeDepartmentKey;
  name: string;
  target: number;
};

type DepartmentAccumulator = {
  availableMinutes: number;
  usedMinutes: number;
  downtimeMinutes: number;
  machines: Set<string>;
};

const DEPARTMENT_TARGET = 0.9;

const INJECTION_DEPARTMENT: DepartmentDefinition = {
  key: "INJECTION",
  name: "Inyección",
  target: DEPARTMENT_TARGET,
};

const ROTOMOLDING_DEPARTMENT: DepartmentDefinition = {
  key: "ROTOMOLDING",
  name: "Rotomoldeo",
  target: DEPARTMENT_TARGET,
};

const OTHER_DEPARTMENT: DepartmentDefinition = {
  key: "OTHER",
  name: "Otros",
  target: DEPARTMENT_TARGET,
};

function classifyDepartment(
  machine: string,
): DepartmentDefinition {
  const definition = resolveMachine(machine);

  if (!definition) {
    return OTHER_DEPARTMENT;
  }

  switch (definition.department) {
    case "INJECTION":
      return INJECTION_DEPARTMENT;

    case "ROTOMOLDING":
      return ROTOMOLDING_DEPARTMENT;

    default:
      return OTHER_DEPARTMENT;
  }
}



function createAccumulator(): DepartmentAccumulator {
  return {
    availableMinutes: 0,
    usedMinutes: 0,
    downtimeMinutes: 0,
    machines: new Set<string>(),
  };
}

function calculateUtilization(
  usedMinutes: number,
  availableMinutes: number,
): number {
  if (availableMinutes <= 0) {
    return 0;
  }

  return usedMinutes / availableMinutes;
}

function roundValue(
  value: number,
  decimals = 6,
): number {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

function aggregateRows(
  rows: OeeOperationalRecord[],
): Map<OeeDepartmentKey, DepartmentAccumulator> {
  const aggregation = new Map<
    OeeDepartmentKey,
    DepartmentAccumulator
  >();

  for (const row of rows) {
   const definition = classifyDepartment(
  row.machine,
);

    const current =
      aggregation.get(definition.key) ??
      createAccumulator();

    current.availableMinutes += row.availableMinutes;
    current.usedMinutes += row.usedMinutes;
    current.downtimeMinutes += row.downtimeMinutes;

    if (row.machine.trim()) {
      current.machines.add(row.machine.trim());
    }

    aggregation.set(definition.key, current);
  }

  return aggregation;
}

function getDefinition(
  key: OeeDepartmentKey,
): DepartmentDefinition {
  if (key === "INJECTION") {
    return INJECTION_DEPARTMENT;
  }

  if (key === "ROTOMOLDING") {
    return ROTOMOLDING_DEPARTMENT;
  }

  return OTHER_DEPARTMENT;
}

function buildDepartmentHistory(
  data: OeeWorkbookData,
  departmentKey: OeeDepartmentKey,
): OeeDepartmentHistoryRecord[] {
  const availableWeeks = Array.from(
    new Set(
      data.operationalRows.map((row) => row.week),
    ),
  )
    .filter((week) => week <= data.currentWeek)
    .sort((left, right) => left - right);

  return availableWeeks.map((week) => {
    const rows = data.operationalRows.filter(
  (row) =>
    row.week === week &&
    classifyDepartment(row.machine).key ===
      departmentKey,
);

    const availableMinutes = rows.reduce(
      (total, row) =>
        total + row.availableMinutes,
      0,
    );

    const usedMinutes = rows.reduce(
      (total, row) => total + row.usedMinutes,
      0,
    );

    const downtimeMinutes = rows.reduce(
      (total, row) =>
        total + row.downtimeMinutes,
      0,
    );

    return {
      week,
      availableMinutes: roundValue(
        availableMinutes,
        2,
      ),
      usedMinutes: roundValue(usedMinutes, 2),
      downtimeMinutes: roundValue(
        downtimeMinutes,
        2,
      ),
      utilization: roundValue(
        calculateUtilization(
          usedMinutes,
          availableMinutes,
        ),
      ),
    };
  });
}

export function buildOeeDepartmentAnalytics(
  data: OeeWorkbookData,
): OeeDepartmentAnalytics {
  const currentWeekRows =
    data.operationalRows.filter(
      (row) => row.week === data.currentWeek,
    );

  const currentAggregation =
    aggregateRows(currentWeekRows);

  const departmentKeys: OeeDepartmentKey[] = [
    "INJECTION",
    "ROTOMOLDING",
  ];

  const departments = departmentKeys.map(
    (departmentKey): OeeDepartmentRecord => {
      const definition =
        getDefinition(departmentKey);

      const current =
        currentAggregation.get(departmentKey) ??
        createAccumulator();

      const history = buildDepartmentHistory(
        data,
        departmentKey,
      );

      const previousRecords = history.filter(
        (record) =>
          record.week < data.currentWeek,
      );

      const previousRecord =
        previousRecords.length > 0
          ? previousRecords[
              previousRecords.length - 1
            ]
          : null;

      const utilization = roundValue(
        calculateUtilization(
          current.usedMinutes,
          current.availableMinutes,
        ),
      );

      const previousWeekUtilization =
        previousRecord?.utilization ?? null;

      const variation =
        previousWeekUtilization === null
          ? null
          : roundValue(
              utilization -
                previousWeekUtilization,
            );

      return {
        key: definition.key,
        department: definition.name,
        week: data.currentWeek,
        target: definition.target,
        availableMinutes: roundValue(
          current.availableMinutes,
          2,
        ),
        usedMinutes: roundValue(
          current.usedMinutes,
          2,
        ),
        downtimeMinutes: roundValue(
          current.downtimeMinutes,
          2,
        ),
        utilization,
        targetGap: roundValue(
          utilization - definition.target,
        ),
        previousWeekUtilization,
        variation,
        machineCount: current.machines.size,
        machines: Array.from(
          current.machines,
        ).sort((left, right) =>
          left.localeCompare(right),
        ),
        history,
      };
    },
  );

  return {
    week: data.currentWeek,
    departments,
  };
}