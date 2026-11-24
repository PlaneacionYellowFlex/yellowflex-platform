import "server-only";

import { z } from "zod";
import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired, requireCorporateUser } from "@/lib/auth/corporate-auth";
import { hasCpanelPermission } from "@/lib/cpanel/authorization";
import { hasFoodServicesRhAccess } from "@/lib/food-services/rh-authorization";
import { db } from "@/lib/db";
import { FoodServiceError } from "@/lib/food-services/service";
import { lockFoodOrder } from "@/lib/food-services/order-lock";

export const cancelFoodOrderSchema = z.object({
  orderId: z.string().min(1).max(100),
  reason: z.string().trim().min(5).max(500),
}).strict();

// Deliberately no ADMIN shortcut: execution requires RH and an explicit grant.
export async function canCancelFoodOrder(user: AuthenticatedUser) {
  return user.roles.includes("RH") && await hasFoodServicesRhAccess(user) &&
    await hasCpanelPermission(user.id, "food-services", "cancel-food-order");
}

export async function requireFoodOrderCancellationAccess() {
  const user = await requireCorporateUser();
  if (!(await canCancelFoodOrder(user))) throw new CorporateAuthorizationRequired("Acceso restringido");
  return user;
}

// Mecanismo compartido con la generación de prenómina (order-lock.ts). Se reexporta por compatibilidad.
export { lockFoodOrder };

export async function cancelFoodOrder(actor: AuthenticatedUser, raw: unknown) {
  if (!(await canCancelFoodOrder(actor))) throw new CorporateAuthorizationRequired("Acceso restringido");
  const input = cancelFoodOrderSchema.parse(raw);
  return db.$transaction(async tx => {
    await lockFoodOrder(tx, input.orderId);
    // Recheck the sensitive grant inside the transaction, including account/role revocation.
    const user = await tx.user.findUnique({ where: { id: actor.id }, include: { roles: true } });
    const grant = await tx.corporateModulePermission.findUnique({ where: { userId_moduleKey_actionKey: {
      userId: actor.id, moduleKey: "food-services", actionKey: "cancel-food-order",
    } } });
    if (!user?.active || user.passwordMustChange || !user.roles.some(r => r.role === "RH") || !grant?.granted) {
      throw new CorporateAuthorizationRequired("Acceso restringido");
    }
    if (!user.roles.some(r => r.role === "ADMIN")) {
      const base = await tx.corporateModulePermission.findMany({ where: { userId: actor.id,
        moduleKey: "food-services", actionKey: { in: ["view", "manage"] }, granted: true } });
      if (base.length !== 2) throw new CorporateAuthorizationRequired("Acceso restringido");
    }
    const order = await tx.foodOrder.findUnique({ where: { id: input.orderId }, include: { reservations: true } });
    if (!order) throw new FoodServiceError("Pedido no encontrado.", 404);
    if (order.status !== "CONFIRMED") throw new FoodServiceError("El pedido ya no está confirmado; no puede cancelarse de nuevo.", 409);
    if (order.payrollStatus !== "PENDING" || order.payrollExportedAt) {
      throw new FoodServiceError("Nómina exportada, procesada o sin verificar. Requiere conciliación y un ajuste controlado; no se realizará una cancelación simple.", 409);
    }
    // La generación de lotes toma este mismo bloqueo antes de crear la asignación ACTIVE.
    // El índice único parcial y el trigger de FoodOrder son las barreras finales en PostgreSQL.
    const activeAssignment = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "FoodPayrollAssignment"
      WHERE "orderId" = ${order.id}
        AND "status" = 'ACTIVE'::"FoodPayrollAssignmentStatus"
      LIMIT 1
    `;
    if (activeAssignment.length > 0) {
      throw new FoodServiceError("El pedido está asignado a un lote de nómina activo; requiere conciliación antes de cancelarlo.", 409);
    }
    const consumed = await tx.consumption.count({ where: { employeeId: order.employeeId,
      menuItemId: { in: order.reservations.map(r => r.menuItemId) } } });
    if (consumed) throw new FoodServiceError("El pedido tiene consumos registrados y requiere un ajuste controlado.", 409);
    if (order.reservations.length !== order.itemCount || order.reservations.some(r => r.status !== "ACTIVE" || r.employeeId !== order.employeeId)) {
      throw new FoodServiceError("Las reservas del pedido requieren conciliación antes de cancelarlo.", 409);
    }
    const changed = await tx.foodOrder.updateMany({ where: { id: order.id, status: "CONFIRMED", payrollStatus: "PENDING" }, data: { status: "CANCELLED" } });
    if (changed.count !== 1) throw new FoodServiceError("El pedido cambió; actualiza la consulta.", 409);
    const reservations = await tx.reservation.updateMany({ where: { foodOrderId: order.id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
    if (reservations.count !== order.itemCount) throw new FoodServiceError("No se pudieron cancelar todas las reservas.", 409);
    return tx.foodOrderCancellation.create({ data: { orderId: order.id, actorId: actor.id, reason: input.reason,
      previousStatus: "CONFIRMED", newStatus: "CANCELLED" } });
  });
}
