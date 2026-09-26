import type {
  MachineUtilizationRecord,
  OeeOperationalRecord,
  WeeklyOeeRecord,
} from "@/types/oee";

export type SummaryCache = {
  currentWeek: number;
  current: WeeklyOeeRecord;
};

export type HistoryCache = WeeklyOeeRecord[];

export type MachinesCache = MachineUtilizationRecord[];

export type OperationalCache = OeeOperationalRecord[];

export type MetadataCache = {
  sourceFile: string;
  sourceSheet: string;
  generatedAt: string;
  version: string;
};