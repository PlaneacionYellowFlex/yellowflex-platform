/** Roles corporativos disponibles dentro de YellowFlex Platform. */
export const platformRoles = [
  "ADMIN",
  "DIRECCION",
  "RH",
  "CHEF",
  "PLANEACION",
  "PRODUCCION",
  "MANTENIMIENTO",
  "EMPLEADO",
] as const;

export type PlatformRole = (typeof platformRoles)[number];

export type AuthenticatedEmployee = {
  id: string;
  employeeNumber: string;
  fullName: string;
};

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  roles: PlatformRole[];
  employee: AuthenticatedEmployee | null;
};

export type ModuleKey =
  | "food-services"
  | "rrhh"
  | "control-tower"
  | "mantenimiento";