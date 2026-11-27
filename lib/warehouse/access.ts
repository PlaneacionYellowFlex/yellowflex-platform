import "server-only";

import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { DENIED, getWarehouseCapabilities, type WarehouseCapability } from "@/lib/warehouse/capabilities";

export { getWarehouseCapabilities, WAREHOUSE_LEGACY_FLAGS } from "@/lib/warehouse/capabilities";
export type { WarehouseCapabilities, WarehouseCapability, WarehouseLegacyFlag } from "@/lib/warehouse/capabilities";

/**
 * YF-003 · Política central de Warehouse.
 *
 * Toda escritura exige concesiones EXPLÍCITAS (C-PANEL warehouse + permiso operativo de Almacén) y no tiene atajos por rol:
 * ni ADMIN ni DIRECCIÓN operan, investigan ni aprueban ajustes por su rol. ADMIN conserva únicamente la consulta (gobierno y
 * auditoría). Producción exige además rol PRODUCCION o DIRECCION.
 *
 *  - view         consultar inventario, movimientos, conteos y diferencias
 *  - operate      entradas, transferencias, entregas a Producción, devoluciones, conteos
 *  - investigate  investigar diferencias, solicitar y completar reconteos
 *  - approve      aprobar ajustes de inventario derivados de diferencias
 *  - audit        auditoría: consulta completa, Kardex, reportes y reconciliación, sin escritura (C-PANEL warehouse/audit)
 *  - production   recibir, consumir y devolver material bajo custodia de Producción
 *  - catalog      administrar artículos y ubicaciones (C-PANEL warehouse/manage-catalog + canManageCatalog; sensible, solo ADMIN la concede)
 */
/** Exige una capacidad antes de leer el cuerpo de la solicitud o cualquier dato de negocio. */
export async function requireWarehouseCapability(capability: WarehouseCapability): Promise<AuthenticatedUser> {
  const user = await requireCorporateUser();
  const caps = await getWarehouseCapabilities(user.id, undefined, user.roles);
  if (!caps[capability]) throw new CorporateAuthorizationRequired(capability === "productionView" ? DENIED.production : DENIED[capability]);
  return user;
}

/** Acceso a páginas de Warehouse con la misma política que las APIs. */
export async function hasWarehousePageAccess(user: AuthenticatedUser, action: string, area: string) {
  const caps = await getWarehouseCapabilities(user.id, undefined, user.roles);
  if (area === "production") return action === "view" ? caps.productionView : caps.production;
  if (area === "movement") return caps.operate;
  if (area === "count") return caps.operate || caps.investigate;
  if (area === "investigate") return caps.investigate;
  if (area === "catalog") return caps.catalog;
  if (action === "audit") return caps.audit;
  if (action === "approve") return caps.approve;
  if (action === "operate") return caps.operate;
  return caps.view;
}
