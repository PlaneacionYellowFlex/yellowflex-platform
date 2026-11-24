/**
 * YF-002 Bloque A — contrato puro de prenómina Food Services (sin base de datos).
 * Huellas canónicas de pedidos, token firmado de vista previa, digest de selección y huella de
 * idempotencia. Importes siempre en centavos enteros.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const FOOD_PAYROLL_CONTRACT_VERSION = 1;
export const FOOD_PAYROLL_PREVIEW_TTL_MS = 10 * 60 * 1000;
export const FOOD_PAYROLL_MAX_ORDERS = 500;
const TOKEN_FP_LENGTH = 32;

const orderId = z.string().trim().min(1).max(100);

/** Referencia libre de RH: sin formato ni calendario, 1..40 caracteres tras recortar. */
export const payrollReferenceSchema = z.string().trim().min(1, "La referencia de prenómina es obligatoria.")
  .max(40, "La referencia de prenómina admite hasta 40 caracteres.");

export const previewRequestSchema = z.object({
  payrollReference: payrollReferenceSchema,
  orderIds: z.array(orderId).min(1, "Selecciona al menos un pedido.").max(FOOD_PAYROLL_MAX_ORDERS),
}).strict();

export const createRequestSchema = z.object({
  payrollReference: payrollReferenceSchema,
  orderIds: z.array(orderId).min(1, "Selecciona al menos un pedido.").max(FOOD_PAYROLL_MAX_ORDERS),
  reviewedInactiveOrderIds: z.array(orderId).max(FOOD_PAYROLL_MAX_ORDERS).default([]),
  previewToken: z.string().min(20).max(200_000),
}).strict();

export const idempotencyKeySchema = z.string().trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/, "Idempotency-Key inválida (8 a 120 caracteres alfanuméricos).");

export class FoodPayrollContractError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "FoodPayrollContractError"; }
}

/** Ordena y rechaza duplicados (la selección explícita no admite ids repetidos). */
export function normalizeOrderIds(ids: readonly string[]) {
  const sorted = ids.map(id => id.trim()).sort();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) throw new FoodPayrollContractError("DUPLICATE_ORDER", `Pedido repetido en la selección: ${sorted[i]}`);
  }
  return sorted;
}

export function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

/** JSON canónico: claves ordenadas, sin espacios. Solo para valores JSON simples. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Decimal/numero/cadena a centavos exactos; null si no es un importe no negativo de 2 decimales. */
export function toCents(value: unknown): number | null {
  const text = typeof value === "string" || typeof value === "number" ? String(value)
    : value && typeof (value as { toString?: unknown }).toString === "function" ? (value as { toString(): string }).toString() : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToDecimal(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export type FingerprintOrder = {
  id: string; status: string; payrollStatus: string; employeeId: string; menuWeekId: string;
  itemCount: number; unitPrice: unknown; totalAmount: unknown; confirmedAt: Date | string; createdAt: Date | string;
  employee: { id: string; employeeNumber: string; fullName: string; status: string; departmentId?: string | null; workShiftId?: string | null } | null;
  menuWeek: { id: string; weekStart: Date | string } | null;
  reservations: Array<{ id: string; status: string; foodOrderId: string | null; employeeId: string; menuItemId?: string;
    menuItem?: { id?: string; menuDay?: { menuWeekId: string; serviceDate: Date | string } } | null }>;
  payrollAssignments?: Array<{ status: string }>;
};

/** Huella SHA-256 de todo lo que determina el cargo de un pedido. Cualquier cambio invalida la vista previa. */
export function orderFingerprint(order: FingerprintOrder) {
  return sha256Hex(canonicalJson({
    id: order.id, status: order.status, payrollStatus: order.payrollStatus,
    employeeId: order.employeeId, menuWeekId: order.menuWeekId, weekStart: iso(order.menuWeek?.weekStart),
    itemCount: order.itemCount, unitCents: toCents(order.unitPrice), totalCents: toCents(order.totalAmount),
    confirmedAt: iso(order.confirmedAt), createdAt: iso(order.createdAt),
    employee: order.employee ? {
      id: order.employee.id, number: order.employee.employeeNumber, name: order.employee.fullName, status: order.employee.status,
      departmentId: order.employee.departmentId ?? null, workShiftId: order.employee.workShiftId ?? null,
    } : null,
    reservations: [...order.reservations].sort((a, b) => (a.id < b.id ? -1 : 1)).map(r => ({
      id: r.id, status: r.status, foodOrderId: r.foodOrderId, employeeId: r.employeeId,
      menuItemId: r.menuItemId ?? r.menuItem?.id ?? null,
      menuWeekId: r.menuItem?.menuDay?.menuWeekId ?? null, serviceDate: iso(r.menuItem?.menuDay?.serviceDate),
    })),
    activeAssignment: Boolean(order.payrollAssignments?.some(a => a.status === "ACTIVE")),
  }));
}

/** Digest de una selección: SHA-256 de pares [orderId, huella] ordenados por id. */
export function selectionDigest(entries: ReadonlyArray<readonly [string, string]>) {
  return sha256Hex(canonicalJson([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

export type PreviewClass = "E" | "R"; // E elegible, R requiere revisión expresa (excolaborador)
export type PreviewTokenPayload = {
  v: number; a: string; r: string; iat: number; exp: number; d: string;
  e: Array<[string, string, PreviewClass]>;
  /** Modo masivo por periodo (Bloque C): el token no enumera pedidos; fija periodo, digest y excepciones. */
  m?: "P"; p?: { from: string; to: string }; n?: { eligible: number; review: number }; rv?: string[];
};

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD).");

/** Prenómina masiva: todos los pedidos confirmados de las semanas de servicio del periodo, sin límite de cantidad. */
export const periodPreviewSchema = z.object({
  payrollReference: payrollReferenceSchema, weekFrom: isoDay, weekTo: isoDay,
}).strict().refine(v => v.weekFrom <= v.weekTo, "La semana inicial debe ser anterior o igual a la final.");

export const periodCreateSchema = z.object({
  payrollReference: payrollReferenceSchema, weekFrom: isoDay, weekTo: isoDay,
  reviewedInactiveOrderIds: z.array(z.string().trim().min(1).max(100)).max(FOOD_PAYROLL_MAX_ORDERS).default([]),
  previewToken: z.string().min(20).max(200_000),
}).strict();

/** Huella de idempotencia del modo masivo: actor, versión, periodo, referencia, digest y excolaboradores revisados. */
export function periodRequestHash(input: {
  actorId: string; payrollReference: string; weekFrom: string; weekTo: string; reviewedInactiveOrderIds: readonly string[]; selectionDigest: string;
}) {
  return sha256Hex(canonicalJson({
    mode: "PERIOD", actorId: input.actorId, contractVersion: FOOD_PAYROLL_CONTRACT_VERSION,
    period: { from: input.weekFrom, to: input.weekTo }, payrollReference: input.payrollReference,
    reviewedInactiveOrderIds: [...input.reviewedInactiveOrderIds].sort(), selectionDigest: input.selectionDigest,
  }));
}

function previewSecret(secret = process.env.FOOD_PAYROLL_PREVIEW_SECRET) {
  if (!secret || secret.length < 32) {
    throw new FoodPayrollContractError("PREVIEW_SECRET_MISSING", "FOOD_PAYROLL_PREVIEW_SECRET no está configurado (mínimo 32 caracteres).");
  }
  return secret;
}

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

export function signPreviewToken(payload: PreviewTokenPayload, secret?: string) {
  const body = b64(canonicalJson(payload));
  const mac = createHmac("sha256", previewSecret(secret)).update(`yf-payroll-preview.v1.${body}`).digest("base64url");
  return `${body}.${mac}`;
}

/** Verifica la firma. La expiración se informa aparte para permitir reintentos idempotentes válidos. */
export function verifyPreviewToken(token: string, secret?: string): PreviewTokenPayload & { expired: boolean } {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) throw new FoodPayrollContractError("PREVIEW_INVALID", "Token de vista previa inválido.");
  const expected = createHmac("sha256", previewSecret(secret)).update(`yf-payroll-preview.v1.${body}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new FoodPayrollContractError("PREVIEW_INVALID", "Token de vista previa inválido o alterado.");
  }
  let payload: PreviewTokenPayload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { throw new FoodPayrollContractError("PREVIEW_INVALID", "Token de vista previa ilegible."); }
  if (payload.v !== FOOD_PAYROLL_CONTRACT_VERSION || !Array.isArray(payload.e) || typeof payload.exp !== "number") {
    throw new FoodPayrollContractError("PREVIEW_INVALID", "Versión de contrato de vista previa no admitida.");
  }
  return { ...payload, expired: Date.now() > payload.exp };
}

export function tokenFingerprint(fullFingerprint: string) {
  return fullFingerprint.slice(0, TOKEN_FP_LENGTH);
}

/**
 * Huella de idempotencia: actor, versión del contrato, selección ordenada, excolaboradores revisados,
 * referencia y digest de la selección tomado del token firmado.
 */
export function idempotencyRequestHash(input: {
  actorId: string; payrollReference: string; orderIds: readonly string[]; reviewedInactiveOrderIds: readonly string[]; selectionDigest: string;
}) {
  return sha256Hex(canonicalJson({
    actorId: input.actorId, contractVersion: FOOD_PAYROLL_CONTRACT_VERSION,
    orderIds: [...input.orderIds].sort(), reviewedInactiveOrderIds: [...input.reviewedInactiveOrderIds].sort(),
    payrollReference: input.payrollReference, selectionDigest: input.selectionDigest,
  }));
}
