/**
 * YellowFlex Platform — C-PANEL
 * Catálogo central de módulos y acciones. Sin acceso a base de datos.
 * Este archivo NO concede permisos: únicamente define identificadores válidos.
 */
export const cpanelModules = [
  "dashboard",
  "food-services",
  "my-rh",
  "rrhh",
  "control-tower",
  "purchases",
  "mantenimiento",
  "warehouse",
  "calidad",
  "mejora-continua",
  "vigilancia",
  "settings",
  "c-panel",
] as const;

export type CpanelModule = (typeof cpanelModules)[number];

export const cpanelActions = [
  "view",
  "operate",
  "approve",
  "audit",
  "manage",
  "cancel-food-order",
] as const;

export type CpanelAction = (typeof cpanelActions)[number];

export type CpanelPermission = Readonly<{
  module: CpanelModule;
  action: CpanelAction;
}>;

/**
 * Identificadores de operaciones especializadas que no deben perderse
 * durante la migración de los controles de Compras y Almacén.
 */
export const legacyPermissionKeys = {
  purchases: [
    "canRequest",
    "canRequestUrgent",
    "canAuthorize",
    "canViewAll",
    "canManagePurchases",
  ],
  warehouse: [
    "canViewInventory",
    "canRegisterMovement",
    "canImportInitial",
    "canManageCatalog",
    "canManageWarehouse",
    "canApproveWarehouseAdjustments",
  ],
} as const;

export function isCpanelModule(value: string): value is CpanelModule {
  return (cpanelModules as readonly string[]).includes(value);
}

export function isCpanelAction(value: string): value is CpanelAction {
  return (cpanelActions as readonly string[]).includes(value);
}
