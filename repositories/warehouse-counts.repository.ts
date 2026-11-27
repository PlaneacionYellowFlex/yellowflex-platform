import { Prisma, WarehouseCountType } from "@prisma/client";
import { db } from "@/lib/db";
import { assertActiveCatalog } from "@/repositories/warehouse-catalog-guard";
import { getWarehouseStockBalance, lockWarehouseKeys, stockLockKey } from "@/repositories/warehouse-stock-lock";
import { runStockOperationOnce } from "@/repositories/warehouse-stock-operation.repository";

export class WarehouseCountError extends Error {}

/** Cantidad contada: cero o positiva, máximo 15 enteros y 3 decimales (aritmética decimal exacta, sin punto flotante). */
export function parseCountedQuantity(value: unknown) {
  const raw = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : typeof value === "string" ? value.trim() : "";
  const match = /^\+?(\d+)(?:\.(\d{1,3}))?$/.exec(raw);
  if (!match || (match[1].replace(/^0+/, "") || "0").length > 15) {
    throw new WarehouseCountError("Cantidad contada inválida; debe ser cero o positiva con máximo tres decimales.");
  }
  return new Prisma.Decimal(raw.replace(/^\+/, ""));
}

export function countLockKey(countId: string) {
  return JSON.stringify(["count", countId]);
}

export function listWarehouseCounts() {
  return db.warehouseCount.findMany({
    include: { item: true, location: { include: { warehouse: true } } },
    orderBy: [{ status: "asc" }, { launchedAt: "desc" }],
  });
}

export type CreateWarehouseCountData = {
  folio: string;
  itemId: string;
  locationId: string;
  type: WarehouseCountType;
  notes?: string;
  actorId: string;
};

export async function createWarehouseCount(data: CreateWarehouseCountData) {
  return db.$transaction(tx => createCountInTransaction(tx, data), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** YF-003: lanzamiento de conteo exactamente una vez por Idempotency-Key; un solo conteo abierto por artículo y ubicación. */
export async function createWarehouseCountOnce<R extends Record<string, unknown>>(
  data: CreateWarehouseCountData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (count: Awaited<ReturnType<typeof createCountInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "COUNT_LAUNCH", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lock: { itemId: data.itemId, locationId: data.locationId }, occurredAt: new Date(),
  }, async tx => toResponse(await createCountInTransaction(tx, data)));
}

async function createCountInTransaction(tx: Prisma.TransactionClient, data: CreateWarehouseCountData) {
  // El bloqueo de existencias congela la ubicación mientras se toma la existencia teórica de referencia.
  await lockWarehouseKeys(tx, [stockLockKey(data.itemId, data.locationId)]);
  try { await assertActiveCatalog(tx, data.itemId, [data.locationId]); }
  catch (error) { throw new WarehouseCountError(error instanceof Error ? error.message : "El artículo o la ubicación no están disponibles."); }
  const open = await tx.warehouseCount.findFirst({ where: { itemId: data.itemId, locationId: data.locationId, status: "OPEN" } });
  if (open) throw new WarehouseCountError(`Ya existe un conteo abierto: ${open.folio}.`);
  const expectedQuantity = await getWarehouseStockBalance(tx, data.itemId, data.locationId);
  return tx.warehouseCount.create({
    data: {
      folio: data.folio, itemId: data.itemId, locationId: data.locationId, type: data.type, notes: data.notes?.trim() || null,
      expectedQuantity, launchedAt: new Date(), createdById: data.actorId,
    },
  });
}

export type CompleteWarehouseCountData = {
  id: string;
  countedQuantity: number | string | Prisma.Decimal;
  notes?: string;
  actorId: string;
};

export async function completeWarehouseCount(data: CompleteWarehouseCountData) {
  return db.$transaction(tx => completeCountInTransaction(tx, data), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** YF-003: cierre de conteo exactamente una vez por Idempotency-Key; doble cierre simultáneo registra un solo resultado. */
export async function completeWarehouseCountOnce<R extends Record<string, unknown>>(
  data: CompleteWarehouseCountData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof completeCountInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "COUNT_COMPLETE", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [countLockKey(data.id)], occurredAt: new Date(),
  }, async tx => toResponse(await completeCountInTransaction(tx, data)));
}

async function completeCountInTransaction(tx: Prisma.TransactionClient, data: CompleteWarehouseCountData) {
  const counted = data.countedQuantity instanceof Prisma.Decimal ? data.countedQuantity : parseCountedQuantity(data.countedQuantity);
  if (counted.isNegative() || counted.decimalPlaces() > 3) {
    throw new WarehouseCountError("Cantidad contada inválida; debe ser cero o positiva con máximo tres decimales.");
  }
  await lockWarehouseKeys(tx, [countLockKey(data.id)]);
  const count = await tx.warehouseCount.findUnique({ where: { id: data.id } });
  if (!count || count.status !== "OPEN") throw new WarehouseCountError("El conteo no está abierto.");
  await lockWarehouseKeys(tx, [stockLockKey(count.itemId, count.locationId)]);
  // Conteo desactualizado: cualquier movimiento posterior al inicio, o una existencia actual distinta de la teórica de
  // referencia (cubre movimientos confirmados después del inicio aunque su transacción hubiera empezado antes), impide cerrar.
  const changed = await tx.inventoryMovement.count({
    where: { itemId: count.itemId, createdAt: { gt: count.launchedAt }, OR: [{ originLocationId: count.locationId }, { destinationLocationId: count.locationId }] },
  });
  const current = await getWarehouseStockBalance(tx, count.itemId, count.locationId);
  if (changed > 0 || !current.equals(count.expectedQuantity)) {
    throw new WarehouseCountError(
      `La existencia de la ubicación cambió desde que inició el conteo${changed > 0 ? ` (${changed} movimiento(s))` : ""}. No puede cerrarse con una existencia teórica desactualizada: cancela este conteo y lanza uno nuevo.`,
    );
  }
  const difference = counted.minus(count.expectedQuantity);
  const updated = await tx.warehouseCount.updateMany({
    where: { id: count.id, status: "OPEN" },
    data: { status: "COMPLETED", countedQuantity: counted, difference, countedAt: new Date(), countedById: data.actorId, notes: data.notes?.trim() || count.notes },
  });
  if (updated.count !== 1) throw new WarehouseCountError("El conteo ya fue cerrado por otra solicitud.");
  let discrepancyFolio: string | null = null;
  if (!difference.isZero()) {
    const discrepancy = await tx.warehouseDiscrepancy.create({
      data: { folio: `DIS-${count.folio.replace(/^CNT-/, "")}`, countId: count.id, status: "OPEN", classification: "UNCLASSIFIED" },
    });
    discrepancyFolio = discrepancy.folio;
    await tx.warehouseDiscrepancyEvent.create({ data: {
      discrepancyId: discrepancy.id, type: "DETECTED", fromStatus: null, toStatus: "OPEN", actorId: data.actorId,
      notes: `Conteo ${count.folio}: teórico ${count.expectedQuantity.toString()}, físico ${counted.toString()}, diferencia ${difference.toString()}. Sin efecto en existencias.`,
    } });
  }
  return {
    folio: count.folio,
    expected: count.expectedQuantity.toNumber(),
    counted: counted.toNumber(),
    difference: difference.toNumber(),
    discrepancyFolio,
  };
}

export type CancelWarehouseCountData = { id: string; reason: string; actorId: string };

/** YF-003: un conteo abierto que quedó desactualizado se cancela con motivo (no se borra) para lanzar uno nuevo. */
export async function cancelWarehouseCount(data: CancelWarehouseCountData) {
  if (data.reason.trim().length < 8) throw new WarehouseCountError("Indica el motivo de la cancelación (mínimo 8 caracteres).");
  return db.$transaction(async tx => {
    await lockWarehouseKeys(tx, [countLockKey(data.id)]);
    const count = await tx.warehouseCount.findUnique({ where: { id: data.id } });
    if (!count || count.status !== "OPEN") throw new WarehouseCountError("Solo pueden cancelarse conteos abiertos.");
    const notes = [count.notes, `Cancelado ${new Date().toISOString()} por usuario ${data.actorId}: ${data.reason.trim()}`].filter(Boolean).join(" · ");
    await tx.warehouseCount.update({ where: { id: count.id }, data: { status: "CANCELLED", notes } });
    return { folio: count.folio, status: "CANCELLED" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
