import "server-only";

/**
 * YF-002-C2 — conciliación, ajustes y cierre definitivo de la prenómina de Food Services.
 * - Plantilla de conciliación y reportes de control: solo lectura (no cambian estados financieros).
 * - Vista previa: lectura estricta del Excel de Nómina, comparación esperado contra aplicado, token firmado.
 * - Confirmación masiva: idempotente, transaccional, una sola conciliación vigente por lote; cada diferencia se
 *   registra como ajuste trazable a nivel colaborador (sin atribuir pagos parciales a pedidos individuales).
 * - Cierre: EXPORTED -> PARTIALLY_RECONCILED -> RECONCILED. Los pedidos pasan a PROCESSED solo si el colaborador
 *   quedó cubierto; los demás quedan EXPORTED y su asignación sigue ACTIVE (no se pueden volver a cobrar).
 * - Ajustes: resolución trazable (recuperado, devuelto, compensado, corregido, condonado); una resolución parcial
 *   deja un ajuste sucesor con el saldo remanente. Ninguna diferencia desaparece por cerrar el lote.
 * Orden de bloqueo uniforme: pedidos (id ascendente) -> lote -> conciliación -> ajuste.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { db as defaultDb } from "@/lib/db";
import { centsToDecimal, idempotencyKeySchema, sha256Hex, toCents } from "@/lib/food-services/payroll-batch-contract";
import { FoodPayrollBatchError, uniqueTarget } from "@/lib/food-services/payroll-batch-service";
import { getPayrollCapabilities, lockBatch, type PayrollCapability } from "@/lib/food-services/payroll-batch-operations";
import { lockFoodOrders } from "@/lib/food-services/order-lock";
import {
  RECONCILIATION_CONTRACT_VERSION, RECONCILIATION_PREVIEW_TTL_MS, ReconciliationContractError, buildReconciliationTemplate,
  compareReconciliation, parseReconciliationWorkbook, reconciliationMetaSchema, reconciliationRequestHash, reconciliationStateTag,
  resolveAdjustmentSchema, signReconciliationToken, validateResolution, verifyReconciliationToken,
  type ComparedRow, type Comparison, type ExpectedEmployee,
} from "@/lib/food-services/payroll-reconciliation-contract";
import {
  CONTROL_REPORT_TYPES, buildControlReport, controlFileName, type ControlReportType, type ReportAdjustment, type ReportEmployee,
} from "@/lib/food-services/payroll-reconciliation-reports";

type Db = PrismaClient | Prisma.TransactionClient;
type Stage = "reconciliation-created" | "employees-created" | "orders-updated" | "adjustment-resolved";
export type ReconciliationDeps = { db?: PrismaClient; onStage?: (stage: Stage) => void | Promise<void> };

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const RECONCILIATION_PAGE_SIZE = 50;
const CHUNK = 1000;

// ------------------------------------------------------------------ utilidades
async function requireCap(actor: AuthenticatedUser, cap: PayrollCapability, client: Db) {
  if (!actor.roles.includes("RH") || !(await getPayrollCapabilities(actor.id, client))[cap]) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
}

function parse<T>(schema: { parse(v: unknown): T }, raw: unknown): T {
  try { return schema.parse(raw); }
  catch (error) {
    const issue = (error as { issues?: Array<{ message: string }> }).issues?.[0]?.message;
    throw new FoodPayrollBatchError("INVALID_REQUEST", issue ?? "Solicitud inválida.", 400);
  }
}

function mapContract(error: unknown): never {
  if (error instanceof ReconciliationContractError) {
    const status = error.code === "PREVIEW_SECRET_MISSING" ? 503
      : ["FILE_EMPTY", "FILE_TOO_LARGE", "FILE_FORMAT", "STRUCTURE_INVALID", "PREVIEW_INVALID", "RESOLUTION_INVALID"].includes(error.code) ? 400 : 409;
    throw new FoodPayrollBatchError(error.code, error.message, status);
  }
  throw error;
}
async function contract<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) { return mapContract(error); }
}

const cents = (v: unknown) => toCents(v === null || v === undefined ? v : String(v)) ?? 0;
/** Importe con signo (diferencias y saldos). */
function signedCents(v: unknown) {
  const s = v === null || v === undefined ? "0" : String(v);
  return s.startsWith("-") ? -cents(s.slice(1)) : cents(s);
}
const dec = (c: number) => centsToDecimal(c);
const chunks = <T,>(list: T[], size = CHUNK) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

function batchStateError(status: string) {
  if (status === "PARTIALLY_RECONCILED") return new FoodPayrollBatchError("RECONCILIATION_EXISTS", "El lote ya tiene una conciliación registrada.", 409);
  if (status === "RECONCILED") return new FoodPayrollBatchError("BATCH_ALREADY_RECONCILED", "El lote ya está conciliado y cerrado.", 409);
  if (status === "VOIDED") return new FoodPayrollBatchError("BATCH_ALREADY_VOIDED", "El lote fue anulado.", 409);
  return new FoodPayrollBatchError("BATCH_NOT_EXPORTED", "Solo se concilia un lote con exportación oficial (EXPORTED).", 409);
}

async function audit(client: Db, data: Prisma.FoodPayrollAuditEventUncheckedCreateInput) {
  await client.foodPayrollAuditEvent.create({ data });
}
async function auditRejected(client: PrismaClient, actorId: string, batchId: string, key: string, hash: string, code: string, detail?: unknown) {
  try {
    await audit(client, { eventType: "RECONCILIATION_REJECTED", batchId, actorId, idempotencyKey: key, requestHash: hash, reasonCode: code.slice(0, 80),
      detail: detail === undefined ? undefined : (JSON.parse(JSON.stringify(detail)) as Prisma.InputJsonValue) });
  } catch { /* el rechazo ya se informa al cliente; el registro de auditoría es de mejor esfuerzo */ }
}

const batchSelect = {
  id: true, status: true, payrollReference: true, orderCount: true, employeeCount: true, serviceCount: true, committedAmount: true,
  exportedAt: true, fileSha256: true, fileName: true, closedAt: true, closeNote: true, closedBy: { select: { name: true } },
} satisfies Prisma.FoodPayrollBatchSelect;
type BatchRow = Prisma.FoodPayrollBatchGetPayload<{ select: typeof batchSelect }>;

async function loadBatch(client: Db, batchId: string): Promise<BatchRow> {
  const b = await client.foodPayrollBatch.findFirst({ where: { id: batchId, status: { not: "DRAFT" } }, select: batchSelect });
  if (!b) throw new FoodPayrollBatchError("BATCH_NOT_FOUND", "Lote de prenómina no encontrado.", 404);
  return b;
}

function batchView(b: BatchRow) {
  return { id: b.id, status: b.status, payrollReference: b.payrollReference, orderCount: b.orderCount, employeeCount: b.employeeCount,
    serviceCount: b.serviceCount, committedAmount: dec(cents(b.committedAmount)), exportedAt: b.exportedAt, fileName: b.fileName, fileSha256: b.fileSha256,
    closedAt: b.closedAt, closeNote: b.closeNote, closedBy: b.closedBy?.name ?? null };
}

/** Esperado por colaborador a partir de los snapshots inmutables del lote. */
export async function loadExpected(client: Db, batchId: string): Promise<ExpectedEmployee[]> {
  const groups = await client.foodPayrollBatchItem.groupBy({
    by: ["employeeId", "employeeNumber", "employeeName"], where: { batchId }, _count: { _all: true }, _sum: { committedAmount: true },
  });
  const seen = new Set<string>();
  return groups.map(g => {
    if (seen.has(g.employeeId)) throw new FoodPayrollBatchError("SNAPSHOT_INCONSISTENT", "El lote tiene datos de colaborador inconsistentes.", 409);
    seen.add(g.employeeId);
    return { employeeId: g.employeeId, employeeNumber: g.employeeNumber, employeeName: g.employeeName, orderCount: g._count._all, expectedCents: cents(g._sum.committedAmount) };
  });
}

function totalsView(c: Comparison["totals"]) {
  return { employees: c.employees, expected: dec(c.expectedCents), applied: dec(c.appliedCents), covered: dec(c.coveredCents),
    pendingRecovery: dec(c.pendingRecoveryCents), pendingRefund: dec(c.pendingRefundCents), difference: dec(c.differenceCents),
    complete: c.complete, partial: c.partial, notApplied: c.notApplied, overApplied: c.overApplied };
}
const rowView = (r: ComparedRow) => ({ employeeId: r.employeeId, employeeNumber: r.employeeNumber, employeeName: r.employeeName, orderCount: r.orderCount,
  expected: dec(r.expectedCents), applied: dec(r.appliedCents), difference: dec(r.differenceCents), result: r.result, sourceRow: r.sourceRow, note: r.note, matchedBy: r.matchedBy });

function adjustmentReason(r: ComparedRow) {
  const base = r.result === "NOT_APPLIED"
    ? `Nómina no aplicó el descuento (0.00 de ${dec(r.expectedCents)}). Saldo por recuperar ${dec(-r.differenceCents)}.`
    : r.result === "PARTIAL"
      ? `Descuento parcial: Nómina aplicó ${dec(r.appliedCents)} de ${dec(r.expectedCents)}. Saldo por recuperar ${dec(-r.differenceCents)}.`
      : `Descuento superior al esperado: Nómina aplicó ${dec(r.appliedCents)} de ${dec(r.expectedCents)}. Importe por devolver o compensar ${dec(r.differenceCents)}.`;
  return (r.note ? `${base} Comentario del archivo: ${r.note}` : base).slice(0, 1000);
}

// ------------------------------------------------------------------ plantilla (control, sin cambios de estado)
export async function downloadReconciliationTemplate(actor: AuthenticatedUser, batchId: string, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "reconcile", client);
  const batch = await loadBatch(client, batchId);
  if (batch.status !== "EXPORTED") throw batchStateError(batch.status);
  const expected = await loadExpected(client, batchId);
  const at = new Date();
  const body = await buildReconciliationTemplate({ id: batch.id, payrollReference: batch.payrollReference }, expected, { generatedAt: at, generatedBy: actor.name });
  const fileSha256 = sha256Hex(body);
  const fileName = controlFileName("reconciliation", batch.payrollReference, batch.id, at).replace(/^Conciliacion_/, "Plantilla_Conciliacion_");
  await audit(client, { eventType: "CONTROL_EXPORTED", batchId, actorId: actor.id, reasonCode: "RECONCILIATION_TEMPLATE", detail: { fileName, fileSha256, bytes: body.length } });
  return { fileName, fileSha256, body, contentType: XLSX };
}

// ------------------------------------------------------------------ vista previa (solo lectura)
const fileNameSchema = z.string().trim().min(1, "Nombre de archivo obligatorio.").max(255);

export async function previewReconciliation(actor: AuthenticatedUser, batchId: string, file: Buffer, fileNameRaw: unknown, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "reconcile", client);
  const fileName = parse(fileNameSchema, fileNameRaw);
  const started = Date.now();
  const parsed = await contract(() => parseReconciliationWorkbook(file));
  const { batch, expected, recons } = await client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const b = await loadBatch(tx, batchId);
    return { batch: b, expected: await loadExpected(tx, batchId),
      recons: await tx.foodPayrollReconciliation.findMany({ where: { batchId }, select: { id: true, voidedAt: true } }) };
  });
  if (batch.status !== "EXPORTED") throw batchStateError(batch.status);
  const cmp = compareReconciliation({ id: batch.id, payrollReference: batch.payrollReference }, expected, parsed);
  const fileSha256 = sha256Hex(file);
  const valid = cmp.errors.length === 0;
  const issuedAt = Date.now(); const expiresAt = issuedAt + RECONCILIATION_PREVIEW_TTL_MS;
  const previewToken = valid ? await contract(() => signReconciliationToken({ k: "RC", v: RECONCILIATION_CONTRACT_VERSION, a: actor.id, b: batch.id,
    f: fileSha256, d: cmp.digest, s: reconciliationStateTag(batch, recons), iat: issuedAt, exp: expiresAt })) : null;
  const errorCounts: Record<string, number> = {};
  for (const e of cmp.errors) errorCounts[e.code] = (errorCounts[e.code] ?? 0) + 1;
  return {
    contractVersion: RECONCILIATION_CONTRACT_VERSION, batch: batchView(batch), fileName, fileSha256, bytes: file.length, rowsRead: cmp.rowsRead,
    valid, errorCount: cmp.errors.length, errorCounts, errors: cmp.errors.slice(0, 1000), warnings: cmp.warnings.slice(0, 1000),
    missingCount: cmp.missing.length, totals: totalsView(cmp.totals), rows: cmp.rows.map(rowView), previewDigest: cmp.digest,
    previewToken, issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), elapsedMs: Date.now() - started,
    notice: valid ? "Revisa las diferencias. Al confirmar se registra la conciliación completa y cada diferencia como ajuste trazable."
      : "El archivo tiene errores. Corrígelos y vuelve a importarlo; no se registró nada.",
  };
}

// ------------------------------------------------------------------ confirmación masiva (idempotente)
export type ConfirmReconciliationResult = { status: 200 | 201; replayed: boolean; body: Record<string, unknown> };

async function replayReconciliation(client: PrismaClient, actor: AuthenticatedUser, batchId: string, key: string, hash: string): Promise<ConfirmReconciliationResult | null> {
  const existing = await client.foodPayrollReconciliation.findUnique({ where: { idempotencyKey: key },
    select: { id: true, batchId: true, actorId: true, requestHash: true, idempotencyResponse: true } });
  if (!existing) return null;
  if (existing.actorId !== actor.id || existing.requestHash !== hash || existing.batchId !== batchId) {
    await auditRejected(client, actor.id, existing.batchId, key, hash, "IDEMPOTENCY_KEY_REUSED");
    throw new FoodPayrollBatchError("IDEMPOTENCY_KEY_REUSED", "La clave de idempotencia ya se usó con otra solicitud.", 409);
  }
  await audit(client, { eventType: "RECONCILIATION_REPLAYED", batchId: existing.batchId, actorId: actor.id, idempotencyKey: key, requestHash: hash });
  return { status: 200, replayed: true, body: existing.idempotencyResponse as Record<string, unknown> };
}

export async function confirmReconciliation(
  actor: AuthenticatedUser, batchId: string, file: Buffer, metaRaw: unknown, keyRaw: unknown, deps: ReconciliationDeps = {},
): Promise<ConfirmReconciliationResult> {
  const client = deps.db ?? defaultDb;
  const key = parse(idempotencyKeySchema, keyRaw);
  const meta = parse(reconciliationMetaSchema, metaRaw);
  const token = await contract(() => verifyReconciliationToken(meta.previewToken));
  const fileSha256 = sha256Hex(file);
  const externalReference = meta.externalReference ? meta.externalReference : null;
  const hash = reconciliationRequestHash({ actorId: actor.id, batchId, fileSha256, digest: token.d, externalReference });

  await requireCap(actor, "reconcile", client);
  const replay = await replayReconciliation(client, actor, batchId, key, hash);
  if (replay) return replay;
  const knownBatch = token.b === batchId ? batchId : null;
  const reject = async (code: string, message: string, details?: unknown, status = 409): Promise<never> => {
    if (knownBatch) await auditRejected(client, actor.id, knownBatch, key, hash, code, details);
    throw new FoodPayrollBatchError(code, message, status, details);
  };
  if (token.a !== actor.id) await reject("PREVIEW_ACTOR_MISMATCH", "La vista previa pertenece a otro usuario.", undefined, 403);
  if (token.b !== batchId || token.f !== fileSha256) await reject("PREVIEW_MISMATCH", "El archivo o el lote no corresponden a la vista previa. Importa de nuevo el archivo.");
  if (token.expired) await reject("PREVIEW_EXPIRED", "La vista previa expiró. Importa nuevamente el archivo.");
  const parsed = await contract(() => parseReconciliationWorkbook(file));

  try {
    const body = await client.$transaction(async tx => {
      await requireCap(actor, "reconcile", tx);
      await lockBatch(tx, batchId);
      const batch = await loadBatch(tx, batchId);
      if (batch.status !== "EXPORTED") throw batchStateError(batch.status);
      const recons = await tx.foodPayrollReconciliation.findMany({ where: { batchId }, select: { id: true, voidedAt: true } });
      if (reconciliationStateTag(batch, recons) !== token.s) {
        throw new FoodPayrollBatchError("PREVIEW_STALE", "La conciliación del lote cambió después de la vista previa. Importa nuevamente el archivo.", 409);
      }
      const expected = await loadExpected(tx, batchId);
      const cmp = compareReconciliation({ id: batch.id, payrollReference: batch.payrollReference }, expected, parsed);
      if (cmp.errors.length || cmp.digest !== token.d) {
        throw new FoodPayrollBatchError("PREVIEW_STALE", "El resultado ya no coincide con la vista previa. Importa nuevamente el archivo.", 409,
          { errors: cmp.errors.length });
      }
      const t = cmp.totals;
      const reconciliationId = randomUUID();
      const now = new Date();
      const differences = cmp.rows.filter(r => r.result !== "COMPLETE");
      const response = {
        reconciliationId, batchId, payrollReference: batch.payrollReference, status: "PARTIALLY_RECONCILED", reconciliationStatus: "RECEIVED",
        fileName: meta.fileName, fileSha256, recordedAt: now.toISOString(), totals: totalsView(t), adjustmentsCreated: differences.length,
        notice: "Conciliación registrada. Revisa los ajustes y cierra el lote cuando corresponda; cerrar no liquida diferencias.",
      };
      await tx.foodPayrollReconciliation.create({ data: {
        id: reconciliationId, batchId, status: "RECEIVED", idempotencyKey: key, requestHash: hash, idempotencyResponse: response,
        contractVersion: RECONCILIATION_CONTRACT_VERSION, payrollReference: batch.payrollReference, previewDigest: token.d,
        fileName: meta.fileName, externalReference, expectedAmount: dec(t.expectedCents), receivedAmount: dec(t.appliedCents),
        reconciledAmount: dec(t.coveredCents), unreconciledAmount: dec(t.pendingRecoveryCents), pendingRefundAmount: dec(t.pendingRefundCents),
        employeeCount: t.employees, completeCount: t.complete, partialCount: t.partial, notAppliedCount: t.notApplied, overCount: t.overApplied,
        evidenceSha256: fileSha256, evidenceContent: new Uint8Array(file), actorId: actor.id, reconciledAt: now,
      } });
      await deps.onStage?.("reconciliation-created");
      const ids = new Map(cmp.rows.map(r => [r.employeeId, randomUUID()]));
      for (const part of chunks(cmp.rows)) {
        await tx.foodPayrollReconciliationEmployee.createMany({ data: part.map(r => ({
          id: ids.get(r.employeeId)!, reconciliationId, batchId, employeeId: r.employeeId, employeeNumber: r.employeeNumber, employeeName: r.employeeName,
          orderCount: r.orderCount, expectedAmount: dec(r.expectedCents), appliedAmount: dec(r.appliedCents), differenceAmount: dec(r.differenceCents),
          result: r.result, sourceRow: r.sourceRow, note: r.note,
        })) });
      }
      for (const part of chunks(differences)) {
        await tx.foodPayrollAdjustment.createMany({ data: part.map(r => ({
          id: randomUUID(), batchId, reconciliationId, reconciliationEmployeeId: ids.get(r.employeeId)!, employeeId: r.employeeId,
          employeeNumber: r.employeeNumber, employeeName: r.employeeName, kind: r.result as "PARTIAL" | "NOT_APPLIED" | "OVER_APPLIED", status: "PENDING",
          originalAmount: dec(r.expectedCents), adjustedAmount: dec(r.appliedCents), differenceAmount: dec(r.differenceCents),
          balanceAmount: dec(-r.differenceCents), reason: adjustmentReason(r), actorId: actor.id, createdAt: now,
        })) });
      }
      await deps.onStage?.("employees-created");
      // El trigger del lote valida en base de datos cobertura total, totales y un ajuste por diferencia.
      await tx.foodPayrollBatch.update({ where: { id: batchId }, data: { status: "PARTIALLY_RECONCILED" } });
      await audit(tx, { eventType: "RECONCILIATION_RECORDED", batchId, actorId: actor.id, idempotencyKey: key, requestHash: hash, orderCount: batch.orderCount,
        detail: { reconciliationId, fileName: meta.fileName, fileSha256, ...totalsView(t) } });
      if (differences.length) {
        await audit(tx, { eventType: "ADJUSTMENT_RECORDED", batchId, actorId: actor.id, reasonCode: "RECONCILIATION_DIFFERENCES",
          detail: { reconciliationId, adjustments: differences.length, pendingRecovery: dec(t.pendingRecoveryCents), pendingRefund: dec(t.pendingRefundCents) } });
      }
      return response;
    }, { maxWait: 10_000, timeout: 600_000 });
    return { status: 201, replayed: false, body };
  } catch (error) {
    const target = uniqueTarget(error);
    if (target || error instanceof FoodPayrollBatchError) {
      const replayed = await replayReconciliation(client, actor, batchId, key, hash);
      if (replayed) return replayed;
    }
    if (target && /one_active_per_batch|batchId/.test(target)) {
      await auditRejected(client, actor.id, batchId, key, hash, "RECONCILIATION_EXISTS");
      throw new FoodPayrollBatchError("RECONCILIATION_EXISTS", "El lote ya tiene una conciliación registrada.", 409);
    }
    if (error instanceof FoodPayrollBatchError) await auditRejected(client, actor.id, batchId, key, hash, error.code, error.details);
    throw error;
  }
}

// ------------------------------------------------------------------ anulación de una conciliación antes del cierre
export const voidReconciliationSchema = z.object({
  reconciliationId: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(10, "El motivo debe tener al menos 10 caracteres.").max(500),
}).strict();

export async function voidReconciliation(actor: AuthenticatedUser, batchId: string, raw: unknown, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "reconcile", client);
  const input = parse(voidReconciliationSchema, raw);
  return client.$transaction(async tx => {
    await requireCap(actor, "reconcile", tx);
    await lockBatch(tx, batchId);
    const batch = await loadBatch(tx, batchId);
    if (batch.status !== "PARTIALLY_RECONCILED") {
      throw batch.status === "RECONCILED" ? batchStateError(batch.status)
        : new FoodPayrollBatchError("RECONCILIATION_REQUIRED", "El lote no tiene una conciliación abierta.", 409);
    }
    const [recon] = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "FoodPayrollReconciliation" WHERE "batchId" = ${batchId} AND "voidedAt" IS NULL FOR UPDATE`;
    if (!recon || recon.id !== input.reconciliationId) throw new FoodPayrollBatchError("PREVIEW_STALE", "La conciliación del lote cambió. Actualiza la vista.", 409);
    const resolved = await tx.foodPayrollAdjustment.count({ where: { reconciliationId: recon.id, status: "APPLIED" } });
    if (resolved) throw new FoodPayrollBatchError("RECONCILIATION_HAS_RESOLUTIONS", "La conciliación tiene ajustes resueltos; no puede anularse.", 409);
    const now = new Date();
    await tx.foodPayrollReconciliation.update({ where: { id: recon.id }, data: { voidedAt: now, voidedById: actor.id, voidReason: input.reason } });
    const voided = await tx.foodPayrollAdjustment.updateMany({ where: { reconciliationId: recon.id, status: "PENDING" },
      data: { status: "VOIDED", voidedAt: now, voidedById: actor.id, voidReason: `Conciliación anulada: ${input.reason}`.slice(0, 500) } });
    await tx.foodPayrollBatch.update({ where: { id: batchId }, data: { status: "EXPORTED" } });
    await audit(tx, { eventType: "RECONCILIATION_VOIDED", batchId, actorId: actor.id, orderCount: 0,
      detail: { reconciliationId: recon.id, reason: input.reason, adjustmentsVoided: voided.count } });
    return { batchId, status: "EXPORTED" as const, reconciliationId: recon.id, voidedAt: now.toISOString(), adjustmentsVoided: voided.count };
  }, { maxWait: 10_000, timeout: 120_000 });
}

// ------------------------------------------------------------------ cobertura y cierre definitivo
type CoverageInput = { employees: Array<{ id: string; employeeId: string; result: string }>; adjustments: Array<{ reconciliationEmployeeId: string; status: string; resolutionType: string | null }> };
/** Mismo criterio que food_payroll_employee_covered (PostgreSQL). */
export function coveredEmployees({ employees, adjustments }: CoverageInput) {
  const blocking = new Set(adjustments.filter(a => a.status === "PENDING" || (a.status === "APPLIED" && a.resolutionType === "WAIVED")).map(a => a.reconciliationEmployeeId));
  return new Set(employees.filter(e => e.result === "COMPLETE" || e.result === "OVER_APPLIED" || !blocking.has(e.id)).map(e => e.employeeId));
}

export const closeBatchSchema = z.object({
  reconciliationId: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500).optional(),
}).strict();

async function updateOrders(tx: Prisma.TransactionClient, ids: string[], from: Array<"PENDING" | "EXPORTED">, to: "PROCESSED" | "EXPORTED") {
  let count = 0;
  for (const part of chunks(ids)) {
    count += (await tx.foodOrder.updateMany({ where: { id: { in: part }, status: "CONFIRMED", payrollStatus: { in: from } }, data: { payrollStatus: to } })).count;
  }
  return count;
}

export async function closeFoodPayrollBatch(actor: AuthenticatedUser, batchId: string, raw: unknown, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "close", client);
  const input = parse(closeBatchSchema, raw ?? {});
  return client.$transaction(async tx => {
    await requireCap(actor, "close", tx);
    const items = await tx.foodPayrollBatchItem.findMany({ where: { batchId }, select: { orderId: true, employeeId: true } });
    await lockFoodOrders(tx, items.map(i => i.orderId));
    await lockBatch(tx, batchId);
    const batch = await loadBatch(tx, batchId);
    if (batch.status !== "PARTIALLY_RECONCILED") {
      throw batch.status === "RECONCILED" || batch.status === "VOIDED" ? batchStateError(batch.status)
        : new FoodPayrollBatchError("RECONCILIATION_REQUIRED", "El cierre exige una conciliación válida registrada.", 409);
    }
    const [recon] = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "FoodPayrollReconciliation" WHERE "batchId" = ${batchId} AND "voidedAt" IS NULL FOR UPDATE`;
    if (!recon || recon.id !== input.reconciliationId) throw new FoodPayrollBatchError("PREVIEW_STALE", "La conciliación del lote cambió. Actualiza la vista antes de cerrar.", 409);
    const r = await tx.foodPayrollReconciliation.findUniqueOrThrow({ where: { id: recon.id }, select: {
      employeeCount: true, completeCount: true, partialCount: true, notAppliedCount: true, overCount: true } });
    const employees = await tx.foodPayrollReconciliationEmployee.findMany({ where: { reconciliationId: recon.id }, select: { id: true, employeeId: true, result: true } });
    const batchEmployees = new Set(items.map(i => i.employeeId));
    if (employees.length !== batch.employeeCount || employees.some(e => !batchEmployees.has(e.employeeId)) || batchEmployees.size !== employees.length) {
      throw new FoodPayrollBatchError("CLOSE_INCOMPLETE", "La conciliación no cubre a todos los colaboradores del lote; no se cierra con información faltante.", 409);
    }
    const adjustments = await tx.foodPayrollAdjustment.findMany({ where: { reconciliationId: recon.id },
      select: { reconciliationEmployeeId: true, status: true, resolutionType: true, balanceAmount: true } });
    const covered = coveredEmployees({ employees, adjustments });
    const now = new Date();
    await tx.foodPayrollReconciliation.update({ where: { id: recon.id }, data: {
      status: r.completeCount === r.employeeCount ? "RECONCILED" : "PARTIALLY_RECONCILED", closedAt: now } });
    await tx.foodPayrollBatch.update({ where: { id: batchId }, data: { status: "RECONCILED", closedAt: now, closedById: actor.id, closeNote: input.note || null } });
    const processedIds = items.filter(i => covered.has(i.employeeId)).map(i => i.orderId);
    const exportedIds = items.filter(i => !covered.has(i.employeeId)).map(i => i.orderId);
    const processed = await updateOrders(tx, processedIds, ["PENDING"], "PROCESSED");
    const exported = await updateOrders(tx, exportedIds, ["PENDING"], "EXPORTED");
    if (processed !== processedIds.length || exported !== exportedIds.length) {
      throw new FoodPayrollBatchError("ORDER_STATE_MISMATCH", "El estado de nómina de los pedidos no corresponde al lote.", 409);
    }
    await deps.onStage?.("orders-updated");
    const pending = adjustments.filter(a => a.status === "PENDING");
    const pendingRecovery = pending.reduce((s, a) => s + Math.max(0, signedCents(a.balanceAmount)), 0);
    const pendingRefund = pending.reduce((s, a) => s + Math.max(0, -signedCents(a.balanceAmount)), 0);
    const summary = {
      batchId, status: "RECONCILED" as const, reconciliationId: recon.id, closedAt: now.toISOString(), closedBy: actor.name,
      coveredEmployees: covered.size, uncoveredEmployees: employees.length - covered.size, processedOrders: processed, exportedOrders: exported,
      pendingAdjustments: pending.length, pendingRecovery: dec(pendingRecovery), pendingRefund: dec(pendingRefund),
      notice: pending.length ? "Lote cerrado administrativamente. Las diferencias siguen vigentes como ajustes pendientes." : "Lote cerrado sin diferencias pendientes.",
    };
    await audit(tx, { eventType: "BATCH_RECONCILED", batchId, actorId: actor.id, orderCount: items.length, detail: { ...summary, note: input.note ?? null } });
    return summary;
  }, { maxWait: 10_000, timeout: 600_000 });
}

// ------------------------------------------------------------------ resolución de ajustes
export async function resolveFoodPayrollAdjustment(actor: AuthenticatedUser, adjustmentId: string, raw: unknown, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "adjust", client);
  const input = parse(resolveAdjustmentSchema, raw);
  const amountCents = toCents(input.amount);
  if (amountCents === null) throw new FoodPayrollBatchError("INVALID_REQUEST", "Importe inválido.", 400);
  const pre = await client.foodPayrollAdjustment.findUnique({ where: { id: adjustmentId }, select: { batchId: true, employeeId: true } });
  if (!pre) throw new FoodPayrollBatchError("ADJUSTMENT_NOT_FOUND", "Ajuste no encontrado.", 404);
  return client.$transaction(async tx => {
    await requireCap(actor, "adjust", tx);
    const orderIds = (await tx.foodPayrollBatchItem.findMany({ where: { batchId: pre.batchId, employeeId: pre.employeeId }, select: { orderId: true } })).map(i => i.orderId);
    await lockFoodOrders(tx, orderIds);
    await lockBatch(tx, pre.batchId);
    await tx.$queryRaw`SELECT "id" FROM "FoodPayrollAdjustment" WHERE "id" = ${adjustmentId} FOR UPDATE`;
    const adj = await tx.foodPayrollAdjustment.findUniqueOrThrow({ where: { id: adjustmentId }, include: {
      reconciliation: { select: { id: true, voidedAt: true } }, batch: { select: { status: true, payrollReference: true } } } });
    if (adj.status !== "PENDING") throw new FoodPayrollBatchError("ADJUSTMENT_ALREADY_RESOLVED", "El ajuste ya fue resuelto o anulado.", 409);
    if (adj.reconciliation.voidedAt || !["PARTIALLY_RECONCILED", "RECONCILED"].includes(adj.batch.status)) {
      throw new FoodPayrollBatchError("ADJUSTMENT_NOT_RESOLVABLE", "El ajuste no puede resolverse en el estado actual del lote.", 409);
    }
    const balance = signedCents(adj.balanceAmount);
    const remainder = await contract(() => validateResolution(adj.kind, balance, input.resolutionType, amountCents, input.reference));
    const now = new Date();
    await tx.foodPayrollAdjustment.update({ where: { id: adj.id }, data: {
      status: "APPLIED", resolutionType: input.resolutionType, resolvedAmount: dec(amountCents), resolutionReference: input.reference || null,
      resolutionNote: input.note, resolvedById: actor.id, appliedAt: now } });
    let successorId: string | null = null;
    if (remainder > 0) {
      successorId = randomUUID();
      const sign = balance > 0 ? 1 : -1;
      await tx.foodPayrollAdjustment.create({ data: {
        id: successorId, batchId: adj.batchId, reconciliationId: adj.reconciliationId, reconciliationEmployeeId: adj.reconciliationEmployeeId,
        employeeId: adj.employeeId, employeeNumber: adj.employeeNumber, employeeName: adj.employeeName, kind: adj.kind, status: "PENDING",
        originalAmount: adj.originalAmount, adjustedAmount: adj.adjustedAmount, differenceAmount: adj.differenceAmount, balanceAmount: dec(sign * remainder),
        parentAdjustmentId: adj.id, actorId: actor.id, createdAt: now,
        reason: `Saldo remanente ${dec(remainder)} tras resolución parcial (${input.resolutionType} ${dec(amountCents)}, ref. ${input.reference ?? "—"}) del ajuste ${adj.id.slice(0, 8)}.`.slice(0, 1000),
      } });
    }
    await deps.onStage?.("adjustment-resolved");
    let processedOrders = 0;
    if (adj.batch.status === "RECONCILED") {
      const [row] = await tx.$queryRaw<Array<{ covered: boolean }>>`SELECT "food_payroll_employee_covered"(${adj.batchId}, ${adj.employeeId}) AS covered`;
      if (row?.covered) processedOrders = await updateOrders(tx, orderIds, ["EXPORTED"], "PROCESSED");
    }
    await audit(tx, { eventType: "ADJUSTMENT_RESOLVED", batchId: adj.batchId, actorId: actor.id, orderCount: processedOrders, reasonCode: input.resolutionType,
      detail: { adjustmentId: adj.id, employeeNumber: adj.employeeNumber, resolvedAmount: dec(amountCents), remainder: dec(remainder), successorId,
        reference: input.reference ?? null, note: input.note } });
    return { adjustmentId: adj.id, status: "APPLIED" as const, resolutionType: input.resolutionType, resolvedAmount: dec(amountCents),
      remainder: dec(remainder), successorId, processedOrders, resolvedAt: now.toISOString() };
  }, { maxWait: 10_000, timeout: 120_000 });
}

// ------------------------------------------------------------------ consultas (paginadas)
export const reconciliationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  result: z.enum(["ALL", "DIFFERENCES", "COMPLETE", "PARTIAL", "NOT_APPLIED", "OVER_APPLIED"]).default("ALL"),
  q: z.string().trim().max(120).optional(),
});

async function orderStatusCounts(client: Db, batchId: string) {
  const rows = await client.$queryRaw<Array<{ payrollStatus: string; n: number }>>`
    SELECT o."payrollStatus"::text AS "payrollStatus", count(*)::int AS n FROM "FoodPayrollBatchItem" i JOIN "FoodOrder" o ON o."id" = i."orderId"
    WHERE i."batchId" = ${batchId} GROUP BY 1`;
  return Object.fromEntries(rows.map(r => [r.payrollStatus, Number(r.n)])) as Record<string, number>;
}

export async function getFoodPayrollReconciliation(actor: AuthenticatedUser, batchId: string, raw: unknown, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "reconView", client);
  const q = parse(reconciliationQuerySchema, raw ?? {});
  const batch = await loadBatch(client, batchId);
  const history = await client.foodPayrollReconciliation.findMany({ where: { batchId }, orderBy: { reconciledAt: "desc" }, select: {
    id: true, status: true, fileName: true, evidenceSha256: true, externalReference: true, reconciledAt: true, closedAt: true, voidedAt: true, voidReason: true,
    expectedAmount: true, receivedAmount: true, reconciledAmount: true, unreconciledAmount: true, pendingRefundAmount: true,
    employeeCount: true, completeCount: true, partialCount: true, notAppliedCount: true, overCount: true,
    actor: { select: { name: true } }, voidedBy: { select: { name: true } } } });
  const active = history.find(h => !h.voidedAt) ?? null;
  const orderStatus = await orderStatusCounts(client, batchId);
  if (!active) {
    return { batch: batchView(batch), reconciliation: null, history: history.map(historyView), orderStatus, employees: [], total: 0, page: 1, pages: 1, pageSize: RECONCILIATION_PAGE_SIZE, kpis: null };
  }
  const where: Prisma.FoodPayrollReconciliationEmployeeWhereInput = {
    reconciliationId: active.id,
    ...(q.result === "DIFFERENCES" ? { result: { not: "COMPLETE" } } : q.result !== "ALL" ? { result: q.result } : {}),
    ...(q.q ? { OR: [{ employeeNumber: { contains: q.q, mode: "insensitive" } }, { employeeName: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const total = await client.foodPayrollReconciliationEmployee.count({ where });
  const pages = Math.max(1, Math.ceil(total / RECONCILIATION_PAGE_SIZE));
  const page = Math.min(q.page, pages);
  const rows = await client.foodPayrollReconciliationEmployee.findMany({ where, orderBy: [{ employeeNumber: "asc" }, { id: "asc" }],
    take: RECONCILIATION_PAGE_SIZE, skip: (page - 1) * RECONCILIATION_PAGE_SIZE,
    select: { id: true, employeeId: true, employeeNumber: true, employeeName: true, orderCount: true, expectedAmount: true, appliedAmount: true,
      differenceAmount: true, result: true, sourceRow: true, note: true } });
  const adjustments = await client.foodPayrollAdjustment.findMany({ where: { reconciliationId: active.id },
    select: { id: true, reconciliationEmployeeId: true, status: true, resolutionType: true, balanceAmount: true } });
  const allEmployees = await client.foodPayrollReconciliationEmployee.findMany({ where: { reconciliationId: active.id }, select: { id: true, employeeId: true, result: true } });
  const covered = coveredEmployees({ employees: allEmployees, adjustments });
  const pendingByEmployee = new Map<string, number>();
  const pendingByEmployeeAdj = new Map<string, string>();
  for (const a of adjustments) if (a.status === "PENDING") {
    pendingByEmployee.set(a.reconciliationEmployeeId, (pendingByEmployee.get(a.reconciliationEmployeeId) ?? 0) + signedCents(a.balanceAmount));
    pendingByEmployeeAdj.set(a.reconciliationEmployeeId, a.id);
  }
  const pending = adjustments.filter(a => a.status === "PENDING");
  const recovery = pending.reduce((s, a) => s + Math.max(0, signedCents(a.balanceAmount)), 0);
  const refund = pending.reduce((s, a) => s + Math.max(0, -signedCents(a.balanceAmount)), 0);
  return {
    batch: batchView(batch), reconciliation: historyView(active), history: history.map(historyView), orderStatus,
    kpis: { expected: dec(cents(active.expectedAmount)), applied: dec(cents(active.receivedAmount)), pendingRecovery: dec(recovery), pendingRefund: dec(refund),
      employees: active.employeeCount, reconciledEmployees: active.completeCount, employeesWithDifferences: active.employeeCount - active.completeCount,
      coveredEmployees: covered.size, pendingAdjustments: pending.length, resolvedAdjustments: adjustments.filter(a => a.status === "APPLIED").length },
    filters: q, total, page, pages, pageSize: RECONCILIATION_PAGE_SIZE,
    employees: rows.map(r => ({ id: r.id, employeeNumber: r.employeeNumber, employeeName: r.employeeName, orderCount: r.orderCount,
      expected: dec(cents(r.expectedAmount)), applied: dec(cents(r.appliedAmount)), difference: dec(signedCents(r.differenceAmount)), result: r.result,
      sourceRow: r.sourceRow, note: r.note, covered: covered.has(r.employeeId), pendingBalance: dec(pendingByEmployee.get(r.id) ?? 0),
      pendingAdjustmentId: pendingByEmployeeAdj.get(r.id) ?? null })),
  };
}

type HistoryRow = {
  id: string; status: string; fileName: string; evidenceSha256: string; externalReference: string | null; reconciledAt: Date; closedAt: Date | null;
  voidedAt: Date | null; voidReason: string | null; expectedAmount: unknown; receivedAmount: unknown; reconciledAmount: unknown; unreconciledAmount: unknown;
  pendingRefundAmount: unknown; employeeCount: number; completeCount: number; partialCount: number; notAppliedCount: number; overCount: number;
  actor: { name: string }; voidedBy: { name: string } | null;
};
function historyView(h: HistoryRow) {
  return { id: h.id, status: h.status, fileName: h.fileName, evidenceSha256: h.evidenceSha256, externalReference: h.externalReference,
    reconciledAt: h.reconciledAt, closedAt: h.closedAt, voidedAt: h.voidedAt, voidReason: h.voidReason, actor: h.actor.name, voidedBy: h.voidedBy?.name ?? null,
    expected: dec(cents(h.expectedAmount)), applied: dec(cents(h.receivedAmount)), covered: dec(cents(h.reconciledAmount)),
    pendingRecovery: dec(cents(h.unreconciledAmount)), pendingRefund: dec(cents(h.pendingRefundAmount)),
    employeeCount: h.employeeCount, completeCount: h.completeCount, partialCount: h.partialCount, notAppliedCount: h.notAppliedCount, overCount: h.overCount };
}

export const adjustmentsQuerySchema = z.object({
  status: z.enum(["PENDING", "APPLIED", "VOIDED", "ALL"]).default("PENDING"),
  kind: z.enum(["NOT_APPLIED", "PARTIAL", "OVER_APPLIED"]).optional(),
  batchId: z.string().trim().max(100).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listFoodPayrollAdjustments(actor: AuthenticatedUser, raw: unknown, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "reconView", client);
  const q = parse(adjustmentsQuerySchema, raw ?? {});
  const where: Prisma.FoodPayrollAdjustmentWhereInput = {
    ...(q.status !== "ALL" ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(q.batchId ? { batchId: q.batchId } : {}),
    ...(q.q ? { OR: [{ employeeNumber: { contains: q.q, mode: "insensitive" } }, { employeeName: { contains: q.q, mode: "insensitive" } },
      { batch: { payrollReference: { contains: q.q, mode: "insensitive" } } }] } : {}),
  };
  const total = await client.foodPayrollAdjustment.count({ where });
  const pages = Math.max(1, Math.ceil(total / RECONCILIATION_PAGE_SIZE));
  const page = Math.min(q.page, pages);
  const rows = await client.foodPayrollAdjustment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: RECONCILIATION_PAGE_SIZE, skip: (page - 1) * RECONCILIATION_PAGE_SIZE, include: {
      batch: { select: { id: true, payrollReference: true, status: true } }, actor: { select: { name: true } }, resolvedBy: { select: { name: true } } } });
  const pendingAll = await client.foodPayrollAdjustment.findMany({ where: { status: "PENDING" }, select: { balanceAmount: true } });
  return {
    filters: q, total, page, pages, pageSize: RECONCILIATION_PAGE_SIZE,
    pendingTotals: { count: pendingAll.length, recovery: dec(pendingAll.reduce((s, a) => s + Math.max(0, signedCents(a.balanceAmount)), 0)),
      refund: dec(pendingAll.reduce((s, a) => s + Math.max(0, -signedCents(a.balanceAmount)), 0)) },
    adjustments: rows.map(a => ({ id: a.id, batch: a.batch, employeeNumber: a.employeeNumber, employeeName: a.employeeName, kind: a.kind, status: a.status,
      original: dec(cents(a.originalAmount)), applied: dec(cents(a.adjustedAmount)), difference: dec(signedCents(a.differenceAmount)),
      balance: dec(signedCents(a.balanceAmount)), reason: a.reason, parentAdjustmentId: a.parentAdjustmentId, createdAt: a.createdAt, actor: a.actor.name,
      resolutionType: a.resolutionType, resolvedAmount: a.resolvedAmount === null ? null : dec(cents(a.resolvedAmount)), resolutionReference: a.resolutionReference,
      resolutionNote: a.resolutionNote, resolvedAt: a.appliedAt, resolvedBy: a.resolvedBy?.name ?? null, voidedAt: a.voidedAt, voidReason: a.voidReason })),
  };
}

/** Evidencia original de lo aplicado por Nómina (mismos bytes y SHA-256 registrados). */
export async function downloadReconciliationEvidence(actor: AuthenticatedUser, batchId: string, reconciliationId: string, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "reconView", client);
  const r = await client.foodPayrollReconciliation.findFirst({ where: { id: reconciliationId, batchId }, select: { fileName: true, evidenceSha256: true, evidenceContent: true } });
  if (!r) throw new FoodPayrollBatchError("RECONCILIATION_NOT_FOUND", "Conciliación no encontrada.", 404);
  const body = Buffer.from(r.evidenceContent);
  if (sha256Hex(body) !== r.evidenceSha256) throw new FoodPayrollBatchError("EVIDENCE_INTEGRITY", "La evidencia registrada no coincide con su SHA-256.", 500);
  return { fileName: r.fileName, fileSha256: r.evidenceSha256, body, contentType: XLSX };
}

// ------------------------------------------------------------------ reportes de control (sin efectos financieros)
export async function exportFoodPayrollControlReport(actor: AuthenticatedUser, batchId: string, typeRaw: unknown, deps: ReconciliationDeps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCap(actor, "control", client);
  const type = parse(z.enum(CONTROL_REPORT_TYPES), typeRaw) as ControlReportType;
  const data = await client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const batch = await loadBatch(tx, batchId);
    const recon = await tx.foodPayrollReconciliation.findFirst({ where: { batchId, voidedAt: null }, include: { actor: { select: { name: true } } } });
    if (!recon) throw new FoodPayrollBatchError("RECONCILIATION_REQUIRED", "El lote no tiene una conciliación vigente.", 409);
    const employees = await tx.foodPayrollReconciliationEmployee.findMany({ where: { reconciliationId: recon.id }, orderBy: [{ employeeNumber: "asc" }] });
    const adjustments = await tx.foodPayrollAdjustment.findMany({ where: { batchId }, orderBy: [{ employeeNumber: "asc" }, { createdAt: "asc" }],
      include: { actor: { select: { name: true } }, resolvedBy: { select: { name: true } } } });
    return { batch, recon, employees, adjustments, orderStatus: await orderStatusCounts(tx, batchId) };
  });
  const active = data.adjustments.filter(a => a.reconciliationId === data.recon.id);
  const covered = coveredEmployees({ employees: data.employees, adjustments: active });
  const pendingBy = new Map<string, number>();
  for (const a of active) if (a.status === "PENDING") pendingBy.set(a.reconciliationEmployeeId, (pendingBy.get(a.reconciliationEmployeeId) ?? 0) + signedCents(a.balanceAmount));
  const employees: ReportEmployee[] = data.employees.map(e => ({ employeeNumber: e.employeeNumber, employeeName: e.employeeName, orderCount: e.orderCount,
    expectedCents: cents(e.expectedAmount), appliedCents: cents(e.appliedAmount), differenceCents: signedCents(e.differenceAmount), result: e.result,
    sourceRow: e.sourceRow, note: e.note, covered: covered.has(e.employeeId), pendingBalanceCents: pendingBy.get(e.id) ?? 0 }));
  const adjustments: ReportAdjustment[] = data.adjustments.map(a => ({ id: a.id, employeeNumber: a.employeeNumber, employeeName: a.employeeName, kind: a.kind,
    status: a.status, originalCents: cents(a.originalAmount), appliedCents: cents(a.adjustedAmount), differenceCents: signedCents(a.differenceAmount),
    balanceCents: signedCents(a.balanceAmount), reason: a.reason, actor: a.actor.name, createdAt: a.createdAt, parentId: a.parentAdjustmentId,
    resolutionType: a.resolutionType, resolvedCents: a.resolvedAmount === null ? null : cents(a.resolvedAmount), resolutionReference: a.resolutionReference,
    resolutionNote: a.resolutionNote, resolvedBy: a.resolvedBy?.name ?? null, resolvedAt: a.appliedAt, voidedAt: a.voidedAt, voidReason: a.voidReason }));
  const at = new Date();
  const r = data.recon;
  const body = await buildControlReport(type, {
    batch: { id: data.batch.id, payrollReference: data.batch.payrollReference, status: data.batch.status, orderCount: data.batch.orderCount,
      employeeCount: data.batch.employeeCount, committedCents: cents(data.batch.committedAmount), exportedAt: data.batch.exportedAt, fileSha256: data.batch.fileSha256,
      closedAt: data.batch.closedAt, closedBy: data.batch.closedBy?.name ?? null, closeNote: data.batch.closeNote },
    reconciliation: { id: r.id, status: r.status, fileName: r.fileName, evidenceSha256: r.evidenceSha256, externalReference: r.externalReference, actor: r.actor.name,
      reconciledAt: r.reconciledAt, expectedCents: cents(r.expectedAmount), appliedCents: cents(r.receivedAmount), coveredCents: cents(r.reconciledAmount),
      pendingRecoveryCents: cents(r.unreconciledAmount), pendingRefundCents: cents(r.pendingRefundAmount), employeeCount: r.employeeCount,
      completeCount: r.completeCount, partialCount: r.partialCount, notAppliedCount: r.notAppliedCount, overCount: r.overCount, closedAt: r.closedAt },
    employees, adjustments, orderStatus: data.orderStatus, generatedAt: at, generatedBy: actor.name,
  });
  const fileSha256 = sha256Hex(body);
  const fileName = controlFileName(type, data.batch.payrollReference, data.batch.id, at);
  await audit(client, { eventType: "CONTROL_EXPORTED", batchId, actorId: actor.id, reasonCode: `CONTROL_${type.toUpperCase()}`.slice(0, 80),
    detail: { type, fileName, fileSha256, bytes: body.length } });
  return { fileName, fileSha256, body, contentType: XLSX };
}
