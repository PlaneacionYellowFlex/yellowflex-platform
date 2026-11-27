import { Prisma } from "@prisma/client";

/** El artículo o la ubicación no admiten movimientos (inactivos o inexistentes) en el momento de confirmar la transacción. */
export class WarehouseCatalogStateError extends Error {}

/**
 * YF-003 V2 · Validación de catálogo DENTRO de la transacción del movimiento.
 * Toma un bloqueo compartido (FOR SHARE) sobre el artículo, las ubicaciones y su almacén: varios movimientos pueden avanzar a la
 * vez, pero la inactivación del catálogo (FOR UPDATE sobre la misma fila) espera a que terminen y después ve sus existencias; y
 * un movimiento que llega después de la inactivación ya la ve. Nunca queda un artículo o una ubicación inactivos con material
 * recibido por una carrera.
 */
export async function assertActiveCatalog(tx: Prisma.TransactionClient, itemId: string, locationIds: readonly (string | null | undefined)[]) {
  const [item] = await tx.$queryRaw<{ active: boolean }[]>`SELECT "active" FROM "InventoryItem" WHERE "id" = ${itemId} FOR SHARE`;
  if (!item) throw new WarehouseCatalogStateError("El artículo no existe.");
  if (!item.active) throw new WarehouseCatalogStateError("El artículo está inactivo y no admite movimientos.");
  const ids = [...new Set(locationIds.filter((v): v is string => !!v))].sort();
  for (const id of ids) {
    const [location] = await tx.$queryRaw<{ active: boolean; warehouseActive: boolean }[]>`
      SELECT l."active", w."active" AS "warehouseActive" FROM "WarehouseLocation" l JOIN "Warehouse" w ON w."id" = l."warehouseId"
       WHERE l."id" = ${id} FOR SHARE OF l, w`;
    if (!location) throw new WarehouseCatalogStateError("La ubicación no existe.");
    if (!location.active || !location.warehouseActive) throw new WarehouseCatalogStateError("La ubicación o su almacén están inactivos y no admiten movimientos.");
  }
}
