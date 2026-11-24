import "server-only";

/**
 * YF-002 Bloque A — motor de prenómina Food Services.
 * - previewFoodPayrollBatch: solo lectura; elegibles, excluidos con motivos, excolaboradores que requieren
 *   revisión expresa de RH, totales y token firmado (actor, referencia, huellas, expiración).
 * - createFoodPayrollBatch: idempotente y transaccional. Bloqueo ordenado de FoodOrder (mismo mecanismo que
 *   la cancelación), revalidación de permisos y elegibilidad, snapshots, asignaciones, totales, respuesta
 *   persistida y auditoría. Cualquier error revierte todo.
 * No cambia FoodOrder.payrollStatus: incluir en un lote no es exportar ni aplicar el descuento.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { db as defaultDb } from "@/lib/db";
import { evaluateFoodPayrollEligibility, type PayrollEligibilityReason } from "@/lib/food-services/payroll-eligibility";
import {
  FOOD_PAYROLL_CONTRACT_VERSION, FOOD_PAYROLL_PREVIEW_TTL_MS, FoodPayrollContractError, centsToDecimal,
  createRequestSchema, idempotencyKeySchema, idempotencyRequestHash, normalizeOrderIds, orderFingerprint,
  previewRequestSchema, selectionDigest, signPreviewToken, toCents, tokenFingerprint, verifyPreviewToken,
  type PreviewClass,
} from "@/lib/food-services/payroll-batch-contract";
import { lockFoodOrders } from "@/lib/food-services/order-lock";
import { FoodServiceError } from "@/lib/food-services/service";

export const FOOD_PAYROLL_MODULE = "food-services" as const;
export const FOOD_PAYROLL_CREATE_ACTION = "create-payroll-batch" as const;

export class FoodPayrollBatchError extends FoodServiceError {
  constructor(readonly code: string, message: string, status = 409, readonly details?: unknown) {
    super(message, status);
    this.name = "FoodPayrollBatchError";
  }
}

type Db = PrismaClient | Prisma.TransactionClient;
type Deps = { db?: PrismaClient };

// ------------------------------------------------------------------ autorización (sin atajo ADMIN)
async function grantsOk(client: Db, userId: string) {
  const user = await client.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user?.active || user.passwordMustChange || !user.roles.some(r => r.role === "RH")) return false;
  const grants = await client.corporateModulePermission.findMany({
    where: { userId, moduleKey: FOOD_PAYROLL_MODULE, granted: true, actionKey: { in: ["view", "manage", FOOD_PAYROLL_CREATE_ACTION] } },
    select: { actionKey: true },
  });
  return new Set(grants.map(g => g.actionKey)).size === 3;
}

/** RH activo, sin contraseña temporal, con view + manage + create-payroll-batch explícitos en C-PANEL. */
export async function canCreateFoodPayrollBatch(user: AuthenticatedUser, deps: Deps = {}) {
  if (!user.roles.includes("RH")) return false;
  return grantsOk(deps.db ?? defaultDb, user.id);
}

async function requireCreateAccess(actor: AuthenticatedUser, deps: Deps) {
  if (!(await canCreateFoodPayrollBatch(actor, deps))) throw new CorporateAuthorizationRequired("Acceso restringido");
}

// ------------------------------------------------------------------ carga masiva de candidatos
export const candidateInclude = {
  employee: {
    select: {
      id: true, employeeNumber: true, fullName: true, status: true, departmentId: true, workShiftId: true,
      department: { select: { id: true, code: true, name: true } },
      workShift: { select: { id: true, code: true, name: true } },
    },
  },
  menuWeek: { select: { id: true, weekStart: true } },
  reservations: {
    orderBy: { id: "asc" as const },
    select: {
      id: true, foodOrderId: true, employeeId: true, status: true, menuItemId: true,
      menuItem: { select: { id: true, name: true, serviceType: true, menuDay: { select: { menuWeekId: true, serviceDate: true } } } },
    },
  },
  payrollAssignments: { where: { status: "ACTIVE" as const }, select: { status: true } },
};

export async function loadCandidates(client: Db, ids: readonly string[]) {
  const orders = await client.foodOrder.findMany({ where: { id: { in: [...ids] } }, include: candidateInclude });
  return new Map(orders.map(o => [o.id, o]));
}
export type Candidate = Awaited<ReturnType<typeof loadCandidates>> extends Map<string, infer T> ? T : never;

export type Classified = {
  orderId: string; cls: PreviewClass | "X"; reasons: PayrollEligibilityReason[]; fingerprint: string | null; order: Candidate | null;
};

export function classify(order: Candidate | null, orderId: string, payrollReference: string): Classified {
  const result = evaluateFoodPayrollEligibility(order, payrollReference);
  if (!order) return { orderId, cls: "X", reasons: ["ORDER_NOT_FOUND"], fingerprint: null, order: null };
  const fingerprint = orderFingerprint(order);
  if (result.eligible) return { orderId, cls: "E", reasons: [], fingerprint, order };
  // Excolaborador con obligación válida: no se excluye automáticamente; RH debe revisarlo expresamente.
  if (result.reasons.length === 1 && result.reasons[0] === "EMPLOYEE_INACTIVE") return { orderId, cls: "R", reasons: result.reasons, fingerprint, order };
  return { orderId, cls: "X", reasons: result.reasons, fingerprint, order };
}

export function describe(c: Classified) {
  const o = c.order;
  return {
    orderId: c.orderId,
    employeeId: o?.employeeId ?? null,
    employeeNumber: o?.employee?.employeeNumber ?? null,
    employeeName: o?.employee?.fullName ?? null,
    employeeStatus: o?.employee?.status ?? null,
    serviceWeekStart: o?.menuWeek ? o.menuWeek.weekStart.toISOString().slice(0, 10) : null,
    quantity: o?.itemCount ?? null,
    historicalUnitPrice: o ? centsToDecimal(toCents(o.unitPrice) ?? 0) : null,
    committedAmount: o ? centsToDecimal(toCents(o.totalAmount) ?? 0) : null,
    reasons: c.reasons,
  };
}

function totals(list: Classified[]) {
  const employees = new Set<string>(); let services = 0; let cents = 0;
  for (const c of list) { if (!c.order) continue; employees.add(c.order.employeeId); services += c.order.itemCount; cents += toCents(c.order.totalAmount) ?? 0; }
  return { orders: list.length, employees: employees.size, services, amount: centsToDecimal(cents), amountCents: cents };
}

function parse<T>(schema: { parse(v: unknown): T }, raw: unknown) {
  try { return schema.parse(raw); }
  catch (error) {
    const issue = (error as { issues?: Array<{ message: string }> }).issues?.[0]?.message;
    throw new FoodPayrollBatchError("INVALID_REQUEST", issue ?? "Solicitud inválida.", 400);
  }
}

function contract<T>(fn: () => T): T {
  try { return fn(); }
  catch (error) {
    if (error instanceof FoodPayrollContractError) {
      const status = error.code === "PREVIEW_SECRET_MISSING" ? 503 : error.code === "DUPLICATE_ORDER" || error.code === "PREVIEW_INVALID" ? 400 : 409;
      throw new FoodPayrollBatchError(error.code, error.message, status);
    }
    throw error;
  }
}

// ------------------------------------------------------------------ vista previa (solo lectura)
export async function previewFoodPayrollBatch(actor: AuthenticatedUser, raw: unknown, deps: Deps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCreateAccess(actor, deps);
  const input = parse(previewRequestSchema, raw);
  const ids = contract(() => normalizeOrderIds(input.orderIds));
  const classified = await client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const map = await loadCandidates(tx, ids);
    return ids.map(id => classify(map.get(id) ?? null, id, input.payrollReference));
  });
  const eligible = classified.filter(c => c.cls === "E");
  const review = classified.filter(c => c.cls === "R");
  const excluded = classified.filter(c => c.cls === "X");
  const tokenEntries = [...eligible, ...review].map(c => [c.orderId, tokenFingerprint(c.fingerprint!), c.cls as PreviewClass] as [string, string, PreviewClass]);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + FOOD_PAYROLL_PREVIEW_TTL_MS;
  const digest = selectionDigest(tokenEntries.map(([id, fp]) => [id, fp] as const));
  const previewToken = contract(() => signPreviewToken({
    v: FOOD_PAYROLL_CONTRACT_VERSION, a: actor.id, r: input.payrollReference, iat: issuedAt, exp: expiresAt, d: digest, e: tokenEntries,
  }));
  const weeks = [...new Set([...eligible, ...review].map(c => describe(c).serviceWeekStart).filter(Boolean))].sort();
  return {
    contractVersion: FOOD_PAYROLL_CONTRACT_VERSION,
    payrollReference: input.payrollReference,
    actor: { id: actor.id, name: actor.name },
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    previewDigest: digest,
    previewToken,
    serviceWeeks: weeks,
    eligible: eligible.map(describe),
    requiresReview: review.map(describe),
    excluded: excluded.map(describe),
    totals: { eligible: totals(eligible), requiresReview: totals(review) },
    notice: "La selección se revalida al confirmar. La vista previa no reserva pedidos ni cambia estados.",
  };
}

// ------------------------------------------------------------------ generación transaccional e idempotente
export type CreateFoodPayrollBatchResult = { status: 200 | 201; replayed: boolean; body: Record<string, unknown> };

function uniqueTarget(error: unknown) {
  const e = error as { code?: string; meta?: unknown; message?: string };
  if (e?.code !== "P2002" && !/23505|unique constraint/i.test(String(e?.message ?? "")) && !/23505/.test(JSON.stringify(e?.meta ?? ""))) return null;
  return `${JSON.stringify(e.meta ?? "")} ${e.message ?? ""}`;
}

async function audit(client: Db, data: Prisma.FoodPayrollAuditEventUncheckedCreateInput) {
  await client.foodPayrollAuditEvent.create({ data });
}

async function auditRejected(client: PrismaClient, actorId: string, key: string, hash: string | null, orderCount: number, code: string, detail?: unknown) {
  try {
    await audit(client, { eventType: "BATCH_REJECTED", actorId, idempotencyKey: key, requestHash: hash, orderCount, reasonCode: code.slice(0, 80),
      detail: detail === undefined ? undefined : (JSON.parse(JSON.stringify(detail)) as Prisma.InputJsonValue) });
  } catch { /* el rechazo ya se informa al cliente; el registro de auditoría es de mejor esfuerzo */ }
}

async function replayOrConflict(client: PrismaClient, actor: AuthenticatedUser, key: string, hash: string, orderCount: number): Promise<CreateFoodPayrollBatchResult | null> {
  const existing = await client.foodPayrollBatch.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, createdById: true, idempotencyRequestHash: true, idempotencyResponse: true, status: true },
  });
  if (!existing) return null;
  if (existing.createdById !== actor.id || existing.idempotencyRequestHash !== hash || !existing.idempotencyResponse) {
    await auditRejected(client, actor.id, key, hash, orderCount, "IDEMPOTENCY_KEY_REUSED");
    throw new FoodPayrollBatchError("IDEMPOTENCY_KEY_REUSED", "La clave de idempotencia ya se usó con otra solicitud.", 409);
  }
  await audit(client, { eventType: "BATCH_REPLAYED", batchId: existing.id, actorId: actor.id, idempotencyKey: key, requestHash: hash, orderCount });
  return { status: 200, replayed: true, body: existing.idempotencyResponse as Record<string, unknown> };
}

export async function createFoodPayrollBatch(
  actor: AuthenticatedUser, raw: unknown, idempotencyKeyRaw: unknown, deps: Deps = {},
): Promise<CreateFoodPayrollBatchResult> {
  const client = deps.db ?? defaultDb;
  const key = parse(idempotencyKeySchema, idempotencyKeyRaw);
  const input = parse(createRequestSchema, raw);
  const ids = contract(() => normalizeOrderIds(input.orderIds));
  const reviewed = contract(() => normalizeOrderIds(input.reviewedInactiveOrderIds));
  if (reviewed.some(id => !ids.includes(id))) throw new FoodPayrollBatchError("INVALID_REQUEST", "Un excolaborador revisado no está en la selección.", 400);
  const token = contract(() => verifyPreviewToken(input.previewToken));
  const entries = new Map(token.e.map(([id, fp, cls]) => [id, { fp, cls }]));
  const selected = ids.map(id => [id, entries.get(id)?.fp ?? "missing"] as const);
  const digest = selectionDigest(selected);
  const hash = idempotencyRequestHash({ actorId: actor.id, payrollReference: input.payrollReference, orderIds: ids, reviewedInactiveOrderIds: reviewed, selectionDigest: digest });

  await requireCreateAccess(actor, deps);
  // Un reintento idempotente válido se resuelve antes de evaluar la expiración del token.
  const replay = await replayOrConflict(client, actor, key, hash, ids.length);
  if (replay) return replay;

  const reject = async (code: string, message: string, details?: unknown, status = 409): Promise<never> => {
    await auditRejected(client, actor.id, key, hash, ids.length, code, details);
    throw new FoodPayrollBatchError(code, message, status, details);
  };
  if (token.a !== actor.id) await reject("PREVIEW_ACTOR_MISMATCH", "La vista previa pertenece a otro usuario.", undefined, 403);
  if (token.expired) await reject("PREVIEW_EXPIRED", "La vista previa expiró. Genera una nueva vista previa.");
  if (token.r !== input.payrollReference) await reject("PREVIEW_MISMATCH", "La referencia de prenómina no coincide con la vista previa.");
  const outside = ids.filter(id => !entries.has(id));
  if (outside.length) await reject("PREVIEW_MISMATCH", "La selección incluye pedidos no elegibles en la vista previa.", { orderIds: outside });
  const missingReview = ids.filter(id => entries.get(id)?.cls === "R" && !reviewed.includes(id));
  if (missingReview.length) await reject("INACTIVE_EMPLOYEE_REVIEW_REQUIRED", "Hay excolaboradores que requieren revisión expresa de RH.", { orderIds: missingReview });

  try {
    const body = await client.$transaction(async tx => {
      if (!(await grantsOk(tx, actor.id))) throw new CorporateAuthorizationRequired("Acceso restringido");
      const locked = await lockFoodOrders(tx, ids);
      if (locked.length !== ids.length) {
        throw new FoodPayrollBatchError("ORDER_NOT_FOUND", "Uno o más pedidos ya no existen.", 409, { orderIds: ids.filter(id => !locked.includes(id)) });
      }
      const map = await loadCandidates(tx, ids);
      const current = ids.map(id => classify(map.get(id) ?? null, id, input.payrollReference));
      const notEligible = current.filter(c => c.cls === "X" || (c.cls === "R" && !reviewed.includes(c.orderId)));
      if (notEligible.length) {
        const assigned = notEligible.some(c => c.reasons.includes("ACTIVE_ASSIGNMENT_EXISTS"));
        throw new FoodPayrollBatchError(assigned ? "ACTIVE_ASSIGNMENT_EXISTS" : "ORDER_NOT_ELIGIBLE",
          assigned ? "Uno o más pedidos ya están asignados a un lote activo." : "Uno o más pedidos dejaron de ser elegibles.",
          409, { orders: notEligible.map(c => ({ orderId: c.orderId, reasons: c.reasons })) });
      }
      const stale = current.filter(c => tokenFingerprint(c.fingerprint!) !== entries.get(c.orderId)!.fp || c.cls !== entries.get(c.orderId)!.cls);
      if (stale.length) throw new FoodPayrollBatchError("PREVIEW_STALE", "Los pedidos cambiaron después de la vista previa. Genera una nueva vista previa.", 409, { orderIds: stale.map(c => c.orderId) });

      const batchId = randomUUID();
      const sum = totals(current);
      await tx.foodPayrollBatch.create({ data: {
        id: batchId, idempotencyKey: key, idempotencyRequestHash: hash, contractVersion: FOOD_PAYROLL_CONTRACT_VERSION,
        status: "DRAFT", payrollReference: input.payrollReference, previewDigest: digest, createdById: actor.id,
      } });
      const items: Prisma.FoodPayrollBatchItemCreateManyInput[] = [];
      const services: Prisma.FoodPayrollBatchItemServiceCreateManyInput[] = [];
      const assignments: Prisma.FoodPayrollAssignmentCreateManyInput[] = [];
      for (const c of current) {
        const o = c.order!; const e = o.employee!; const itemId = randomUUID();
        items.push({
          id: itemId, batchId, orderId: o.id, employeeId: o.employeeId,
          employeeNumber: e.employeeNumber, employeeName: e.fullName, employeeStatusSnapshot: e.status,
          inactiveEmployeeReviewed: c.cls === "R",
          departmentIdSnapshot: e.department?.id ?? null, departmentCode: e.department?.code ?? null, departmentName: e.department?.name ?? null,
          workShiftIdSnapshot: e.workShift?.id ?? null, workShiftCode: e.workShift?.code ?? null, workShiftName: e.workShift?.name ?? null,
          menuWeekId: o.menuWeekId, serviceWeekStart: o.menuWeek!.weekStart,
          orderStatusSnapshot: o.status, payrollStatusSnapshot: o.payrollStatus,
          confirmedAtSnapshot: o.confirmedAt, orderCreatedAtSnapshot: o.createdAt,
          itemCount: o.itemCount, historicalUnitPrice: centsToDecimal(toCents(o.unitPrice)!), committedAmount: centsToDecimal(toCents(o.totalAmount)!),
          orderFingerprint: c.fingerprint!,
        });
        for (const r of o.reservations) {
          services.push({ id: randomUUID(), batchId, batchItemId: itemId, reservationId: r.id, menuItemId: r.menuItemId,
            serviceDate: r.menuItem!.menuDay.serviceDate, serviceType: r.menuItem!.serviceType, menuItemName: r.menuItem!.name });
        }
        assignments.push({ id: randomUUID(), orderId: o.id, batchId, batchItemId: itemId, status: "ACTIVE" });
      }
      await tx.foodPayrollBatchItem.createMany({ data: items });
      await tx.foodPayrollBatchItemService.createMany({ data: services });
      await tx.foodPayrollAssignment.createMany({ data: assignments });

      const generatedAt = new Date();
      const response = {
        contractVersion: FOOD_PAYROLL_CONTRACT_VERSION, batchId, status: "GENERATED", payrollReference: input.payrollReference,
        orderIds: ids, reviewedInactiveOrderIds: reviewed,
        serviceWeeks: [...new Set(current.map(c => c.order!.menuWeek!.weekStart.toISOString().slice(0, 10)))].sort(),
        orderCount: sum.orders, employeeCount: sum.employees, serviceCount: sum.services, committedAmount: sum.amount,
        currency: "MXN", previewDigest: digest, generatedAt: generatedAt.toISOString(), createdById: actor.id,
      };
      await tx.foodPayrollBatch.update({ where: { id: batchId }, data: {
        status: "GENERATED", generatedAt, orderCount: sum.orders, employeeCount: sum.employees, serviceCount: sum.services,
        committedAmount: sum.amount, idempotencyResponse: response as unknown as Prisma.InputJsonValue,
      } });
      await audit(tx, { eventType: "BATCH_CREATED", batchId, actorId: actor.id, idempotencyKey: key, requestHash: hash, orderCount: sum.orders,
        detail: { serviceWeeks: response.serviceWeeks, committedAmount: sum.amount, reviewedInactiveOrderIds: reviewed } as Prisma.InputJsonValue });
      return response;
    }, { maxWait: 10_000, timeout: 60_000 });
    return { status: 201, replayed: false, body };
  } catch (error) {
    const target = uniqueTarget(error);
    // Una solicitud simultánea con la misma clave pudo confirmar primero: se resuelve como replay o 409.
    if (target || error instanceof FoodPayrollBatchError) {
      const replayed = await replayOrConflict(client, actor, key, hash, ids.length);
      if (replayed) return replayed;
    }
    if (target && /one_active_per_order|orderId/.test(target)) {
      await auditRejected(client, actor.id, key, hash, ids.length, "ACTIVE_ASSIGNMENT_EXISTS");
      throw new FoodPayrollBatchError("ACTIVE_ASSIGNMENT_EXISTS", "Uno o más pedidos ya están asignados a un lote activo.", 409);
    }
    if (error instanceof FoodPayrollBatchError) await auditRejected(client, actor.id, key, hash, ids.length, error.code, error.details);
    throw error;
  }
}
