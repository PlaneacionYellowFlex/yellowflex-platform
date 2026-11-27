import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { WarehouseCatalogError } from "@/repositories/warehouse-catalog.repository";

/**
 * YF-003 V2 · Excepciones históricas documentadas de reconciliación (R3/R7).
 * Resuelven una inconsistencia HISTÓRICA sin fabricar custodias ni modificar movimientos: una entrega a Producción antigua que
 * nunca generó custodia queda documentada (motivo, evidencia, responsable) y la reconciliación la muestra como "documentada".
 * El registro es append-only (no se edita ni se borra) y no cambia existencias. Quien documenta no puede ser quien registró la entrega.
 */
export async function documentHandoffWithoutCustody(input: { movementId: unknown; reason: unknown; evidence?: unknown }, actorId: string) {
  const movementId = typeof input.movementId === "string" ? input.movementId.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) : "";
  const evidence = typeof input.evidence === "string" ? input.evidence.trim().slice(0, 1000) || null : null;
  if (!movementId) throw new WarehouseCatalogError("Indica la entrega a documentar.");
  if (reason.length < 20) throw new WarehouseCatalogError("Describe la causa y la evidencia revisada (mínimo 20 caracteres).");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"recon-exception:R3:" + movementId}, 0))`;
    const movement = await tx.inventoryMovement.findUnique({ where: { id: movementId }, select: { id: true, folio: true, type: true, actorId: true, openedCustody: { select: { id: true } } } });
    if (!movement) throw new WarehouseCatalogError("La entrega no existe.");
    if (movement.type !== "OPERATIONAL_HANDOFF") throw new WarehouseCatalogError("Solo se documentan entregas a Producción.");
    if (movement.openedCustody) throw new WarehouseCatalogError("La entrega ya tiene custodia vinculada; no requiere excepción.");
    if (movement.actorId === actorId) throw new WarehouseCatalogError("Quien registró la entrega no puede documentar su excepción.");
    const existing = await tx.warehouseReconciliationException.findUnique({ where: { checkCode_subjectType_subjectId: { checkCode: "R3", subjectType: "MOVEMENT", subjectId: movementId } } });
    if (existing) throw new WarehouseCatalogError("Esta entrega ya está documentada.");
    const row = await tx.warehouseReconciliationException.create({ data: { checkCode: "R3", subjectType: "MOVEMENT", subjectId: movementId, reason, evidence, actorId } });
    return { exception: row, folio: movement.folio };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
