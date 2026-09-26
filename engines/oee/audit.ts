import type {
  MachineUtilizationRecord,
  OeeOperationalRecord,
  OeeWorkbookData,
} from "@/types/oee";
import { resolveMachine } from "@/lib/catalogs";
export type OeeAuditStatus = "PASS" | "WARNING" | "FAIL";
export type OeeAuditSeverity = "INFO" | "WARNING" | "ERROR";
export type OeeAuditDepartmentKey = "INJECTION" | "ROTOMOLDING" | "OTHER";

export type OeeAuditIssueCode =
  | "OFFICIAL_DUPLICATE"
  | "OFFICIAL_NEGATIVE_VALUE"
  | "OFFICIAL_UTILIZATION_OVER_100"
  | "OFFICIAL_FORMULA_MISMATCH"
  | "OPERATIONAL_NEGATIVE_VALUE"
  | "OPERATIONAL_USED_OVER_AVAILABLE"
  | "SOURCE_MISSING_IN_OFFICIAL"
  | "SOURCE_MISSING_IN_OPERATIONAL"
  | "AVAILABLE_MINUTES_MISMATCH"
  | "USED_MINUTES_MISMATCH"
  | "UNKNOWN_MACHINE_DEPARTMENT";

export type OeeAuditIssue = {
  code: OeeAuditIssueCode;
  severity: OeeAuditSeverity;
  week: number;
  machine: string;
  department: OeeAuditDepartmentKey;
  message: string;
  officialValue: number | null;
  operationalValue: number | null;
  difference: number | null;
};

export type OeeAuditMachineRecord = {
  key: string;
  week: number;
  machine: string;
  department: OeeAuditDepartmentKey;
  officialRowCount: number;
  operationalRowCount: number;
  officialAvailableMinutes: number;
  officialUsedMinutes: number;
  officialReportedUtilization: number;
  officialCalculatedUtilization: number;
  operationalAvailableMinutes: number;
  operationalUsedMinutes: number;
  operationalCalculatedUtilization: number;
  availableDifferenceMinutes: number;
  usedDifferenceMinutes: number;
  utilizationDifference: number;
  status: OeeAuditStatus;
  issueCodes: OeeAuditIssueCode[];
};

export type OeeAuditDepartmentRecord = {
  key: OeeAuditDepartmentKey;
  department: string;
  week: number;
  machineCount: number;
  availableMinutes: number;
  usedMinutes: number;
  utilization: number;
  target: number;
  targetGap: number;
};

export type OeeAuditWeekRecord = {
  week: number;
  status: OeeAuditStatus;
  officialMachineCount: number;
  operationalMachineCount: number;
  reconciledMachineCount: number;
  failedMachineCount: number;
  warningMachineCount: number;
  officialAvailableMinutes: number;
  officialUsedMinutes: number;
  officialUtilization: number;
  departments: OeeAuditDepartmentRecord[];
  machines: OeeAuditMachineRecord[];
  issues: OeeAuditIssue[];
};

export type OeeAuditResult = {
  currentWeek: number;
  status: OeeAuditStatus;
  generatedAt: string;
  sourceFile: string;
  sourceSheet: string;
  toleranceMinutes: number;
  toleranceUtilization: number;
  current: OeeAuditWeekRecord;
  history: OeeAuditWeekRecord[];
  totals: {
    weeksAudited: number;
    machinesAudited: number;
    passedMachines: number;
    warningMachines: number;
    failedMachines: number;
    issues: number;
    errors: number;
    warnings: number;
  };
};

type OfficialAccumulator = {
  machine: string;
  week: number;
  rows: MachineUtilizationRecord[];
  availableMinutes: number;
  usedMinutes: number;
  weightedUtilizationTotal: number;
  utilizationWeight: number;
};

type OperationalAccumulator = {
  machine: string;
  week: number;
  rows: OeeOperationalRecord[];
  availableMinutes: number;
  usedMinutes: number;
};

type AuditOptions = {
  toleranceMinutes: number;
  toleranceUtilization: number;
  target: number;
};

const DEFAULT_OPTIONS: AuditOptions = {
  toleranceMinutes: 0.5,
  toleranceUtilization: 0.0005,
  target: 0.9,
};


function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeMachineKey(week: number, machine: string): string {
  return `${week}::${normalizeText(machine)}`;
}

function classifyMachineDepartment(
  machine: string,
): OeeAuditDepartmentKey {
  const definition = resolveMachine(machine);

  if (!definition) {
    return "OTHER";
  }

  switch (definition.department) {
    case "INJECTION":
      return "INJECTION";

    case "ROTOMOLDING":
      return "ROTOMOLDING";

    default:
      return "OTHER";
  }
}

function getDepartmentName(key: OeeAuditDepartmentKey): string {
  if (key === "INJECTION") {
    return "Inyección";
  }

  if (key === "ROTOMOLDING") {
    return "Rotomoldeo";
  }

  return "Otros";
}

function roundValue(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function calculateUtilization(usedMinutes: number, availableMinutes: number): number {
  return availableMinutes > 0 ? usedMinutes / availableMinutes : 0;
}

function getStatusFromSeverities(severities: OeeAuditSeverity[]): OeeAuditStatus {
  if (severities.includes("ERROR")) {
    return "FAIL";
  }

  if (severities.includes("WARNING")) {
    return "WARNING";
  }

  return "PASS";
}

function createIssue(
  issue: Omit<OeeAuditIssue, "department"> & {
    department?: OeeAuditDepartmentKey;
  },
): OeeAuditIssue {
  return {
    ...issue,
    department: issue.department ?? classifyMachineDepartment(issue.machine),
  };
}

function buildOfficialMap(
  rows: MachineUtilizationRecord[],
): Map<string, OfficialAccumulator> {
  const map = new Map<string, OfficialAccumulator>();

  for (const row of rows) {
    const key = normalizeMachineKey(row.week, row.machine);
    const current = map.get(key) ?? {
      machine: row.machine.trim(),
      week: row.week,
      rows: [],
      availableMinutes: 0,
      usedMinutes: 0,
      weightedUtilizationTotal: 0,
      utilizationWeight: 0,
    };

    current.rows.push(row);
    current.availableMinutes += row.availableMinutes;
    current.usedMinutes += row.usedMinutes;

    const weight = row.availableMinutes > 0 ? row.availableMinutes : 1;
    current.weightedUtilizationTotal += row.utilization * weight;
    current.utilizationWeight += weight;

    map.set(key, current);
  }

  return map;
}

function buildOperationalMap(
  rows: OeeOperationalRecord[],
): Map<string, OperationalAccumulator> {
  const map = new Map<string, OperationalAccumulator>();

  for (const row of rows) {
    const key = normalizeMachineKey(row.week, row.machine);
    const current = map.get(key) ?? {
      machine: row.machine.trim(),
      week: row.week,
      rows: [],
      availableMinutes: 0,
      usedMinutes: 0,
    };

    current.rows.push(row);
    current.availableMinutes += row.availableMinutes;
    current.usedMinutes += row.usedMinutes;
    map.set(key, current);
  }

  return map;
}

function auditMachine(
  key: string,
  official: OfficialAccumulator | undefined,
  operational: OperationalAccumulator | undefined,
  options: AuditOptions,
): { machine: OeeAuditMachineRecord; issues: OeeAuditIssue[] } {
  const week = official?.week ?? operational?.week ?? 0;
  const machineName =
    official?.machine ?? operational?.machine ?? "Máquina desconocida";
  const department = classifyMachineDepartment(machineName);
  const issues: OeeAuditIssue[] = [];

  const officialAvailableMinutes = official?.availableMinutes ?? 0;
  const officialUsedMinutes = official?.usedMinutes ?? 0;
  const officialReportedUtilization =
    official && official.utilizationWeight > 0
      ? official.weightedUtilizationTotal / official.utilizationWeight
      : 0;
  const officialCalculatedUtilization = calculateUtilization(
    officialUsedMinutes,
    officialAvailableMinutes,
  );

  const operationalAvailableMinutes = operational?.availableMinutes ?? 0;
  const operationalUsedMinutes = operational?.usedMinutes ?? 0;
  const operationalCalculatedUtilization = calculateUtilization(
    operationalUsedMinutes,
    operationalAvailableMinutes,
  );

  if (department === "OTHER") {
    issues.push(createIssue({
      code: "UNKNOWN_MACHINE_DEPARTMENT",
      severity: "WARNING",
      week,
      machine: machineName,
      message: "La máquina no está incluida en el catálogo de Inyección o Rotomoldeo.",
      officialValue: null,
      operationalValue: null,
      difference: null,
    }));
  }

  if (official && official.rows.length > 1) {
    issues.push(createIssue({
      code: "OFFICIAL_DUPLICATE",
      severity: "ERROR",
      week,
      machine: machineName,
      message: `La tabla oficial AE:AJ contiene ${official.rows.length} filas para la misma máquina y semana.`,
      officialValue: official.rows.length,
      operationalValue: null,
      difference: null,
    }));
  }

  if (officialAvailableMinutes < 0 || officialUsedMinutes < 0) {
    issues.push(createIssue({
      code: "OFFICIAL_NEGATIVE_VALUE",
      severity: "ERROR",
      week,
      machine: machineName,
      message: "La tabla oficial contiene minutos negativos.",
      officialValue: Math.min(officialAvailableMinutes, officialUsedMinutes),
      operationalValue: null,
      difference: null,
    }));
  }

  if (officialReportedUtilization > 1 + options.toleranceUtilization) {
    issues.push(createIssue({
      code: "OFFICIAL_UTILIZATION_OVER_100",
      severity: "ERROR",
      week,
      machine: machineName,
      message: "La utilización oficial supera el 100%.",
      officialValue: officialReportedUtilization,
      operationalValue: null,
      difference: officialReportedUtilization - 1,
    }));
  }

  if (
    official &&
    Math.abs(
      officialReportedUtilization - officialCalculatedUtilization,
    ) > options.toleranceUtilization
  ) {
    issues.push(createIssue({
      code: "OFFICIAL_FORMULA_MISMATCH",
      severity: "ERROR",
      week,
      machine: machineName,
      message: "La utilización reportada en AH no coincide con AG dividido entre AF.",
      officialValue: officialReportedUtilization,
      operationalValue: officialCalculatedUtilization,
      difference:
        officialReportedUtilization - officialCalculatedUtilization,
    }));
  }

  if (
    operational &&
    (operationalAvailableMinutes < 0 || operationalUsedMinutes < 0)
  ) {
    issues.push(createIssue({
      code: "OPERATIONAL_NEGATIVE_VALUE",
      severity: "ERROR",
      week,
      machine: machineName,
      message: "La tabla operativa A:P contiene minutos negativos.",
      officialValue: null,
      operationalValue: Math.min(
        operationalAvailableMinutes,
        operationalUsedMinutes,
      ),
      difference: null,
    }));
  }

  if (
    operationalUsedMinutes >
    operationalAvailableMinutes + options.toleranceMinutes
  ) {
    issues.push(createIssue({
      code: "OPERATIONAL_USED_OVER_AVAILABLE",
      severity: "ERROR",
      week,
      machine: machineName,
      message: "El tiempo utilizado de A:P supera el tiempo disponible.",
      officialValue: operationalAvailableMinutes,
      operationalValue: operationalUsedMinutes,
      difference:
        operationalUsedMinutes - operationalAvailableMinutes,
    }));
  }

  if (!official && operational) {
    issues.push(createIssue({
      code: "SOURCE_MISSING_IN_OFFICIAL",
      severity: "ERROR",
      week,
      machine: machineName,
      message: "La máquina existe en A:P, pero no aparece en la tabla oficial AE:AJ.",
      officialValue: null,
      operationalValue: operationalUsedMinutes,
      difference: null,
    }));
  }

  if (official && !operational) {
    issues.push(createIssue({
      code: "SOURCE_MISSING_IN_OPERATIONAL",
      severity: "WARNING",
      week,
      machine: machineName,
      message: "La máquina existe en AE:AJ, pero no tiene filas operativas en A:P.",
      officialValue: officialUsedMinutes,
      operationalValue: null,
      difference: null,
    }));
  }

  if (official && operational) {
    const availableDifference =
      operationalAvailableMinutes - officialAvailableMinutes;
    const usedDifference =
      operationalUsedMinutes - officialUsedMinutes;

    if (Math.abs(availableDifference) > options.toleranceMinutes) {
      issues.push(createIssue({
        code: "AVAILABLE_MINUTES_MISMATCH",
        severity: "ERROR",
        week,
        machine: machineName,
        message: "Los minutos disponibles de A:P no coinciden con AF.",
        officialValue: officialAvailableMinutes,
        operationalValue: operationalAvailableMinutes,
        difference: availableDifference,
      }));
    }

    if (Math.abs(usedDifference) > options.toleranceMinutes) {
      issues.push(createIssue({
        code: "USED_MINUTES_MISMATCH",
        severity: "ERROR",
        week,
        machine: machineName,
        message: "Los minutos utilizados de A:P no coinciden con AG.",
        officialValue: officialUsedMinutes,
        operationalValue: operationalUsedMinutes,
        difference: usedDifference,
      }));
    }
  }

  const issueCodes = Array.from(new Set(issues.map((issue) => issue.code)));
  const status = getStatusFromSeverities(
    issues.map((issue) => issue.severity),
  );

  return {
    machine: {
      key,
      week,
      machine: machineName,
      department,
      officialRowCount: official?.rows.length ?? 0,
      operationalRowCount: operational?.rows.length ?? 0,
      officialAvailableMinutes: roundValue(officialAvailableMinutes, 2),
      officialUsedMinutes: roundValue(officialUsedMinutes, 2),
      officialReportedUtilization: roundValue(officialReportedUtilization),
      officialCalculatedUtilization: roundValue(officialCalculatedUtilization),
      operationalAvailableMinutes: roundValue(
        operationalAvailableMinutes,
        2,
      ),
      operationalUsedMinutes: roundValue(operationalUsedMinutes, 2),
      operationalCalculatedUtilization: roundValue(
        operationalCalculatedUtilization,
      ),
      availableDifferenceMinutes: roundValue(
        operationalAvailableMinutes - officialAvailableMinutes,
        2,
      ),
      usedDifferenceMinutes: roundValue(
        operationalUsedMinutes - officialUsedMinutes,
        2,
      ),
      utilizationDifference: roundValue(
        operationalCalculatedUtilization - officialCalculatedUtilization,
      ),
      status,
      issueCodes,
    },
    issues,
  };
}

function buildDepartmentRecords(
  week: number,
  machines: OeeAuditMachineRecord[],
  target: number,
): OeeAuditDepartmentRecord[] {
  const departmentKeys: OeeAuditDepartmentKey[] = [
    "INJECTION",
    "ROTOMOLDING",
    "OTHER",
  ];

  return departmentKeys
    .map((departmentKey) => {
      const departmentMachines = machines.filter(
        (machine) => machine.department === departmentKey,
      );

      const availableMinutes = departmentMachines.reduce(
        (total, machine) =>
          total + machine.officialAvailableMinutes,
        0,
      );

      const usedMinutes = departmentMachines.reduce(
        (total, machine) => total + machine.officialUsedMinutes,
        0,
      );

      const utilization = calculateUtilization(
        usedMinutes,
        availableMinutes,
      );

      return {
        key: departmentKey,
        department: getDepartmentName(departmentKey),
        week,
        machineCount: departmentMachines.length,
        availableMinutes: roundValue(availableMinutes, 2),
        usedMinutes: roundValue(usedMinutes, 2),
        utilization: roundValue(utilization),
        target,
        targetGap: roundValue(utilization - target),
      };
    })
    .filter((department) => department.machineCount > 0);
}

function auditWeek(
  week: number,
  officialMap: Map<string, OfficialAccumulator>,
  operationalMap: Map<string, OperationalAccumulator>,
  options: AuditOptions,
): OeeAuditWeekRecord {
  const keys = new Set<string>();

  for (const [key, value] of officialMap.entries()) {
    if (value.week === week) {
      keys.add(key);
    }
  }

  for (const [key, value] of operationalMap.entries()) {
    if (value.week === week) {
      keys.add(key);
    }
  }

  const machineResults = Array.from(keys)
    .map((key) =>
      auditMachine(
        key,
        officialMap.get(key),
        operationalMap.get(key),
        options,
      ),
    )
    .sort((left, right) =>
      left.machine.machine.localeCompare(
        right.machine.machine,
        "es-MX",
      ),
    );

  const machines = machineResults.map((result) => result.machine);
  const issues = machineResults.flatMap((result) => result.issues);
  const officialMachines = machines.filter(
    (machine) => machine.officialRowCount > 0,
  );
  const operationalMachines = machines.filter(
    (machine) => machine.operationalRowCount > 0,
  );

  const officialAvailableMinutes = officialMachines.reduce(
    (total, machine) =>
      total + machine.officialAvailableMinutes,
    0,
  );
  const officialUsedMinutes = officialMachines.reduce(
    (total, machine) =>
      total + machine.officialUsedMinutes,
    0,
  );

  return {
    week,
    status: getStatusFromSeverities(
      issues.map((issue) => issue.severity),
    ),
    officialMachineCount: officialMachines.length,
    operationalMachineCount: operationalMachines.length,
    reconciledMachineCount: machines.filter(
      (machine) => machine.status === "PASS",
    ).length,
    failedMachineCount: machines.filter(
      (machine) => machine.status === "FAIL",
    ).length,
    warningMachineCount: machines.filter(
      (machine) => machine.status === "WARNING",
    ).length,
    officialAvailableMinutes: roundValue(
      officialAvailableMinutes,
      2,
    ),
    officialUsedMinutes: roundValue(officialUsedMinutes, 2),
    officialUtilization: roundValue(
      calculateUtilization(
        officialUsedMinutes,
        officialAvailableMinutes,
      ),
    ),
    departments: buildDepartmentRecords(
      week,
      machines,
      options.target,
    ),
    machines,
    issues,
  };
}

export function buildOeeAudit(
  data: OeeWorkbookData,
  customOptions: Partial<AuditOptions> = {},
): OeeAuditResult {
  const options: AuditOptions = {
    ...DEFAULT_OPTIONS,
    ...customOptions,
  };

  const officialMap = buildOfficialMap(data.machines);
  const operationalMap = buildOperationalMap(
    data.operationalRows,
  );

  const weeks = Array.from(
    new Set([
      ...data.machines.map((record) => record.week),
      ...data.operationalRows.map((record) => record.week),
    ]),
  )
    .filter(
      (week) =>
        Number.isFinite(week) &&
        week <= data.currentWeek,
    )
    .sort((left, right) => left - right);

  const history = weeks.map((week) =>
    auditWeek(
      week,
      officialMap,
      operationalMap,
      options,
    ),
  );

  const current =
    history.find(
      (record) => record.week === data.currentWeek,
    ) ??
    auditWeek(
      data.currentWeek,
      officialMap,
      operationalMap,
      options,
    );

  const allMachines = history.flatMap(
    (record) => record.machines,
  );
  const allIssues = history.flatMap(
    (record) => record.issues,
  );

  return {
    currentWeek: data.currentWeek,
    status: current.status,
    generatedAt: new Date().toISOString(),
    sourceFile: data.sourceFile,
    sourceSheet: data.sourceSheet,
    toleranceMinutes: options.toleranceMinutes,
    toleranceUtilization:
      options.toleranceUtilization,
    current,
    history,
    totals: {
      weeksAudited: history.length,
      machinesAudited: allMachines.length,
      passedMachines: allMachines.filter(
        (machine) => machine.status === "PASS",
      ).length,
      warningMachines: allMachines.filter(
        (machine) => machine.status === "WARNING",
      ).length,
      failedMachines: allMachines.filter(
        (machine) => machine.status === "FAIL",
      ).length,
      issues: allIssues.length,
      errors: allIssues.filter(
        (issue) => issue.severity === "ERROR",
      ).length,
      warnings: allIssues.filter(
        (issue) => issue.severity === "WARNING",
      ).length,
    },
  };
}