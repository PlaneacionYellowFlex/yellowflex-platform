import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getConfirmedFoodOrderSummary } from "@/lib/food-services/confirmed-orders";

export async function getHrBillingSummary(
  client: Prisma.TransactionClient = db,
  orderIds?: string[],
  weekId?: string,
) {
  return getConfirmedFoodOrderSummary(client, { orderIds, weekId });
}
