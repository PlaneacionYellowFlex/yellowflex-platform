/**
 * ============================================================
 * YELLOWFLEX CONTROL TOWER
 * Industrial Catalog Types
 * ============================================================
 * Contratos oficiales utilizados por todos los módulos.
 *
 * Ningún módulo debe redefinir estos tipos.
 * Todos deben importarlos desde este archivo.
 * ============================================================
 */

export type DepartmentId =
  | "INJECTION"
  | "ROTOMOLDING";

export type ProcessId =
  | "INYECCION"
  | "ROTOMOLDEO";

export type MachineStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "MAINTENANCE";

export type MachineColor =
  | "BLUE"
  | "GOLD"
  | "GREEN"
  | "RED"
  | "GRAY";

export interface MachineDefinition {
  /**
   * Identificador permanente.
   * Nunca cambia aunque cambie el nombre en Excel.
   */
  id: string;

  /**
   * Nombre oficial mostrado en el sistema.
   */
  officialName: string;

  /**
   * Todos los nombres válidos que puede tener
   * la máquina dentro del Excel.
   */
  aliases: string[];

  /**
   * Departamento industrial.
   */
  department: DepartmentId;

  /**
   * Proceso industrial.
   */
  process: ProcessId;

  /**
   * Capacidad teórica semanal.
   */
  nominalCapacityMinutes: number;

  /**
   * Capacidad efectiva utilizada por Planeación.
   */
  effectiveCapacityMinutes: number;

  /**
   * Orden de aparición en dashboards.
   */
  displayOrder: number;

  /**
   * Color lógico.
   * La UI decide el color hexadecimal.
   */
  color: MachineColor;

  /**
   * Estado operativo.
   */
  status: MachineStatus;

  /**
   * PLC asociado.
   * null mientras no exista integración.
   */
  plcId: string | null;

  /**
   * Reservado para IA.
   */
  aiContext?: string;
}