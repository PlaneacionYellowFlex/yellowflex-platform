import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertDiscrepancyCanBeApproved, authorizeDiscrepancyAdjustment, createDiscrepancyAdjustment } from "@/lib/warehouse-discrepancy-adjustment";
import { getWarehouseStockBalance, lockWarehouseKeys, stockLockKey } from "@/repositories/warehouse-stock-lock";
import { runStockOperationOnce } from "@/repositories/warehouse-stock-operation.repository";
import { discrepancyLockKey } from "@/repositories/warehouse-recounts.repository";
import { getWarehouseCapabilities } from "@/lib/warehouse/capabilities";

export class WarehouseDiscrepancyError extends Error {}

/** Eventos que cuentan como participación en el expediente (segregación de funciones del aprobador). */
const PARTICIPATION_EVENTS = ["CLASSIFIED", "UPDATED", "RECOUNT_REQUESTED", "RECOUNT_COMPLETED"];

export async function listDiscrepancies() {
  return db.warehouseDiscrepancy.findMany({
    include: {
      count: { include: { item: true, location: true } },
      assignedTo: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      adjustmentMovement: { select: { id: true, folio: true, type: true, quantity: true } },
      recounts: { orderBy: { requestedAt: "desc" }, include: { requestedBy: { select: { id: true, name: true } }, completedBy: { select: { id: true, name: true } } } },
      events: { orderBy: { createdAt: "desc" }, include: { actor: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export type UpdateDiscrepancyData = {
  classification: "CONTROLLED_TEST" | "REAL"; cause: string; notes: string; resolution: string; close: boolean; actorId: string;
};

export async function updateDiscrepancy(id: string, data: UpdateDiscrepancyData) {
  return db.$transaction(tx => updateDiscrepancyInTransaction(tx, id, data), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function updateDiscrepancyOnce<R extends Record<string, unknown>>(
  id: string, data: UpdateDiscrepancyData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof updateDiscrepancyInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "DISCREPANCY_UPDATE", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [discrepancyLockKey(id)], occurredAt: new Date(),
  }, async tx => toResponse(await updateDiscrepancyInTransaction(tx, id, data)));
}

async function updateDiscrepancyInTransaction(tx: Prisma.TransactionClient, id: string, data: UpdateDiscrepancyData) {
  if (data.classification !== "CONTROLLED_TEST" && data.classification !== "REAL") throw new WarehouseDiscrepancyError("Clasificación inválida.");
  await lockWarehouseKeys(tx, [discrepancyLockKey(id)]);
  const previous = await tx.warehouseDiscrepancy.findUnique({ where: { id } });
  if (!previous) throw new WarehouseDiscrepancyError("La investigación no existe.");
  if (previous.status === "CLOSED") throw new WarehouseDiscrepancyError("La investigación ya está cerrada.");
  if (data.close && (!data.cause.trim() || !data.resolution.trim())) throw new WarehouseDiscrepancyError("Para cerrar se requiere causa y resolución.");
  if (data.close && data.classification !== "CONTROLLED_TEST") throw new WarehouseDiscrepancyError("Las diferencias reales requieren aprobación y ajuste autorizado.");
  const toStatus = data.close ? "CLOSED" : "IN_INVESTIGATION";
  const updated = await tx.warehouseDiscrepancy.update({ where: { id }, data: {
    classification: data.classification, cause: data.cause.trim() || null, notes: data.notes.trim() || null,
    resolution: data.resolution.trim() || null, status: toStatus, closedAt: data.close ? new Date() : null, assignedToId: data.actorId,
  } });
  const type = previous.classification !== data.classification ? "CLASSIFIED" : "UPDATED";
  await tx.warehouseDiscrepancyEvent.create({ data: {
    discrepancyId: id, type, fromStatus: previous.status, toStatus, actorId: data.actorId,
    notes: [`Clasificación ${data.classification}`, data.cause.trim() && `Causa: ${data.cause.trim()}`,
      data.resolution.trim() && `Resolución: ${data.resolution.trim()}`, data.close ? "Cerrado sin ajuste (prueba controlada)" : null].filter(Boolean).join(" · "),
  } });
  return updated;
}

type ApprovalContext = Awaited<ReturnType<typeof loadForDecision>>;

async function loadForDecision(tx: Prisma.TransactionClient, id: string) {
  await lockWarehouseKeys(tx, [discrepancyLockKey(id)]);
  const investigation = await tx.warehouseDiscrepancy.findUnique({ where: { id }, include: {
    count: { include: { item: true, location: true } },
    recounts: { where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" } },
    events: { orderBy: { createdAt: "asc" } },
  } });
  if (!investigation) throw new WarehouseDiscrepancyError("El expediente no existe.");
  try { assertDiscrepancyCanBeApproved({ closed: investigation.status === "CLOSED", movementId: investigation.movementId }); }
  catch (error) { throw new WarehouseDiscrepancyError(error instanceof Error ? error.message : "El expediente ya fue aprobado."); }
  if (investigation.classification !== "REAL") throw new WarehouseDiscrepancyError("Solo las diferencias reales pueden aprobar un ajuste.");
  if (!investigation.cause?.trim() || !investigation.resolution?.trim()) throw new WarehouseDiscrepancyError("Documenta la causa y resolución antes de aprobar.");
  const lastRejection = [...investigation.events].reverse().find(e => e.type === "ADJUSTMENT_REJECTED");
  const recount = investigation.recounts[0];
  if (!recount?.completedAt || recount.countedQuantity === null || recount.difference === null) throw new WarehouseDiscrepancyError("Se requiere un reconteo completado.");
  if (lastRejection && recount.completedAt <= lastRejection.createdAt) {
    throw new WarehouseDiscrepancyError("La propuesta anterior fue rechazada; se requiere un reconteo nuevo antes de decidir.");
  }
  return { investigation, recount };
}

/** Todos los que contaron, recontaron, solicitaron reconteo, clasificaron o documentaron el expediente. */
function participants(ctx: ApprovalContext) {
  const ids = new Set<string>();
  const add = (v: string | null | undefined) => { if (v) ids.add(v); };
  add(ctx.investigation.count.countedById);
  add(ctx.investigation.assignedToId);
  for (const r of ctx.investigation.recounts) { add(r.completedById); add(r.requestedById); }
  for (const e of ctx.investigation.events) if (PARTICIPATION_EVENTS.includes(e.type)) add(e.actorId);
  return ids;
}

async function assertIndependentApprover(tx: Prisma.TransactionClient, ctx: ApprovalContext, actorId: string) {
  // YF-003: sin atajos por rol (ADMIN o DIRECCIÓN). Se exige la concesión explícita vigente dentro de la transacción.
  const capabilities = await getWarehouseCapabilities(actorId, tx);
  try {
    authorizeDiscrepancyAdjustment({ authorized: capabilities.approve, approverId: actorId, countActorId: ctx.investigation.count.countedById,
      recountActorId: ctx.recount.completedById, investigatorId: ctx.investigation.assignedToId });
  } catch (error) { throw new WarehouseDiscrepancyError(error instanceof Error ? error.message : "No tienes autorización."); }
  if (participants(ctx).has(actorId)) {
    throw new WarehouseDiscrepancyError("Participaste en el conteo, reconteo o investigación de esta diferencia; la decisión debe tomarla otra persona autorizada.");
  }
}

export async function approveDiscrepancyAdjustment(id: string, actorId: string, movementFolio: string) {
  return db.$transaction(tx => approveInTransaction(tx, id, actorId, movementFolio), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function approveDiscrepancyAdjustmentOnce<R extends Record<string, unknown>>(
  id: string, actorId: string, movementFolio: string,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof approveInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "DISCREPANCY_APPROVAL", actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [discrepancyLockKey(id)], occurredAt: new Date(),
  }, async tx => toResponse(await approveInTransaction(tx, id, actorId, movementFolio)));
}

async function approveInTransaction(tx: Prisma.TransactionClient, id: string, actorId: string, movementFolio: string) {
  const ctx = await loadForDecision(tx, id);
  await assertIndependentApprover(tx, ctx, actorId);
  const { investigation, recount } = ctx;
  const { item, location } = investigation.count;
  await lockWarehouseKeys(tx, [stockLockKey(item.id, location.id)]);
  const newerMovement = await tx.inventoryMovement.findFirst({ where: { itemId: item.id, createdAt: { gt: recount.completedAt! }, OR: [{ originLocationId: location.id }, { destinationLocationId: location.id }] }, select: { id: true } });
  if (newerMovement) throw new WarehouseDiscrepancyError("Hubo movimientos después del reconteo. Solicita un nuevo reconteo antes de aprobar.");

  const currentBalance = await getWarehouseStockBalance(tx, item.id, location.id);
  let adjustment;
  try { adjustment = createDiscrepancyAdjustment({ expected: recount.expectedQuantity, counted: recount.countedQuantity!, currentBalance }); }
  catch (error) { throw new WarehouseDiscrepancyError(error instanceof Error ? error.message : "La existencia cambió desde el reconteo."); }
  if (adjustment?.type === "ADJUSTMENT_OUT" && currentBalance.lessThan(adjustment.quantity)) throw new WarehouseDiscrepancyError("La existencia actual no alcanza para aplicar el ajuste negativo.");
  const now = new Date();
  const movement = adjustment ? await tx.inventoryMovement.create({ data: {
    folio: movementFolio, itemId: item.id, type: adjustment.type, quantity: adjustment.quantity,
    unit: item.baseUnit, originLocationId: adjustment.type === "ADJUSTMENT_IN" ? null : location.id, destinationLocationId: adjustment.type === "ADJUSTMENT_IN" ? location.id : null,
    referenceType: "WAREHOUSE_DISCREPANCY", referenceNumber: investigation.folio,
    notes: `Aprobación ${investigation.folio}; reconteo ${recount.folio}; existencia anterior ${currentBalance.toString()}, posterior ${recount.countedQuantity!.toString()}. Causa: ${investigation.cause}. Resolución: ${investigation.resolution}`,
    occurredAt: now, actorId,
  } }) : null;
  const closed = await tx.warehouseDiscrepancy.updateMany({ where: { id, status: { not: "CLOSED" }, movementId: null }, data: {
    status: "CLOSED", closedAt: now, approvedById: actorId, approvedAt: now, approvedQuantity: adjustment?.quantity ?? new Prisma.Decimal(0), movementId: movement?.id ?? null,
  } });
  if (closed.count !== 1) throw new WarehouseDiscrepancyError("El expediente ya fue aprobado por otra solicitud.");
  await tx.warehouseDiscrepancyEvent.create({ data: {
    discrepancyId: id, type: "ADJUSTMENT_APPROVED", fromStatus: investigation.status, toStatus: "CLOSED", actorId,
    notes: movement ? `Ajuste ${movement.type} ${movement.quantity.toString()} (${movement.folio}); existencia ${currentBalance.toString()} → ${recount.countedQuantity!.toString()}` : "Reconteo sin diferencia: se cierra sin ajuste",
  } });
  return { id, movementId: movement?.id ?? null, movementFolio: movement?.folio ?? null, type: movement?.type ?? null, quantity: adjustment?.quantity.toNumber() ?? 0,
    previousQuantity: currentBalance.toNumber(), newQuantity: recount.countedQuantity!.toNumber() };
}

export async function rejectDiscrepancyAdjustmentOnce<R extends Record<string, unknown>>(
  id: string, actorId: string, reason: string,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof rejectInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "DISCREPANCY_REJECTION", actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [discrepancyLockKey(id)], occurredAt: new Date(),
  }, async tx => toResponse(await rejectInTransaction(tx, id, actorId, reason)));
}

/**
 * YF-003 · Rechazo de la propuesta de ajuste: no mueve inventario; el expediente vuelve a investigación y exige un reconteo
 * nuevo antes de otra decisión. Mismo control de autorización e independencia que la aprobación.
 */
async function rejectInTransaction(tx: Prisma.TransactionClient, id: string, actorId: string, reason: string) {
  if (reason.trim().length < 8) throw new WarehouseDiscrepancyError("Indica el motivo del rechazo (mínimo 8 caracteres).");
  const ctx = await loadForDecision(tx, id);
  await assertIndependentApprover(tx, ctx, actorId);
  await tx.warehouseDiscrepancy.update({ where: { id }, data: { status: "IN_INVESTIGATION" } });
  await tx.warehouseDiscrepancyEvent.create({ data: {
    discrepancyId: id, type: "ADJUSTMENT_REJECTED", fromStatus: ctx.investigation.status, toStatus: "IN_INVESTIGATION", actorId,
    notes: `Rechazado (reconteo ${ctx.recount.folio}): ${reason.trim()}`,
  } });
  return { id, folio: ctx.investigation.folio, status: "IN_INVESTIGATION" as const };
}
