import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertDiscrepancyCanBeApproved, authorizeDiscrepancyAdjustment, createDiscrepancyAdjustment } from "@/lib/warehouse-discrepancy-adjustment";
import { getWarehouseStockBalance, lockWarehouseStock } from "@/repositories/warehouse-stock-lock";

export class WarehouseDiscrepancyError extends Error {}

export async function listDiscrepancies() {
  return db.warehouseDiscrepancy.findMany({
    include: {
      count: { include: { item: true, location: true } },
      assignedTo: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      adjustmentMovement: { select: { id: true, folio: true, type: true, quantity: true } },
      recounts: { orderBy: { requestedAt: "desc" }, include: { requestedBy: { select: { name: true } }, completedBy: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateDiscrepancy(id: string, data: {
  classification: "CONTROLLED_TEST" | "REAL"; cause: string; notes: string; resolution: string; close: boolean; actorId: string;
}) {
  return db.$transaction(async tx => {
    const previous = await tx.warehouseDiscrepancy.findUnique({ where: { id } });
    if (!previous) throw new WarehouseDiscrepancyError("La investigación no existe.");
    if (previous.status === "CLOSED") throw new WarehouseDiscrepancyError("La investigación ya está cerrada.");
    if (data.close && (!data.cause.trim() || !data.resolution.trim())) throw new WarehouseDiscrepancyError("Para cerrar se requiere causa y resolución.");
    if (data.close && data.classification !== "CONTROLLED_TEST") throw new WarehouseDiscrepancyError("Las diferencias reales requieren aprobación y ajuste autorizado.");
    return tx.warehouseDiscrepancy.update({ where: { id }, data: {
      classification: data.classification, cause: data.cause.trim() || null, notes: data.notes.trim() || null,
      resolution: data.resolution.trim() || null, status: data.close ? "CLOSED" : "IN_INVESTIGATION",
      closedAt: data.close ? new Date() : null, assignedToId: data.actorId,
    } });
  });
}

export async function approveDiscrepancyAdjustment(id: string, actorId: string, movementFolio: string) {
  return db.$transaction(async tx => {
    const investigation = await tx.warehouseDiscrepancy.findUnique({ where: { id }, include: { count: { include: { item: true, location: true } }, recounts: { where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 1 } } });
    if (!investigation) throw new WarehouseDiscrepancyError("El expediente no existe.");
    try { assertDiscrepancyCanBeApproved({ closed: investigation.status === "CLOSED", movementId: investigation.movementId }); } catch (error) { throw new WarehouseDiscrepancyError(error instanceof Error ? error.message : "El expediente ya fue aprobado."); }
    if (investigation.classification !== "REAL") throw new WarehouseDiscrepancyError("Solo las diferencias reales pueden aprobar un ajuste.");
    if (!investigation.cause?.trim() || !investigation.resolution?.trim()) throw new WarehouseDiscrepancyError("Documenta la causa y resolución antes de aprobar.");
    const recount = investigation.recounts[0];
    if (!recount?.completedAt || recount.countedQuantity === null || recount.difference === null) throw new WarehouseDiscrepancyError("Se requiere un reconteo completado.");
    const [approvalPermission, elevatedRoles] = await Promise.all([
      tx.warehousePermission.findUnique({ where: { userId: actorId }, select: { canApproveWarehouseAdjustments: true } }),
      tx.userRole.findMany({ where: { userId: actorId, role: { in: ["ADMIN", "DIRECCION"] } }, select: { role: true } }),
    ]);
    try { authorizeDiscrepancyAdjustment({ authorized: approvalPermission?.canApproveWarehouseAdjustments === true || elevatedRoles.length > 0, approverId: actorId, countActorId: investigation.count.countedById, recountActorId: recount.completedById }); } catch (error) { throw new WarehouseDiscrepancyError(error instanceof Error ? error.message : "No tienes autorización."); }

    const { item, location } = investigation.count;
    await lockWarehouseStock(tx, item.id, location.id);
    const newerMovement = await tx.inventoryMovement.findFirst({ where: { itemId: item.id, createdAt: { gt: recount.completedAt }, OR: [{ originLocationId: location.id }, { destinationLocationId: location.id }] }, select: { id: true } });
    if (newerMovement) throw new WarehouseDiscrepancyError("Hubo movimientos después del reconteo. Solicita un nuevo reconteo antes de aprobar.");

    const currentBalance = await getWarehouseStockBalance(tx, item.id, location.id);
    let adjustment;
    try { adjustment = createDiscrepancyAdjustment({ expected: recount.expectedQuantity.toNumber(), counted: recount.countedQuantity.toNumber(), currentBalance: currentBalance.toNumber() }); } catch (error) { throw new WarehouseDiscrepancyError(error instanceof Error ? error.message : "La existencia cambió desde el reconteo."); }
    if (adjustment?.type === "ADJUSTMENT_OUT" && currentBalance.lessThan(adjustment.quantity)) throw new WarehouseDiscrepancyError("La existencia actual no alcanza para aplicar el ajuste negativo.");
    const movement = adjustment ? await tx.inventoryMovement.create({ data: {
      folio: movementFolio, itemId: item.id, type: adjustment.type, quantity: new Prisma.Decimal(adjustment.quantity),
      unit: item.baseUnit, originLocationId: adjustment.type === "ADJUSTMENT_IN" ? null : location.id, destinationLocationId: adjustment.type === "ADJUSTMENT_IN" ? location.id : null,
      referenceType: "WAREHOUSE_DISCREPANCY", referenceNumber: investigation.folio,
      notes: `Aprobación ${investigation.folio}; reconteo ${recount.folio}. Causa: ${investigation.cause}. Resolución: ${investigation.resolution}`,
      occurredAt: new Date(), actorId,
    } }) : null;
    const closed = await tx.warehouseDiscrepancy.updateMany({ where: { id, status: { not: "CLOSED" }, movementId: null }, data: {
      status: "CLOSED", closedAt: new Date(), approvedById: actorId, approvedAt: new Date(), approvedQuantity: new Prisma.Decimal(adjustment?.quantity ?? 0), movementId: movement?.id ?? null,
    } });
    if (closed.count !== 1) throw new WarehouseDiscrepancyError("El expediente ya fue aprobado por otra solicitud.");
    return { id, movementId: movement?.id ?? null, movementFolio: movement?.folio ?? null, type: movement?.type ?? null, quantity: adjustment?.quantity ?? 0 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
