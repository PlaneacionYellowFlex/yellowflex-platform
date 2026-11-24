import "server-only";

/**
 * YF-002 Bloque C (parte 1) — prenómina MASIVA por periodo.
 * Toma TODOS los pedidos confirmados de las semanas de servicio del periodo, sin límite de cantidad ni paginación
 * silenciosa: la vista previa resume colaboradores únicos, pedidos, servicios e importe y solo enumera las excepciones.
 * La generación vuelve a leer el periodo dentro de la transacción con bloqueo ordenado de FoodOrder y exige el mismo
 * digest de la vista previa: cualquier pedido nuevo, cambiado o cancelado obliga a recalcular (PREVIEW_STALE).
 * Reutiliza autorización, elegibilidad, persistencia, idempotencia y auditoría del motor del Bloque A.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { db as defaultDb } from "@/lib/db";
import {
  FOOD_PAYROLL_CONTRACT_VERSION, FOOD_PAYROLL_PREVIEW_TTL_MS, centsToDecimal, idempotencyKeySchema, normalizeOrderIds,
  periodCreateSchema, periodPreviewSchema, periodRequestHash, selectionDigest, signPreviewToken, toCents, tokenFingerprint,
  verifyPreviewToken,
} from "@/lib/food-services/payroll-batch-contract";
import {
  FoodPayrollBatchError, auditRejected, classify, contract, describe, grantsOk, loadCandidates, parse, persistGeneratedBatch,
  replayOrConflict, totals, uniqueTarget, type Classified, type CreateFoodPayrollBatchResult,
} from "@/lib/food-services/payroll-batch-service";

type Db = PrismaClient | Prisma.TransactionClient;
type Deps = { db?: PrismaClient };

/** Motivos de exclusión que corresponden a pedidos ya procesados (no requieren atención individual). */
const ROUTINE = new Set(["ACTIVE_ASSIGNMENT_EXISTS", "PAYROLL_STATUS_NOT_PENDING"]);
const day = (d: Date) => d.toISOString().slice(0, 10);

async function requireCreate(actor: AuthenticatedUser, client: Db) {
  if (!actor.roles.includes("RH") || !(await grantsOk(client, actor.id))) throw new CorporateAuthorizationRequired("Acceso restringido");
}

/** Ids de TODOS los pedidos confirmados del periodo (semana de servicio dentro del rango), ordenados; sin límite. */
async function periodOrderIds(client: Db, from: string, to: string, lock: boolean) {
  const rows = lock
    ? await client.$queryRaw<Array<{ id: string }>>`
        SELECT o."id" FROM "FoodOrder" o JOIN "MenuWeek" w ON w."id" = o."menuWeekId"
        WHERE w."weekStart" BETWEEN ${from}::date AND ${to}::date AND o."status" = 'CONFIRMED'::"FoodOrderStatus"
        ORDER BY o."id" FOR UPDATE OF o`
    : await client.$queryRaw<Array<{ id: string }>>`
        SELECT o."id" FROM "FoodOrder" o JOIN "MenuWeek" w ON w."id" = o."menuWeekId"
        WHERE w."weekStart" BETWEEN ${from}::date AND ${to}::date AND o."status" = 'CONFIRMED'::"FoodOrderStatus"
        ORDER BY o."id"`;
  return rows.map(r => r.id);
}

async function classifyPeriod(client: Db, from: string, to: string, reference: string, lock: boolean) {
  const ids = await periodOrderIds(client, from, to, lock);
  const map = await loadCandidates(client, ids);
  const all = ids.map(id => classify(map.get(id) ?? null, id, reference));
  const eligible = all.filter(c => c.cls === "E");
  const review = all.filter(c => c.cls === "R");
  const excluded = all.filter(c => c.cls === "X");
  const digest = selectionDigest([...eligible, ...review].map(c => [c.orderId, tokenFingerprint(c.fingerprint!)] as const));
  return { ids, all, eligible, review, excluded, digest };
}

function byEmployee(list: Classified[]) {
  const map = new Map<string, { employeeNumber: string; employeeName: string; employeeStatus: string; orders: number; services: number; cents: number; weeks: Set<string> }>();
  for (const c of list) {
    const o = c.order!; const e = o.employee!;
    const row = map.get(e.employeeNumber) ?? { employeeNumber: e.employeeNumber, employeeName: e.fullName, employeeStatus: e.status, orders: 0, services: 0, cents: 0, weeks: new Set<string>() };
    row.orders += 1; row.services += o.itemCount; row.cents += toCents(o.totalAmount) ?? 0; row.weeks.add(day(o.menuWeek!.weekStart));
    map.set(e.employeeNumber, row);
  }
  return [...map.values()].sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, "es"))
    .map(r => ({ employeeNumber: r.employeeNumber, employeeName: r.employeeName, employeeStatus: r.employeeStatus, orders: r.orders,
      services: r.services, amount: centsToDecimal(r.cents), serviceWeeks: [...r.weeks].sort() }));
}

// ------------------------------------------------------------------ vista previa masiva (solo lectura)
export async function previewFoodPayrollPeriod(actor: AuthenticatedUser, raw: unknown, deps: Deps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCreate(actor, client);
  const input = parse(periodPreviewSchema, raw);
  const started = Date.now();
  const r = await client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return classifyPeriod(tx, input.weekFrom, input.weekTo, input.payrollReference, false);
  }, { maxWait: 10_000, timeout: 600_000 });
  const reasonCounts: Record<string, number> = {};
  for (const c of r.excluded) for (const reason of c.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  const attention = r.excluded.filter(c => c.reasons.some(x => !ROUTINE.has(x)));
  const issuedAt = Date.now(); const expiresAt = issuedAt + FOOD_PAYROLL_PREVIEW_TTL_MS;
  const previewToken = contract(() => signPreviewToken({
    v: FOOD_PAYROLL_CONTRACT_VERSION, a: actor.id, r: input.payrollReference, iat: issuedAt, exp: expiresAt, d: r.digest, e: [],
    m: "P", p: { from: input.weekFrom, to: input.weekTo }, n: { eligible: r.eligible.length, review: r.review.length }, rv: r.review.map(c => c.orderId),
  }));
  const eligibleTotals = totals(r.eligible);
  return {
    mode: "PERIOD", contractVersion: FOOD_PAYROLL_CONTRACT_VERSION, payrollReference: input.payrollReference,
    period: { weekFrom: input.weekFrom, weekTo: input.weekTo }, actor: { id: actor.id, name: actor.name },
    issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), previewDigest: r.digest, previewToken,
    confirmedOrdersInPeriod: r.ids.length,
    totals: { eligible: eligibleTotals, requiresReview: totals(r.review) },
    serviceWeeks: [...new Set([...r.eligible, ...r.review].map(c => day(c.order!.menuWeek!.weekStart)))].sort(),
    employees: byEmployee(r.eligible),
    requiresReview: r.review.map(describe),
    excludedSummary: reasonCounts,
    excludedRoutine: r.excluded.length - attention.length,
    excludedAttention: attention.map(describe),
    elapsedMs: Date.now() - started,
    notice: "Incluye todos los pedidos confirmados del periodo; solo se enumeran las excepciones. La generación revalida el periodo completo.",
  };
}

// ------------------------------------------------------------------ generación masiva transaccional e idempotente
export async function createFoodPayrollPeriodBatch(
  actor: AuthenticatedUser, raw: unknown, idempotencyKeyRaw: unknown, deps: Deps = {},
): Promise<CreateFoodPayrollBatchResult> {
  const client = deps.db ?? defaultDb;
  const key = parse(idempotencyKeySchema, idempotencyKeyRaw);
  const input = parse(periodCreateSchema, raw);
  const reviewed = contract(() => normalizeOrderIds(input.reviewedInactiveOrderIds));
  const token = contract(() => verifyPreviewToken(input.previewToken));
  if (token.m !== "P" || !token.p || !token.n) throw new FoodPayrollBatchError("PREVIEW_INVALID", "El token no corresponde a una vista previa masiva.", 400);
  const hash = periodRequestHash({ actorId: actor.id, payrollReference: input.payrollReference, weekFrom: input.weekFrom, weekTo: input.weekTo,
    reviewedInactiveOrderIds: reviewed, selectionDigest: token.d });
  const expected = token.n.eligible + reviewed.length;

  await requireCreate(actor, client);
  const replay = await replayOrConflict(client, actor, key, hash, expected);
  if (replay) return replay;
  const reject = async (code: string, message: string, details?: unknown, status = 409): Promise<never> => {
    await auditRejected(client, actor.id, key, hash, expected, code, details);
    throw new FoodPayrollBatchError(code, message, status, details);
  };
  if (token.a !== actor.id) await reject("PREVIEW_ACTOR_MISMATCH", "La vista previa pertenece a otro usuario.", undefined, 403);
  if (token.expired) await reject("PREVIEW_EXPIRED", "La vista previa expiró. Calcula nuevamente la prenómina del periodo.");
  if (token.r !== input.payrollReference || token.p.from !== input.weekFrom || token.p.to !== input.weekTo) {
    await reject("PREVIEW_MISMATCH", "Referencia o periodo distintos a los de la vista previa.");
  }
  const reviewSet = new Set(token.rv ?? []);
  const notReviewable = reviewed.filter(id => !reviewSet.has(id));
  if (notReviewable.length) await reject("PREVIEW_MISMATCH", "Un pedido revisado no figura como excepción en la vista previa.", { orderIds: notReviewable });
  if (token.n.eligible + reviewed.length === 0) await reject("NOTHING_TO_GENERATE", "No hay pedidos elegibles en el periodo.");

  try {
    const body = await client.$transaction(async tx => {
      if (!(await grantsOk(tx, actor.id))) throw new CorporateAuthorizationRequired("Acceso restringido");
      // Bloqueo ordenado de TODOS los pedidos confirmados del periodo (mismo orden que cancelación y anulación).
      const r = await classifyPeriod(tx, input.weekFrom, input.weekTo, input.payrollReference, true);
      if (r.digest !== token.d || r.eligible.length !== token.n!.eligible || r.review.length !== token.n!.review) {
        throw new FoodPayrollBatchError("PREVIEW_STALE", "Los pedidos del periodo cambiaron después de la vista previa. Calcula nuevamente.", 409, {
          previewEligible: token.n!.eligible, currentEligible: r.eligible.length, previewReview: token.n!.review, currentReview: r.review.length });
      }
      const included = [...r.eligible, ...r.review.filter(c => reviewed.includes(c.orderId))];
      return persistGeneratedBatch(tx, { actor, key, hash, payrollReference: input.payrollReference, digest: token.d, included, reviewed,
        response: { mode: "PERIOD", period: { weekFrom: input.weekFrom, weekTo: input.weekTo }, excludedInPeriod: r.excluded.length,
          reviewNotIncluded: r.review.length - (included.length - r.eligible.length), cutoffAt: new Date().toISOString() } });
    }, { maxWait: 10_000, timeout: 600_000 });
    return { status: 201, replayed: false, body };
  } catch (error) {
    const target = uniqueTarget(error);
    if (target || error instanceof FoodPayrollBatchError) {
      const replayed = await replayOrConflict(client, actor, key, hash, expected);
      if (replayed) return replayed;
    }
    if (target && /one_active_per_order|orderId/.test(target)) {
      await auditRejected(client, actor.id, key, hash, expected, "ACTIVE_ASSIGNMENT_EXISTS");
      throw new FoodPayrollBatchError("ACTIVE_ASSIGNMENT_EXISTS", "Uno o más pedidos ya están asignados a un lote activo.", 409);
    }
    if (error instanceof FoodPayrollBatchError) await auditRejected(client, actor.id, key, hash, expected, error.code, error.details);
    throw error;
  }
}
