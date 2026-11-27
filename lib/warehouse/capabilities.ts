import type { Prisma, PrismaClient } from "@prisma/client";

import type { PlatformRole } from "@/lib/access-control";
import { db } from "@/lib/db";

/**
 * YF-003 · Cálculo puro de capacidades de Warehouse (sin "server-only" para poder usarse dentro de transacciones de
 * repositorio y en pruebas). La política completa se documenta en lib/warehouse/access.ts.
 */
export type WarehouseCapability = "view" | "operate" | "investigate" | "approve" | "audit" | "production" | "productionView" | "catalog";
export type WarehouseCapabilities = Record<WarehouseCapability, boolean>;

type Client = PrismaClient | Prisma.TransactionClient;

export const WAREHOUSE_LEGACY_FLAGS = [
  "canViewInventory", "canRegisterMovement", "canImportInitial", "canManageCatalog", "canManageWarehouse", "canApproveWarehouseAdjustments",
] as const;
export type WarehouseLegacyFlag = (typeof WAREHOUSE_LEGACY_FLAGS)[number];

/**
 * Permisos operativos ORDINARIOS: los administra RH con delegación de C-PANEL (además de ADMIN).
 * Los demás son SENSIBLES (investigar diferencias, aprobar ajustes, carga inicial, catálogo): solo ADMIN.
 */
export const WAREHOUSE_ORDINARY_FLAGS: readonly WarehouseLegacyFlag[] = ["canViewInventory", "canRegisterMovement"];
export const isOrdinaryWarehouseFlag = (flag: WarehouseLegacyFlag) => WAREHOUSE_ORDINARY_FLAGS.includes(flag);

const PRODUCTION_ROLES: PlatformRole[] = ["PRODUCCION", "DIRECCION"];

export const DENIED: Record<Exclude<WarehouseCapability, "productionView">, string> = {
  view: "No tienes permiso para consultar Almacén.",
  operate: "No tienes permiso para registrar operaciones de Almacén.",
  investigate: "No tienes permiso para investigar diferencias ni gestionar reconteos.",
  approve: "No tienes autorización expresa para aprobar ajustes de inventario.",
  audit: "No tienes permiso de auditoría de Almacén.",
  production: "No tienes permiso para operar material bajo custodia de Producción.",
  catalog: "No tienes permiso para administrar el catálogo de Almacén.",
};

/** Calcula las capacidades desde la base de datos (sin caché): concesiones explícitas, cuenta activa y roles vigentes. */
/**
 * @param sessionRoles roles ya leídos de la sesión vigente (requireCorporateUser los consulta en cada solicitud); si no se
 *   indican, se leen de la base de datos (uso dentro de transacciones de repositorio).
 */
export async function getWarehouseCapabilities(userId: string, client: Client = db, sessionRoles?: readonly string[]): Promise<WarehouseCapabilities> {
  const none: WarehouseCapabilities = { view: false, operate: false, investigate: false, approve: false, audit: false, production: false, productionView: false, catalog: false };
  const user = await client.user.findUnique({ where: { id: userId }, select: { active: true, roles: { select: { role: true } } } });
  if (!user?.active) return none;
  // Concesiones explícitas: una consulta por acción, igual que hasCpanelPermission (sin atajos por rol).
  const grant = async (actionKey: string) => (await client.corporateModulePermission.findUnique({
    where: { userId_moduleKey_actionKey: { userId, moduleKey: "warehouse", actionKey } }, select: { granted: true },
  }))?.granted === true;
  const [legacy, cpView, cpOperateRaw, cpApprove, cpAudit, cpCatalog] = await Promise.all([
    client.warehousePermission.findUnique({ where: { userId } }), grant("view"), grant("operate"), grant("approve"), grant("audit"), grant("manage-catalog"),
  ]);
  const roles = (sessionRoles ?? user.roles.map(r => r.role)) as PlatformRole[];
  const cpOperate = cpView && cpOperateRaw;
  const isAdmin = roles.includes("ADMIN");
  const productionRole = roles.some(r => PRODUCTION_ROLES.includes(r));
  return {
    // Auditor (C-PANEL warehouse/audit): consulta completa (Kardex, reconciliación, historial) sin ninguna escritura.
    view: isAdmin || cpAudit || (cpView && legacy?.canViewInventory === true),
    operate: cpOperate && legacy?.canRegisterMovement === true,
    investigate: cpOperate && legacy?.canManageWarehouse === true,
    approve: cpView && cpApprove && legacy?.canApproveWarehouseAdjustments === true,
    audit: isAdmin || cpAudit,
    production: productionRole && cpOperate,
    productionView: isAdmin || (productionRole && cpView),
    // V2: catálogo = concesión sensible explícita (C-PANEL manage-catalog + bandera canManageCatalog); ningún rol la otorga.
    catalog: cpView && cpCatalog && legacy?.canManageCatalog === true,
  };
}

