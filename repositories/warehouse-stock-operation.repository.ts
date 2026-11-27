import { Prisma, type WarehouseStockOperationKind } from "@prisma/client";

import { db } from "@/lib/db";
import { isSerializationConflict, isUniqueConflict, payloadHash } from "@/lib/warehouse-idempotency";
import { WarehouseStockOperationConflictError } from "@/repositories/warehouse-movements.repository";
import { lockWarehouseKeys, stockLockKey } from "@/repositories/warehouse-stock-lock";

/**
 * YF-003 · Ejecuta una operación de existencias exactamente una vez por (tipo, usuario, Idempotency-Key).
 *  - La misma clave con el mismo contenido devuelve la respuesta original sin crear otro movimiento (doble clic, reintento).
 *  - La misma clave con contenido distinto se rechaza (WarehouseStockOperationConflictError).
 *  - Dos solicitudes simultáneas con la misma clave: una crea, la otra recibe la respuesta registrada (índice único).
 * El bloqueo de existencias (artículo + ubicación) es el mismo que usan transferencias y entregas a Producción.
 */
export async function runStockOperationOnce<R extends Record<string, unknown>>(
  input: {
    kind: WarehouseStockOperationKind;
    actorId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    /** Bloqueo de existencias (artículo + ubicación). */
    lock?: { itemId: string; locationId: string };
    /** Bloqueos adicionales (otras existencias o custodias); se toman todos en orden determinista. */
    lockKeys?: readonly string[];
    occurredAt: Date;
  },
  work: (tx: Prisma.TransactionClient) => Promise<R>,
): Promise<{ response: R; replayed: boolean }> {
  const operationKey = `${input.kind}:${input.actorId}:${input.idempotencyKey.toLowerCase()}`;
  const requestHash = payloadHash({ kind: input.kind, actorId: input.actorId, payload: input.payload });
  const read = (previous: { operationPayloadHash: string; responseBody: Prisma.JsonValue | null } | null) => {
    if (!previous) return null;
    if (previous.operationPayloadHash !== requestHash) throw new WarehouseStockOperationConflictError();
    return { response: previous.responseBody as R, replayed: true };
  };
  const readExisting = async () => read(await db.warehouseStockOperation.findUnique({
    where: { operationKey }, select: { operationPayloadHash: true, responseBody: true },
  }));

  const prior = await readExisting();
  if (prior) return prior;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(async tx => {
        const keys = [...(input.lockKeys ?? [])];
        if (input.lock) keys.push(stockLockKey(input.lock.itemId, input.lock.locationId));
        if (keys.length === 0) throw new Error("Una operación de Almacén requiere al menos un bloqueo.");
        await lockWarehouseKeys(tx, keys);
        const again = read(await tx.warehouseStockOperation.findUnique({
          where: { operationKey }, select: { operationPayloadHash: true, responseBody: true },
        }));
        if (again) return again;
        const response = await work(tx);
        await tx.warehouseStockOperation.create({
          data: {
            operationKey, operationPayloadHash: requestHash, kind: input.kind, actorId: input.actorId,
            requestBody: JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonObject,
            responseBody: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonObject,
            processedAt: input.occurredAt,
          },
        });
        return { response, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (isUniqueConflict(error) || isSerializationConflict(error)) {
        const completed = await readExisting();
        if (completed) return completed;
        if (isSerializationConflict(error) && attempt < 2) continue;
      }
      throw error;
    }
  }
}
