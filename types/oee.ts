export type WeeklyOeeRecord = {
  week: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
};

export type MachineUtilizationRecord = {
  machine: string;
  week: number;
  availableMinutes: number;
  usedMinutes: number;
  utilization: number;
};

/**
 * Representa una fila operativa de la hoja OEE.
 *
 * Fuente:
 * A = Máquina
 * B = Fecha
 * G = Tiempo muerto
 * H = Motivo del tiempo muerto
 * M = Departamento
 * N = Semana
 * O = Tiempo disponible
 * P = Tiempo productivo
 */
export type OeeOperationalRecord = {
  rowNumber: number;
  machine: string;
  date: string | null;
  department: string;
  week: number;
  availableMinutes: number;
  usedMinutes: number;
  downtimeMinutes: number;
  downtimeReason: string;
};

export type OeeWorkbookData = {
  currentWeek: number;
  current: WeeklyOeeRecord;
  history: WeeklyOeeRecord[];
  machines: MachineUtilizationRecord[];

  /**
   * Registros operativos obtenidos directamente de las filas A:P
   * de la hoja OEE.
   */
  operationalRows: OeeOperationalRecord[];

  sourceFile: string;
  sourceSheet: string;
  updatedAt: string;
};