export type InsightLevel =
  | "success"
  | "warning"
  | "critical"
  | "info";

export type OeeInsight = {
  id: string;
  level: InsightLevel;
  title: string;
  message: string;
};

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

export type OeeMachine = {
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

  machines: OeeMachine[];
};

export type WeeklyOeeRecord = {
  week: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
};

export type OeeSummary = {
  currentWeek: number;

  machineCount: number;

  averageUtilization: number;

  highestUtilization: OeeMachine | null;

  lowestUtilization: OeeMachine | null;
};

export type OeeRanking = {
  currentWeek: number;

  highestUtilization: OeeMachine[];

  lowestUtilization: OeeMachine[];
};

export type OeeData = {
  currentWeek: number;

  current: WeeklyOeeRecord;

  history: WeeklyOeeRecord[];

  summary: OeeSummary;

  ranking: OeeRanking;

  insights: OeeInsight[];

  machines: OeeMachineAnalytics;

  executive: unknown;

  departments: unknown;

  sourceFile: string;

  sourceSheet: string;

  updatedAt: string;
};