import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { assertActiveCatalog } from "@/repositories/warehouse-catalog-guard";
import { cancelOperationalHandoffInTransaction, InsufficientWarehouseStockError } from "@/repositories/warehouse-custody.repository";
import { custodyLockKey, getWarehouseStockBalance, lockWarehouseKeys, stockLockKey } from "@/repositories/warehouse-stock-lock";
import { runStockOperationOnce } from "@/repositories/warehouse-stock-operation.repository";

/**
 * YF-003 · Salidas de material y reversos controlados.
 * Ninguna corrección modifica ni borra el movimiento original: se registra un movimiento compensatorio trazable
 * (referenceType "REVERSO", referenceNumber = folio original). Un movimiento se revierte una sola vez.
 */
export class WarehouseOperationError extends Error {}

export type ExternalIssueData = {
  folio: string; itemId: string; originLocationId: string; quantity: Prisma.Decimal; reason: string; destination: string;
  referenceNumber: string; notes?: string | null; actorId: string; occurredAt: Date;
};

export async function createExternalIssueOnce<R extends Record<string, unknown>>(
  data: ExternalIssueData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (movement: Awaited<ReturnType<typeof issueInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "EXTERNAL_ISSUE", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lock: { itemId: data.itemId, locationId: data.originLocationId }, occurredAt: data.occurredAt,
  }, async tx => toResponse(await issueInTransaction(tx, data)));
}

async function issueInTransaction(tx: Prisma.TransactionClient, data: ExternalIssueData) {
  const reason = data.reason.trim(); const destination = data.destination.trim(); const reference = data.referenceNumber.trim();
  if (reason.length < 8) throw new WarehouseOperationError("Indica el motivo de la salida (mínimo 8 caracteres).");
  if (!destination) throw new WarehouseOperationError("Indica el destino del material.");
  if (!reference) throw new WarehouseOperationError("Indica el documento u orden de referencia.");
  await lockWarehouseKeys(tx, [stockLockKey(data.itemId, data.originLocationId)]);
  await assertActiveCatalog(tx, data.itemId, [data.originLocationId]);
  const [item, origin] = await Promise.all([
    tx.inventoryItem.findUnique({ where: { id: data.itemId } }),
    tx.warehouseLocation.findUnique({ where: { id: data.originLocationId }, include: { warehouse: true } }),
  ]);
  if (!item || !origin) throw new WarehouseOperationError("El artículo o la ubicación no existen.");
  const available = await getWarehouseStockBalance(tx, item.id, origin.id);
  if (available.lessThan(data.quantity)) throw new InsufficientWarehouseStockError(available.toNumber(), data.quantity.toNumber());
  return tx.inventoryMovement.create({
    data: {
      folio: data.folio, itemId: item.id, type: "EXTERNAL_ISSUE", quantity: data.quantity, unit: item.baseUnit,
      originLocationId: origin.id, destinationLocationId: null, referenceType: "SALIDA", referenceNumber: reference,
      notes: [`Motivo: ${reason}`, `Destino: ${destination}`, data.notes?.trim()].filter(Boolean).join(" · "),
      occurredAt: data.occurredAt, actorId: data.actorId,
    },
    include: { item: true, originLocation: true },
  });
}

const REVERSIBLE = ["EXTERNAL_RECEIPT", "EXTERNAL_ISSUE", "INTERNAL_TRANSFER", "OPERATIONAL_HANDOFF"] as const;

export type ReverseMovementData = { movementId: string; folio: string; custodyFolioHint?: string; reason: string; actorId: string; occurredAt: Date };

export function reversalLockKey(movementId: string) {
  return JSON.stringify(["reversal", movementId]);
}

export async function reverseMovementOnce<R extends Record<string, unknown>>(
  data: ReverseMovementData,
  operation: { idempotencyKey: string; payload: Record<string, unknown> },
  toResponse: (result: Awaited<ReturnType<typeof reverseInTransaction>>) => R,
) {
  return runStockOperationOnce({
    kind: "MOVEMENT_REVERSAL", actorId: data.actorId, idempotencyKey: operation.idempotencyKey, payload: operation.payload,
    lockKeys: [reversalLockKey(data.movementId)], occurredAt: data.occurredAt,
  }, async tx => toResponse(await reverseInTransaction(tx, data)));
}

/**
 * Reverso controlado:
 *  - Entrada externa  → salida compensatoria desde la ubicación que recibió (exige existencia disponible).
 *  - Salida externa   → entrada compensatoria a la ubicación de origen.
 *  - Transferencia    → transferencia inversa (exige existencia en el destino original).
 *  - Entrega a Producción → solo mientras no fue recibida: cancelación con regreso a la ubicación original.
 * No se revierten saldos iniciales, ajustes (se corrigen con un conteo nuevo), devoluciones ni reversos.
 * Quien revierte debe ser distinto de quien registró el movimiento original y debe indicar el motivo.
 */
async function reverseInTransaction(tx: Prisma.TransactionClient, data: ReverseMovementData) {
  const reason = data.reason.trim();
  if (reason.length < 8) throw new WarehouseOperationError("Indica el motivo del reverso (mínimo 8 caracteres).");
  await lockWarehouseKeys(tx, [reversalLockKey(data.movementId)]);
  const original = await tx.inventoryMovement.findUnique({ where: { id: data.movementId }, include: { item: true } });
  if (!original) throw new WarehouseOperationError("El movimiento no existe.");
  if (original.referenceType === "REVERSO") throw new WarehouseOperationError("Un reverso no puede revertirse; registra la operación correcta.");
  if (!(REVERSIBLE as readonly string[]).includes(original.type)) {
    throw new WarehouseOperationError("Este tipo de movimiento no se revierte directamente. Los ajustes se corrigen con un conteo y una diferencia nueva.");
  }
  if (original.actorId === data.actorId) throw new WarehouseOperationError("El reverso debe registrarlo una persona distinta de quien hizo el movimiento original.");
  const existing = await tx.inventoryMovement.findFirst({ where: { referenceType: "REVERSO", referenceNumber: original.folio }, select: { folio: true } });
  if (existing) throw new WarehouseOperationError(`El movimiento ya fue revertido (${existing.folio}).`);
  const notes = `Reverso de ${original.folio}: ${reason}`;

  if (original.type === "OPERATIONAL_HANDOFF") {
    const custody = await findHandoffCustody(tx, original);
    if (!custody) throw new WarehouseOperationError("Esta entrega no tiene una custodia vinculada; ejecuta el diagnóstico de vínculos antes de revertirla.");
    await lockWarehouseKeys(tx, [custodyLockKey(custody.id)]);
    const result = await cancelOperationalHandoffInTransaction(tx, { custodyId: custody.id, movementFolio: data.folio, reason, actorId: data.actorId, occurredAt: data.occurredAt });
    return { reversalFolio: result.movement.folio, originalFolio: original.folio, type: result.movement.type, quantity: result.quantity, unit: result.unit, custodyFolio: result.custodyFolio };
  }

  const outOf = original.type === "EXTERNAL_RECEIPT" ? original.destinationLocationId
    : original.type === "INTERNAL_TRANSFER" ? original.destinationLocationId : null;
  const into = original.type === "EXTERNAL_ISSUE" ? original.originLocationId
    : original.type === "INTERNAL_TRANSFER" ? original.originLocationId : null;
  const keys = [outOf, into].filter((v): v is string => !!v).map(l => stockLockKey(original.itemId, l));
  await lockWarehouseKeys(tx, keys);
  await assertActiveCatalog(tx, original.itemId, [outOf, into]);
  if (outOf) {
    const available = await getWarehouseStockBalance(tx, original.itemId, outOf);
    if (available.lessThan(original.quantity)) {
      throw new WarehouseOperationError(`El material ya no está disponible para revertir: existencia ${available.toString()} ${original.unit}, se requieren ${original.quantity.toString()}.`);
    }
  }
  const type = original.type === "EXTERNAL_RECEIPT" ? "EXTERNAL_ISSUE" : original.type === "EXTERNAL_ISSUE" ? "EXTERNAL_RECEIPT" : "INTERNAL_TRANSFER";
  const movement = await tx.inventoryMovement.create({ data: {
    folio: data.folio, itemId: original.itemId, type, quantity: original.quantity, unit: original.unit,
    originLocationId: outOf, destinationLocationId: into, referenceType: "REVERSO", referenceNumber: original.folio,
    notes, occurredAt: data.occurredAt, actorId: data.actorId,
  } });
  return { reversalFolio: movement.folio, originalFolio: original.folio, type: movement.type, quantity: movement.quantity.toNumber(), unit: movement.unit, custodyFolio: null };
}

/** YF-003 V2: solo por vínculo explícito (sourceMovementId); sin búsquedas por folio ni coincidencias indirectas. */
async function findHandoffCustody(tx: Prisma.TransactionClient, original: { id: string }) {
  return tx.inventoryCustody.findUnique({ where: { sourceMovementId: original.id } });
}

/** Movimientos y su reverso (si existe), para mostrar el estado "revertido" en Kardex y detalle. */
export async function reversalsFor(folios: string[]) {
  if (folios.length === 0) return new Map<string, string>();
  const rows = await db.inventoryMovement.findMany({ where: { referenceType: "REVERSO", referenceNumber: { in: folios } }, select: { folio: true, referenceNumber: true } });
  return new Map(rows.map(r => [r.referenceNumber as string, r.folio]));
}
