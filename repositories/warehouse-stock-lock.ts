import { Prisma } from "@prisma/client";

/** Clave del bloqueo de existencias de un artículo en una ubicación (la misma en todas las rutas que cambian existencias). */
export function stockLockKey(itemId: string, locationId: string) {
  return JSON.stringify([itemId, locationId]);
}

/** Clave del bloqueo de una custodia (recepción, consumo, devolución). */
export function custodyLockKey(custodyId: string) {
  return JSON.stringify(["custody", custodyId]);
}

/**
 * Jerarquía de bloqueos (YF-003): 0 = documento (conteo, expediente, reverso) → 1 = custodia → 2 = existencias.
 * Toda operación adquiere los bloqueos en ese orden; dentro del mismo nivel, por clave. Así dos operaciones nunca esperan
 * una por la otra en orden inverso (sin interbloqueos).
 */
function lockRank(key: string) {
  const head = (() => { try { return (JSON.parse(key) as unknown[])[0]; } catch { return null; } })();
  if (head === "custody") return 1;
  if (head === "count" || head === "discrepancy" || head === "reversal") return 0;
  return 2;
}

/** Toma varios bloqueos consultivos de transacción en orden determinista y sin duplicados. */
export async function lockWarehouseKeys(tx: Prisma.TransactionClient, keys: readonly string[]) {
  const ordered = [...new Set(keys)].sort((a, b) => lockRank(a) - lockRank(b) || (a < b ? -1 : a > b ? 1 : 0));
  for (const key of ordered) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

export async function lockWarehouseStock(
  tx: Prisma.TransactionClient,
  itemId: string,
  originLocationId: string,
) {
  await lockWarehouseKeys(tx, [stockLockKey(itemId, originLocationId)]);
}

export async function getWarehouseStockBalance(
  tx: Prisma.TransactionClient,
  itemId: string,
  locationId: string,
) {
  const [incoming, outgoing] = await Promise.all([
    tx.inventoryMovement.aggregate({
      where: { itemId, destinationLocationId: locationId },
      _sum: { quantity: true },
    }),
    tx.inventoryMovement.aggregate({
      where: { itemId, originLocationId: locationId },
      _sum: { quantity: true },
    }),
  ]);

  return new Prisma.Decimal(incoming._sum.quantity ?? 0).minus(outgoing._sum.quantity ?? 0);
}
