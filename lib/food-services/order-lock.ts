import type { Prisma } from "@prisma/client";

/**
 * Mecanismo único de bloqueo de pedidos Food Services. Cancelación, consumo y generación de
 * prenómina toman primero la fila FoodOrder (SELECT ... FOR UPDATE) y después leen o escriben
 * lotes/asignaciones. Nunca se toma primero un bloqueo de lote: así se evita el interbloqueo.
 */
export async function lockFoodOrder(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "FoodOrder" WHERE "id" = ${orderId} FOR UPDATE`;
}

/** Bloquea varios pedidos en orden determinista (id ascendente) y devuelve los ids encontrados. */
export async function lockFoodOrders(tx: Prisma.TransactionClient, orderIds: readonly string[]) {
  const ordered = [...new Set(orderIds)].sort();
  if (ordered.length === 0) return [] as string[];
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "FoodOrder" WHERE "id" = ANY(${ordered}::text[]) ORDER BY "id" FOR UPDATE`;
  return rows.map(row => row.id);
}
