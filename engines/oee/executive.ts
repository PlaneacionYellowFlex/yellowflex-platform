import type { OeeWorkbookData } from "@/types/oee";
import { resolveMachine } from "@/lib/catalogs";
import type {
  OeeDepartmentAnalytics,
  OeeDepartmentRecord,
} from "./department";

export type OeeExecutiveStatus =
  | "positive"
  | "attention"
  | "critical"
  | "neutral";

export type OeeExecutiveFindingType =
  | "strength"
  | "risk"
  | "opportunity"
  | "information";

export type OeeExecutiveFinding = {
  id: string;
  type: OeeExecutiveFindingType;
  title: string;
  message: string;
  value: number | null;
  unit: "percentage-points" | "minutes" | "percent" | null;
  department: string | null;
  machine: string | null;
};

export type OeeExecutiveCapacity = {
  availableMinutes: number;
  usedMinutes: number;
  unusedMinutes: number;
  registeredDowntimeMinutes: number;
  unclassifiedMinutes: number;
  documentedPercentage: number;
};

export type OeeExecutiveDepartment = {
  key: string;
  department: string;
  status: OeeExecutiveStatus;
  utilization: number;
  target: number;
  targetGap: number;
  variation: number | null;
  headline: string;
  message: string;
};

export type OeeExecutiveAnalytics = {
  week: number;
  overallStatus: OeeExecutiveStatus;
  headline: string;
  executiveSummary: string;
  capacity: OeeExecutiveCapacity;
  departments: OeeExecutiveDepartment[];
  findings: OeeExecutiveFinding[];
};

type MachineAccumulator = {
  machine: string;
  department: string;
  availableMinutes: number;
  usedMinutes: number;
  registeredDowntimeMinutes: number;
};

function roundValue(
  value: number,
  decimals = 2,
): number {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPoints(
  value: number,
  includePositiveSign = false,
): string {
  const points = value * 100;

  const sign =
    includePositiveSign && points > 0
      ? "+"
      : "";

  return `${sign}${Math.abs(points).toFixed(1)} puntos`;
}

function formatMinutes(value: number): string {
  return Math.round(value).toLocaleString("es-MX");
}

function getDepartmentStatus(
  department: OeeDepartmentRecord,
): OeeExecutiveStatus {
  if (department.utilization >= department.target) {
    return "positive";
  }

  if (department.targetGap >= -0.05) {
    return "attention";
  }

  return "critical";
}

function buildDepartmentMessage(
  department: OeeDepartmentRecord,
): string {
  const utilizationText = formatPercent(
    department.utilization,
  );

  const targetText = formatPercent(
    department.target,
  );

  const gapText = formatPoints(
    department.targetGap,
  );

  const comparisonText =
    department.targetGap >= 0
      ? `${gapText} por encima`
      : `${gapText} por debajo`;

  if (department.variation === null) {
    return (
      `${department.department} cerró la semana ` +
      `${department.week} con una utilización de ` +
      `${utilizationText}, ${comparisonText} de la ` +
      `meta de ${targetText}.`
    );
  }

  const variationText = formatPoints(
    department.variation,
  );

  const trendText =
    department.variation > 0
      ? `mejoró ${variationText}`
      : department.variation < 0
        ? `disminuyó ${variationText}`
        : "se mantuvo sin variación";

  return (
    `${department.department} cerró la semana ` +
    `${department.week} con una utilización de ` +
    `${utilizationText}, ${comparisonText} de la ` +
    `meta de ${targetText}. Respecto a la semana ` +
    `anterior, ${trendText}.`
  );
}

function buildDepartmentHeadline(
  department: OeeDepartmentRecord,
): string {
  if (department.targetGap >= 0) {
    return `${department.department} supera la meta`;
  }

  if (
    department.variation !== null &&
    department.variation > 0
  ) {
    return (
      `${department.department} mejora, pero continúa ` +
      "por debajo de la meta"
    );
  }

  return `${department.department} requiere atención`;
}

function buildDepartmentExecutiveRecords(
  analytics: OeeDepartmentAnalytics,
): OeeExecutiveDepartment[] {
  return analytics.departments.map((department) => ({
    key: department.key,
    department: department.department,
    status: getDepartmentStatus(department),
    utilization: department.utilization,
    target: department.target,
    targetGap: department.targetGap,
    variation: department.variation,
    headline: buildDepartmentHeadline(department),
    message: buildDepartmentMessage(department),
  }));
}

function buildCapacity(
  data: OeeWorkbookData,
): OeeExecutiveCapacity {
  const currentRows = data.operationalRows.filter(
    (row) => row.week === data.currentWeek,
  );

  const availableMinutes = currentRows.reduce(
    (total, row) => total + row.availableMinutes,
    0,
  );

  const usedMinutes = currentRows.reduce(
    (total, row) => total + row.usedMinutes,
    0,
  );

  const registeredDowntimeMinutes = currentRows.reduce(
    (total, row) => total + row.downtimeMinutes,
    0,
  );

  const unusedMinutes = Math.max(
    availableMinutes - usedMinutes,
    0,
  );

  const unclassifiedMinutes = Math.max(
    unusedMinutes - registeredDowntimeMinutes,
    0,
  );

  const documentedPercentage =
    unusedMinutes > 0
      ? registeredDowntimeMinutes / unusedMinutes
      : 1;

  return {
    availableMinutes: roundValue(availableMinutes),
    usedMinutes: roundValue(usedMinutes),
    unusedMinutes: roundValue(unusedMinutes),
    registeredDowntimeMinutes: roundValue(
      registeredDowntimeMinutes,
    ),
    unclassifiedMinutes: roundValue(
      unclassifiedMinutes,
    ),
    documentedPercentage: roundValue(
      documentedPercentage,
      6,
    ),
  };
}

function buildMachineMap(
  data: OeeWorkbookData,
): Map<string, MachineAccumulator> {
  const machineMap = new Map<
    string,
    MachineAccumulator
  >();

  const currentRows = data.operationalRows.filter(
    (row) => row.week === data.currentWeek,
  );

  for (const row of currentRows) {
    const definition = resolveMachine(
  row.machine,
);

const key =
  definition?.id ??
  row.machine
    .trim()
    .toUpperCase();

const current = machineMap.get(key) ?? {
  machine: row.machine.trim(),
  department:
    definition?.department ??
    row.department.trim(),
      availableMinutes: 0,
      usedMinutes: 0,
      registeredDowntimeMinutes: 0,
    };

    current.availableMinutes += row.availableMinutes;
    current.usedMinutes += row.usedMinutes;
    current.registeredDowntimeMinutes +=
      row.downtimeMinutes;

    machineMap.set(key, current);
  }

  return machineMap;
}

function buildDepartmentFindings(
  departments: OeeDepartmentAnalytics,
): OeeExecutiveFinding[] {
  const findings: OeeExecutiveFinding[] = [];

  for (const department of departments.departments) {
    if (department.targetGap >= 0) {
      findings.push({
        id: `department-strength-${department.key}`,
        type: "strength",
        title: `${department.department} supera el objetivo`,
        message:
          `${department.department} alcanzó ` +
          `${formatPercent(department.utilization)}, ` +
          `${formatPoints(department.targetGap)} por ` +
          "encima de la meta.",
        value: department.targetGap,
        unit: "percentage-points",
        department: department.department,
        machine: null,
      });

      continue;
    }

    findings.push({
      id: `department-risk-${department.key}`,
      type: "risk",
      title: `${department.department} debajo de la meta`,
      message:
        `${department.department} alcanzó ` +
        `${formatPercent(department.utilization)}, ` +
        `${formatPoints(
          Math.abs(department.targetGap),
        )} por debajo del objetivo.`,
      value: department.targetGap,
      unit: "percentage-points",
      department: department.department,
      machine: null,
    });

    if (
      department.variation !== null &&
      department.variation > 0
    ) {
      findings.push({
        id: `department-recovery-${department.key}`,
        type: "opportunity",
        title: `${department.department} muestra recuperación`,
        message:
          `La utilización mejoró ` +
          `${formatPoints(
            department.variation,
            true,
          )} ` +
          "respecto a la semana anterior, aunque todavía " +
          "no alcanza la meta.",
        value: department.variation,
        unit: "percentage-points",
        department: department.department,
        machine: null,
      });
    }
  }

  return findings;
}

function buildCapacityFindings(
  data: OeeWorkbookData,
  capacity: OeeExecutiveCapacity,
): OeeExecutiveFinding[] {
  const findings: OeeExecutiveFinding[] = [];

  if (capacity.unclassifiedMinutes <= 0) {
    findings.push({
      id: "capacity-complete-documentation",
      type: "strength",
      title: "Capacidad no utilizada completamente documentada",
      message:
        "La diferencia entre el tiempo disponible y el " +
        "tiempo utilizado cuenta con registro de tiempo muerto.",
      value: 1,
      unit: "percent",
      department: null,
      machine: null,
    });

    return findings;
  }

  const unclassifiedShare =
    capacity.unusedMinutes > 0
      ? capacity.unclassifiedMinutes /
        capacity.unusedMinutes
      : 0;

  findings.push({
    id: "capacity-unclassified",
    type: "risk",
    title: "Capacidad no utilizada sin causa registrada",
    message:
      `Se detectaron ${formatMinutes(
        capacity.unclassifiedMinutes,
      )} minutos sin clasificación, equivalentes al ` +
      `${formatPercent(unclassifiedShare)} del tiempo ` +
      "no utilizado.",
    value: capacity.unclassifiedMinutes,
    unit: "minutes",
    department: null,
    machine: null,
  });

  const machines = Array.from(
    buildMachineMap(data).values(),
  )
    .map((machine) => {
      const unusedMinutes = Math.max(
        machine.availableMinutes -
          machine.usedMinutes,
        0,
      );

      const unclassifiedMinutes = Math.max(
        unusedMinutes -
          machine.registeredDowntimeMinutes,
        0,
      );

      return {
        ...machine,
        unclassifiedMinutes,
      };
    })
    .filter(
      (machine) =>
        machine.unclassifiedMinutes > 0,
    )
    .sort(
      (left, right) =>
        right.unclassifiedMinutes -
        left.unclassifiedMinutes,
    );

  for (const machine of machines) {
    findings.push({
      id:
  "machine-unclassified-" +
  (
    resolveMachine(machine.machine)
      ?.id.toLowerCase() ??
    machine.machine
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
  ),
  
      type: "opportunity",
      title: `${machine.machine} requiere revisión de captura`,
      message:
        `${machine.machine} concentra ` +
        `${formatMinutes(
          machine.unclassifiedMinutes,
        )} minutos de capacidad no utilizada sin causa ` +
        "registrada.",
      value: roundValue(
        machine.unclassifiedMinutes,
      ),
      unit: "minutes",
      department:
  resolveMachine(machine.machine)
    ?.department ??
  machine.department,
      machine: machine.machine,
    });
  }

  return findings;
}

function getOverallStatus(
  departments: OeeExecutiveDepartment[],
  capacity: OeeExecutiveCapacity,
): OeeExecutiveStatus {
  const hasCriticalDepartment = departments.some(
    (department) =>
      department.status === "critical",
  );

  if (hasCriticalDepartment) {
    return "critical";
  }

  const hasDepartmentBelowTarget =
    departments.some(
      (department) =>
        department.status === "attention",
    );

  if (
    hasDepartmentBelowTarget ||
    capacity.unclassifiedMinutes > 0
  ) {
    return "attention";
  }

  if (
    departments.length > 0 &&
    departments.every(
      (department) =>
        department.status === "positive",
    )
  ) {
    return "positive";
  }

  return "neutral";
}

function buildHeadline(
  status: OeeExecutiveStatus,
  week: number,
): string {
  if (status === "positive") {
    return `Semana ${week}: desempeño operativo favorable`;
  }

  if (status === "critical") {
    return `Semana ${week}: desviaciones críticas requieren intervención`;
  }

  if (status === "attention") {
    return `Semana ${week}: desempeño mixto con oportunidades de control`;
  }

  return `Semana ${week}: información operativa disponible`;
}

function buildExecutiveSummary(
  week: number,
  departments: OeeExecutiveDepartment[],
  capacity: OeeExecutiveCapacity,
): string {
  const departmentMessages = departments
    .map((department) => department.message)
    .join(" ");

  const capacityMessage =
    capacity.unclassifiedMinutes > 0
      ? (
          `La planta dejó de utilizar ` +
          `${formatMinutes(
            capacity.unusedMinutes,
          )} minutos de capacidad. De este total, ` +
          `${formatMinutes(
            capacity.registeredDowntimeMinutes,
          )} minutos cuentan con registro de paro y ` +
          `${formatMinutes(
            capacity.unclassifiedMinutes,
          )} minutos permanecen sin una causa documentada.`
        )
      : (
          `Los ${formatMinutes(
            capacity.unusedMinutes,
          )} minutos de capacidad no utilizada cuentan ` +
          "con registro de tiempo muerto."
        );

  return (
    `Durante la semana ${week}, ` +
    `${departmentMessages} ${capacityMessage}`
  );
}

export function buildOeeExecutiveAnalytics(
  data: OeeWorkbookData,
  departmentAnalytics: OeeDepartmentAnalytics,
): OeeExecutiveAnalytics {
  const capacity = buildCapacity(data);

  const departments =
    buildDepartmentExecutiveRecords(
      departmentAnalytics,
    );

  const findings = [
    ...buildDepartmentFindings(
      departmentAnalytics,
    ),
    ...buildCapacityFindings(
      data,
      capacity,
    ),
  ];

  const overallStatus = getOverallStatus(
    departments,
    capacity,
  );

  return {
    week: data.currentWeek,
    overallStatus,
    headline: buildHeadline(
      overallStatus,
      data.currentWeek,
    ),
    executiveSummary: buildExecutiveSummary(
      data.currentWeek,
      departments,
      capacity,
    ),
    capacity,
    departments,
    findings,
  };
}