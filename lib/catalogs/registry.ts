import { MACHINE_REGISTRY } from "./machines";
import type {
  DepartmentId,
  MachineDefinition,
  ProcessId,
} from "./types";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export const MACHINE_BY_ID = new Map<
  string,
  MachineDefinition
>();

export const MACHINE_BY_ALIAS = new Map<
  string,
  MachineDefinition
>();

for (const machine of MACHINE_REGISTRY) {
  MACHINE_BY_ID.set(machine.id, machine);

  MACHINE_BY_ALIAS.set(
    normalize(machine.officialName),
    machine,
  );

  for (const alias of machine.aliases) {
    MACHINE_BY_ALIAS.set(
      normalize(alias),
      machine,
    );
  }
}

export function resolveMachine(
  value: string,
): MachineDefinition | undefined {
  return MACHINE_BY_ALIAS.get(
    normalize(value),
  );
}

export function getMachineById(
  id: string,
): MachineDefinition | undefined {
  return MACHINE_BY_ID.get(id);
}

export function getMachinesByDepartment(
  department: DepartmentId,
): MachineDefinition[] {
  return MACHINE_REGISTRY.filter(
    (machine) =>
      machine.department === department,
  );
}

export function getMachinesByProcess(
  process: ProcessId,
): MachineDefinition[] {
  return MACHINE_REGISTRY.filter(
    (machine) =>
      machine.process === process,
  );
}