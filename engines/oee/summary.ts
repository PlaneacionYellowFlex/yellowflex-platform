import type {
  MachineUtilizationRecord,
  OeeWorkbookData,
} from "@/types/oee";

export type OeeSummary = {
  currentWeek: number;
  machineCount: number;
  averageUtilization: number;
  highestUtilization: MachineUtilizationRecord | null;
  lowestUtilization: MachineUtilizationRecord | null;
};

function getRecordsForCurrentWeek(
  records: MachineUtilizationRecord[],
  currentWeek: number,
): MachineUtilizationRecord[] {
  return records.filter(
    (record) => record.week === currentWeek,
  );
}

export function buildOeeSummary(
  data: OeeWorkbookData,
): OeeSummary {
  const currentWeekMachineRecords =
    getRecordsForCurrentWeek(
      data.machines,
      data.currentWeek,
    );

  if (currentWeekMachineRecords.length === 0) {
    return {
      currentWeek: data.currentWeek,
      machineCount: 0,
      averageUtilization: 0,
      highestUtilization: null,
      lowestUtilization: null,
    };
  }

  const totalUtilization =
    currentWeekMachineRecords.reduce(
      (total, record) =>
        total + record.utilization,
      0,
    );

  const averageUtilization =
    totalUtilization /
    currentWeekMachineRecords.length;

  const highestUtilization =
    currentWeekMachineRecords.reduce(
      (highest, record) =>
        record.utilization > highest.utilization
          ? record
          : highest,
    );

  const lowestUtilization =
    currentWeekMachineRecords.reduce(
      (lowest, record) =>
        record.utilization < lowest.utilization
          ? record
          : lowest,
    );

  return {
    currentWeek: data.currentWeek,
    machineCount: currentWeekMachineRecords.length,
    averageUtilization,
    highestUtilization,
    lowestUtilization,
  };
}