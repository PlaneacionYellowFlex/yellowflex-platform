import type {
  MachineUtilizationRecord,
  OeeWorkbookData,
} from "@/types/oee";

import type { OeeRanking } from "./ranking";
import type { OeeSummary } from "./summary";

export type OeeInsightLevel =
  | "success"
  | "warning"
  | "critical"
  | "info";

export type OeeInsight = {
  id: string;
  level: OeeInsightLevel;
  title: string;
  message: string;
};

function getLatestRecordByMachine(
  records: MachineUtilizationRecord[],
): MachineUtilizationRecord[] {
  const latestRecords = new Map<string, MachineUtilizationRecord>();

  for (const record of records) {
    const currentRecord = latestRecords.get(record.machine);

    if (!currentRecord || record.week > currentRecord.week) {
      latestRecords.set(record.machine, record);
    }
  }

  return Array.from(latestRecords.values());
}

export function buildOeeInsights(
  data: OeeWorkbookData,
  summary: OeeSummary,
  ranking: OeeRanking,
): OeeInsight[] {
  const insights: OeeInsight[] = [];

  const latestMachineRecords = getLatestRecordByMachine(data.machines);

  const lowUtilizationMachines = latestMachineRecords.filter(
    (record) => record.utilization < 0.35,
  );

  insights.push({
    id: "average-utilization",
    level:
      summary.averageUtilization >= 0.75
        ? "success"
        : summary.averageUtilization >= 0.55
          ? "warning"
          : "critical",
    title: "Utilización promedio",
    message: `La utilización promedio de las máquinas analizadas es de ${(summary.averageUtilization * 100).toFixed(1)}%.`,
  });

  const topMachine =
    ranking.highestUtilization[0] ?? null;

  if (topMachine) {
    insights.push({
      id: "highest-utilization",
      level: "success",
      title: "Mayor utilización",
      message: `${topMachine.machine} presenta la utilización más alta con ${(topMachine.utilization * 100).toFixed(1)}%.`,
    });
  }

  insights.push({
    id: "low-utilization-machines",
    level:
      lowUtilizationMachines.length === 0
        ? "success"
        : lowUtilizationMachines.length <= 3
          ? "warning"
          : "critical",
    title: "Máquinas con baja utilización",
    message:
      lowUtilizationMachines.length === 0
        ? "No existen máquinas con utilización inferior al 35% entre los registros más recientes disponibles."
        : `Existen ${lowUtilizationMachines.length} máquinas con utilización inferior al 35% entre los registros más recientes disponibles.`,
  });

  return insights;
}