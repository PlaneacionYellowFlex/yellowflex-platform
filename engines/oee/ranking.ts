import type {
  MachineUtilizationRecord,
  OeeWorkbookData,
} from "@/types/oee";

export type OeeRanking = {
  currentWeek: number;
  highestUtilization: MachineUtilizationRecord[];
  lowestUtilization: MachineUtilizationRecord[];
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

export function buildOeeRanking(
  data: OeeWorkbookData,
  limit = 5,
): OeeRanking {
  const latestMachineRecords = getLatestRecordByMachine(data.machines);

  const highestUtilization = [...latestMachineRecords]
    .sort(
      (left, right) =>
        right.utilization - left.utilization,
    )
    .slice(0, limit);

  const lowestUtilization = [...latestMachineRecords]
    .sort(
      (left, right) =>
        left.utilization - right.utilization,
    )
    .slice(0, limit);

  return {
    currentWeek: data.currentWeek,
    highestUtilization,
    lowestUtilization,
  };
}