import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseCountedQuantity } from "@/repositories/warehouse-counts.repository";
import { getWarehouseStockBalance, lockWarehouseKeys, stockLockKey } from "@/repositories/warehouse-stock-lock";
import { runStockOperationOnce } from "@/repositories/warehouse-stock-operation.repository";

export class WarehouseRecountError extends Error {}

export function discrepancyLockKey(discrepancyId: string) {
  return JSON.stringify(["discrepancy", discrepancyId]);
}

export type RequestRecountData = { discrepancyId: string; reason: string; actorId: string; folio: string };

export async function requestRecount(discrepancyId: string, reason: string, actorId: string, folio: string) {
  return db.$transaction(tx => requestRecountInTransaction(tx, { discrepancyId, reason, actorId, folio }), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function requestRecountOnce<R extends Record<string, unknown>>(
  data: RequestRecountData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (recount: Awaited<ReturnType<typeof requestRecountInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "RECOUNT_REQUEST", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [discrepancyLockKey(data.discrepancyId)], occurredAt: new Date(),
  }, async tx => toResponse(await requestRecountInTransaction(tx, data)));
}

async function requestRecountInTransaction(tx: Prisma.TransactionClient, data: RequestRecountData) {
  if (data.reason.trim().length < 8) throw new WarehouseRecountError("Indica el motivo del reconteo (mínimo 8 caracteres).");
  await lockWarehouseKeys(tx, [discrepancyLockKey(data.discrepancyId)]);
  const c = await tx.warehouseDiscrepancy.findUnique({ where: { id: data.discrepancyId }, include: { count: true } });
  if (!c || c.status === "CLOSED") throw new WarehouseRecountError("Expediente inexistente o cerrado.");
  if (c.classification !== "REAL") throw new WarehouseRecountError("Solo las diferencias reales permiten reconteo.");
  const open = await tx.warehouseDiscrepancyRecount.findFirst({ where: { discrepancyId: data.discrepancyId, status: "OPEN" } });
  if (open) throw new WarehouseRecountError("Ya existe un reconteo abierto.");
  await lockWarehouseKeys(tx, [stockLockKey(c.count.itemId, c.count.locationId)]);
  const expected = await getWarehouseStockBalance(tx, c.count.itemId, c.count.locationId);
  const recount = await tx.warehouseDiscrepancyRecount.create({
    data: { folio: data.folio, discrepancyId: data.discrepancyId, reason: data.reason.trim(), requestedById: data.actorId, expectedQuantity: expected },
  });
  await tx.warehouseDiscrepancyEvent.create({ data: {
    discrepancyId: c.id, type: "RECOUNT_REQUESTED", fromStatus: c.status, toStatus: c.status, actorId: data.actorId,
    notes: `Reconteo ${recount.folio} (teórico ${expected.toString()}): ${data.reason.trim()}`,
  } });
  return recount;
}

export type CompleteRecountData = { id: string; quantity: number | string | Prisma.Decimal; notes: string; actorId: string };

export async function completeRecount(id: string, quantity: number | string, notes: string, actorId: string) {
  return db.$transaction(tx => completeRecountInTransaction(tx, { id, quantity, notes, actorId }), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function completeRecountOnce<R extends Record<string, unknown>>(
  data: CompleteRecountData & { discrepancyId: string },
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof completeRecountInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "RECOUNT_COMPLETE", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [discrepancyLockKey(data.discrepancyId)], occurredAt: new Date(),
  }, async tx => toResponse(await completeRecountInTransaction(tx, data)));
}

async function completeRecountInTransaction(tx: Prisma.TransactionClient, data: CompleteRecountData) {
  let counted: Prisma.Decimal;
  try { counted = data.quantity instanceof Prisma.Decimal ? data.quantity : parseCountedQuantity(data.quantity); }
  catch { throw new WarehouseRecountError("Cantidad inválida; debe ser cero o positiva con máximo tres decimales."); }
  const head = await tx.warehouseDiscrepancyRecount.findUnique({ where: { id: data.id }, select: { discrepancyId: true } });
  if (!head) throw new WarehouseRecountError("El reconteo no existe.");
  await lockWarehouseKeys(tx, [discrepancyLockKey(head.discrepancyId)]);
  const r = await tx.warehouseDiscrepancyRecount.findUnique({ where: { id: data.id }, include: { discrepancy: { include: { count: true } } } });
  if (!r || r.status !== "OPEN") throw new WarehouseRecountError("El reconteo ya no está abierto.");
  const c = r.discrepancy;
  if (c.status === "CLOSED") throw new WarehouseRecountError("La investigación está cerrada.");
  // YF-003: el reconteo es independiente; no lo captura quien hizo el conteo original.
  if (c.count.countedById === data.actorId) throw new WarehouseRecountError("El reconteo debe hacerlo una persona distinta de quien realizó el conteo original.");
  await lockWarehouseKeys(tx, [stockLockKey(c.count.itemId, c.count.locationId)]);
  const changed = await tx.inventoryMovement.count({ where: { itemId: c.count.itemId, createdAt: { gt: r.requestedAt }, OR: [{ originLocationId: c.count.locationId }, { destinationLocationId: c.count.locationId }] } });
  const current = await getWarehouseStockBalance(tx, c.count.itemId, c.count.locationId);
  if (changed || !current.equals(r.expectedQuantity)) {
    throw new WarehouseRecountError("La existencia cambió después de solicitar el reconteo. No puede cerrarse; solicita un reconteo nuevo.");
  }
  const difference = counted.minus(r.expectedQuantity);
  const updated = await tx.warehouseDiscrepancyRecount.updateMany({
    where: { id: data.id, status: "OPEN" },
    data: { status: "COMPLETED", countedQuantity: counted, difference, notes: data.notes.trim() || null, completedById: data.actorId, completedAt: new Date() },
  });
  if (updated.count !== 1) throw new WarehouseRecountError("El reconteo ya fue cerrado por otra solicitud.");
  await tx.warehouseDiscrepancyEvent.create({ data: {
    discrepancyId: c.id, type: "RECOUNT_COMPLETED", fromStatus: c.status, toStatus: c.status, actorId: data.actorId,
    notes: `Reconteo ${r.folio}: teórico ${r.expectedQuantity.toString()}, físico ${counted.toString()}, diferencia ${difference.toString()}.`,
  } });
  return { folio: r.folio, difference: difference.toNumber() };
}
