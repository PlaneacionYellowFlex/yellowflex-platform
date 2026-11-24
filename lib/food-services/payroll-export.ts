import "server-only";
import { db } from "@/lib/db";
import { getHrBillingSummary } from "@/lib/food-services/hr-billing-service";
import { buildFoodServicesBillingExport } from "@/lib/food-services/billing-export-service";
import { FoodServiceError } from "@/lib/food-services/service";

/** Informational download only. It neither exports an official payroll batch nor
 * changes payroll status, export timestamps or the exceptional cancellation rules.
 * The legacy name and signature preserve both independent CHEF/RH endpoints.
 */
export async function exportFoodPayroll(weekId: string, _actorId: string) {
  void _actorId; // Signature compatibility; an informative report records no official exporter.
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const snapshot = await getHrBillingSummary(tx, undefined, weekId);
    if (!snapshot.orders.length) throw new FoodServiceError("No existen pedidos confirmados para reportar.", 409);
    return buildFoodServicesBillingExport(weekId, snapshot, tx);
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
