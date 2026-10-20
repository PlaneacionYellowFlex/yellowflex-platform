import { Prisma } from "@prisma/client";

export async function lockWarehouseStock(
  tx: Prisma.TransactionClient,
  itemId: string,
  originLocationId: string,
) {
  const lockKey = JSON.stringify([itemId, originLocationId]);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
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