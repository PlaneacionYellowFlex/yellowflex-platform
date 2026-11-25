import "server-only";

/**
 * YF-002 Bloque B — operación RH de prenómina sobre el motor del Bloque A.
 * Capacidades granulares C-PANEL (sin atajo ADMIN), búsqueda de pedidos, consulta histórica,
 * anulación previa a exportación con liberación transaccional de asignaciones, exportación oficial
 * Excel con SHA-256 y descarga verificada. Exportar NO significa que el descuento se haya aplicado:
 * no cambia FoodOrder.payrollStatus ni concilia. La conciliación y el cierre viven en payroll-reconciliation (C2).
 */
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedUser } from "@/lib/access-control";
import { CorporateAuthorizationRequired } from "@/lib/auth/corporate-auth";
import { db as defaultDb } from "@/lib/db";
import { centsToDecimal, toCents } from "@/lib/food-services/payroll-batch-contract";
import { FoodPayrollBatchError, candidateInclude, classify, describe } from "@/lib/food-services/payroll-batch-service";
import { lockFoodOrders } from "@/lib/food-services/order-lock";

type Db = PrismaClient | Prisma.TransactionClient;
type Deps = { db?: PrismaClient };

export const PAYROLL_ACTIONS = {
  view: "view-payroll-batches",
  create: "create-payroll-batch",
  void: "void-payroll-batch",
  export: "export-payroll-batch",
  reconView: "view-payroll-reconciliations",
  reconcile: "register-payroll-reconciliation",
  adjust: "manage-payroll-adjustments",
  close: "close-payroll-batch",
  control: "export-payroll-control",
} as const;
export type PayrollCapability = keyof typeof PAYROLL_ACTIONS;
export type PayrollCapabilities = Record<PayrollCapability, boolean>;

/** RH activo, sin contraseña temporal, con view + manage de Food Services y la acción explícita. */
export async function getPayrollCapabilities(userId: string, client: Db = defaultDb): Promise<PayrollCapabilities> {
  const none = Object.fromEntries(Object.keys(PAYROLL_ACTIONS).map(k => [k, false])) as PayrollCapabilities;
  const user = await client.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user?.active || user.passwordMustChange || !user.roles.some(r => r.role === "RH")) return none;
  const grants = new Set((await client.corporateModulePermission.findMany({
    where: { userId, moduleKey: "food-services", granted: true }, select: { actionKey: true },
  })).map(g => g.actionKey));
  if (!grants.has("view") || !grants.has("manage")) return none;
  return Object.fromEntries(Object.entries(PAYROLL_ACTIONS).map(([k, action]) => [k, grants.has(action)])) as PayrollCapabilities;
}

export async function requireCapability(actor: AuthenticatedUser, capability: PayrollCapability, client: Db) {
  if (!actor.roles.includes("RH") || !(await getPayrollCapabilities(actor.id, client))[capability]) {
    throw new CorporateAuthorizationRequired("Acceso restringido");
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD).");

// ------------------------------------------------------------------ búsqueda de pedidos para selección
export const candidateFiltersSchema = z.object({
  weekFrom: day.optional(), weekTo: day.optional(),
  employee: z.string().trim().max(120).optional(),
  view: z.enum(["selectable", "all"]).default("selectable"),
  limit: z.coerce.number().int().min(1).max(500).default(300),
  page: z.coerce.number().int().min(1).default(1),
});

/** Consulta individual opcional, paginada con total exacto: ninguna página omite pedidos en silencio. */
export async function listFoodPayrollCandidates(actor: AuthenticatedUser, raw: unknown, deps: Deps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCapability(actor, "create", client);
  const f = parseOrThrow(candidateFiltersSchema, raw);
  const weekStart: Prisma.DateTimeFilter = {};
  if (f.weekFrom) weekStart.gte = new Date(`${f.weekFrom}T00:00:00.000Z`);
  if (f.weekTo) weekStart.lte = new Date(`${f.weekTo}T00:00:00.000Z`);
  const where: Prisma.FoodOrderWhereInput = {
    ...(f.view === "selectable" ? { status: "CONFIRMED", payrollStatus: "PENDING" } : {}),
    ...(f.weekFrom || f.weekTo ? { menuWeek: { weekStart } } : {}),
    ...(f.employee ? { employee: { OR: [
      { employeeNumber: { contains: f.employee, mode: "insensitive" } }, { fullName: { contains: f.employee, mode: "insensitive" } },
    ] } } : {}),
  };
  const total = await client.foodOrder.count({ where });
  const pages = Math.max(1, Math.ceil(total / f.limit));
  const orders = await client.foodOrder.findMany({
    where, include: { ...candidateInclude, payrollAssignments: { where: { status: "ACTIVE" }, select: { status: true, batch: { select: { id: true, payrollReference: true, status: true } } } } },
    orderBy: [{ menuWeek: { weekStart: "desc" } }, { employee: { fullName: "asc" } }, { id: "asc" }], take: f.limit, skip: (f.page - 1) * f.limit,
  });
  const rows = orders.map(o => {
    const c = classify(o, o.id, "busqueda");
    const active = o.payrollAssignments[0]?.batch ?? null;
    return { ...describe(c), classification: c.cls === "E" ? "eligible" : c.cls === "R" ? "requiresReview" : "excluded",
      activeBatch: active ? { id: active.id, payrollReference: active.payrollReference, status: active.status } : null };
  });
  return { filters: f, count: rows.length, total, page: f.page, pages, truncated: f.page < pages, orders: rows };
}

// ------------------------------------------------------------------ consulta histórica
export const batchFiltersSchema = z.object({
  status: z.enum(["GENERATED", "EXPORTED", "PARTIALLY_RECONCILED", "RECONCILED", "VOIDED"]).optional(),
  reference: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const batchSummarySelect = {
  id: true, status: true, payrollReference: true, orderCount: true, employeeCount: true, serviceCount: true,
  committedAmount: true, currency: true, generatedAt: true, createdAt: true, exportedAt: true, fileName: true, fileSha256: true,
  externalReference: true, voidedAt: true, voidReason: true, closedAt: true, closeNote: true,
  createdBy: { select: { id: true, name: true } }, exportedBy: { select: { id: true, name: true } }, voidedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
} satisfies Prisma.FoodPayrollBatchSelect;

type BatchSummary = Prisma.FoodPayrollBatchGetPayload<{ select: typeof batchSummarySelect }>;
function summary(b: BatchSummary, weeks: string[] = []) {
  return { ...b, committedAmount: centsToDecimal(toCents(b.committedAmount) ?? 0), serviceWeeks: weeks };
}

async function weeksByBatch(client: Db, ids: string[]) {
  if (!ids.length) return new Map<string, string[]>();
  const groups = await client.foodPayrollBatchItem.groupBy({ by: ["batchId", "serviceWeekStart"], where: { batchId: { in: ids } } });
  const map = new Map<string, string[]>();
  for (const g of groups) map.set(g.batchId, [...(map.get(g.batchId) ?? []), g.serviceWeekStart.toISOString().slice(0, 10)].sort());
  return map;
}

export async function listFoodPayrollBatches(actor: AuthenticatedUser, raw: unknown, deps: Deps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCapability(actor, "view", client);
  const f = parseOrThrow(batchFiltersSchema, raw);
  const batches = await client.foodPayrollBatch.findMany({
    where: { status: f.status ?? { not: "DRAFT" }, ...(f.reference ? { payrollReference: { contains: f.reference, mode: "insensitive" } } : {}) },
    select: batchSummarySelect, orderBy: { createdAt: "desc" }, take: f.limit,
  });
  const weeks = await weeksByBatch(client, batches.map(b => b.id));
  return { batches: batches.map(b => summary(b, weeks.get(b.id))) };
}

export const DETAIL_PAGE_SIZE = 200;

/** Detalle paginado (200 renglones por página) con total exacto; la exportación oficial siempre incluye todo. */
export async function getFoodPayrollBatch(actor: AuthenticatedUser, batchId: string, deps: Deps = {}, pageRaw: unknown = 1) {
  const client = deps.db ?? defaultDb;
  await requireCapability(actor, "view", client);
  const page = Math.max(1, Math.trunc(Number(pageRaw) || 1));
  const b = await client.foodPayrollBatch.findFirst({ where: { id: batchId, status: { not: "DRAFT" } }, select: {
    ...batchSummarySelect,
    items: { orderBy: [{ employeeNumber: "asc" }, { serviceWeekStart: "asc" }, { id: "asc" }], take: DETAIL_PAGE_SIZE, skip: (page - 1) * DETAIL_PAGE_SIZE, select: {
      id: true, orderId: true, employeeNumber: true, employeeName: true, employeeStatusSnapshot: true, inactiveEmployeeReviewed: true,
      departmentName: true, workShiftName: true, serviceWeekStart: true, itemCount: true, historicalUnitPrice: true, committedAmount: true,
      services: { orderBy: { serviceDate: "asc" }, select: { serviceDate: true, serviceType: true, menuItemName: true } },
      assignments: { select: { status: true, releasedAt: true, releaseReason: true } },
    } },
    auditEvents: { orderBy: { createdAt: "asc" }, select: { eventType: true, createdAt: true, orderCount: true, reasonCode: true, actor: { select: { name: true } } } },
  } });
  if (!b) throw new FoodPayrollBatchError("BATCH_NOT_FOUND", "Lote de prenómina no encontrado.", 404);
  const weeks = (await weeksByBatch(client, [b.id])).get(b.id) ?? [];
  const itemsTotal = await client.foodPayrollBatchItem.count({ where: { batchId } });
  return {
    ...summary(b, weeks), itemsTotal, page, pageSize: DETAIL_PAGE_SIZE, pages: Math.max(1, Math.ceil(itemsTotal / DETAIL_PAGE_SIZE)),
    items: b.items.map(i => ({ ...i, serviceWeekStart: i.serviceWeekStart.toISOString().slice(0, 10),
      historicalUnitPrice: centsToDecimal(toCents(i.historicalUnitPrice) ?? 0), committedAmount: centsToDecimal(toCents(i.committedAmount) ?? 0),
      services: i.services.map(s => ({ ...s, serviceDate: s.serviceDate.toISOString().slice(0, 10) })),
      assignmentStatus: i.assignments[0]?.status ?? null })),
    auditEvents: b.auditEvents,
  };
}

// ------------------------------------------------------------------ bloqueo del lote (después de los pedidos)
export async function lockBatch(tx: Prisma.TransactionClient, batchId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "FoodPayrollBatch" WHERE "id" = ${batchId} FOR UPDATE`;
  if (!rows.length) throw new FoodPayrollBatchError("BATCH_NOT_FOUND", "Lote de prenómina no encontrado.", 404);
}

function stateError(status: string, action: "anular" | "exportar") {
  if (status === "VOIDED") return new FoodPayrollBatchError("BATCH_ALREADY_VOIDED", "El lote ya fue anulado.", 409);
  if (status === "EXPORTED" || status === "PARTIALLY_RECONCILED" || status === "RECONCILED") {
    return new FoodPayrollBatchError("BATCH_ALREADY_EXPORTED",
      action === "anular" ? "Un lote exportado no se anula; requiere conciliación y ajuste controlado." : "El lote ya tiene una exportación oficial; descarga el archivo registrado.", 409);
  }
  return new FoodPayrollBatchError("BATCH_NOT_GENERATED", "El lote no está en estado GENERATED.", 409);
}

// ------------------------------------------------------------------ anulación antes de exportar
export const voidRequestSchema = z.object({ reason: z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres.").max(500) }).strict();

export async function voidFoodPayrollBatch(actor: AuthenticatedUser, batchId: string, raw: unknown, deps: Deps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCapability(actor, "void", client);
  const { reason } = parseOrThrow(voidRequestSchema, raw);
  return client.$transaction(async tx => {
    await requireCapability(actor, "void", tx);
    // Orden de bloqueo uniforme: pedidos (id ascendente) y después el lote.
    const items = await tx.foodPayrollBatchItem.findMany({ where: { batchId }, select: { orderId: true } });
    await lockFoodOrders(tx, items.map(i => i.orderId));
    await lockBatch(tx, batchId);
    const batch = await tx.foodPayrollBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true, exportedAt: true } });
    if (batch.status !== "GENERATED" || batch.exportedAt) throw stateError(batch.status, "anular");
    const now = new Date();
    await tx.foodPayrollBatch.update({ where: { id: batchId }, data: { status: "VOIDED", voidedAt: now, voidedById: actor.id, voidReason: reason } });
    const released = await tx.foodPayrollAssignment.updateMany({
      where: { batchId, status: "ACTIVE" },
      data: { status: "RELEASED", releasedAt: now, releasedById: actor.id, releaseReason: `Anulación del lote: ${reason}`.slice(0, 500) },
    });
    if (released.count !== items.length) throw new FoodPayrollBatchError("ASSIGNMENT_MISMATCH", "Las asignaciones del lote no coinciden con sus detalles.", 409);
    await tx.foodPayrollAuditEvent.create({ data: { eventType: "BATCH_VOIDED", batchId, actorId: actor.id, orderCount: items.length, detail: { reason } } });
    await tx.foodPayrollAuditEvent.create({ data: { eventType: "ASSIGNMENT_RELEASED", batchId, actorId: actor.id, orderCount: released.count } });
    return { batchId, status: "VOIDED" as const, voidedAt: now.toISOString(), releasedAssignments: released.count };
  }, { maxWait: 10_000, timeout: 60_000 });
}

// ------------------------------------------------------------------ exportación oficial Excel
export const exportRequestSchema = z.object({ externalReference: z.string().trim().max(160).optional() }).strict();

type ExportBatch = {
  id: string; payrollReference: string; generatedAt: Date | null; orderCount: number; employeeCount: number; serviceCount: number;
  committedAmount: unknown; createdBy: { name: string };
  items: Array<{ orderId: string; employeeNumber: string; employeeName: string; employeeStatusSnapshot: string; inactiveEmployeeReviewed: boolean;
    departmentName: string | null; workShiftName: string | null; serviceWeekStart: Date; itemCount: number; historicalUnitPrice: unknown; committedAmount: unknown;
    services: Array<{ serviceDate: Date; serviceType: string; menuItemName: string }> }>;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const money = (v: unknown) => (toCents(v) ?? 0) / 100;

export async function buildOfficialPayrollWorkbook(batch: ExportBatch, exportedAt: Date, exportedBy: string, externalReference?: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "YellowFlex Platform"; wb.created = exportedAt; wb.modified = exportedAt;
  const blue = "FF0B3A82"; const gold = "FFF4B400";
  const head = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.eachCell(cell => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } }; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  // Hoja principal para nómina: un renglón por número de empleado con el descuento total agrupado.
  const grouped = new Map<string, { name: string; status: string; reviewed: boolean; dept: string; shift: string; orders: number; services: number; cents: number; weeks: Set<string> }>();
  for (const i of batch.items) {
    const g = grouped.get(i.employeeNumber) ?? { name: i.employeeName, status: i.employeeStatusSnapshot, reviewed: false, dept: i.departmentName ?? "", shift: i.workShiftName ?? "", orders: 0, services: 0, cents: 0, weeks: new Set<string>() };
    g.orders += 1; g.services += i.itemCount; g.cents += toCents(i.committedAmount) ?? 0; g.weeks.add(ymd(i.serviceWeekStart));
    g.reviewed = g.reviewed || i.inactiveEmployeeReviewed;
    grouped.set(i.employeeNumber, g);
  }
  const ge = wb.addWorksheet("Descuentos por colaborador");
  ge.columns = [
    { header: "Referencia de prenómina", key: "ref", width: 24 }, { header: "No. colaborador", key: "num", width: 16 },
    { header: "Colaborador", key: "name", width: 32 }, { header: "Estado del colaborador", key: "status", width: 18 },
    { header: "Revisado por RH (excolaborador)", key: "rev", width: 18 }, { header: "Departamento", key: "dept", width: 22 },
    { header: "Turno", key: "shift", width: 14 }, { header: "Pedidos", key: "orders", width: 10 }, { header: "Servicios", key: "qty", width: 10 },
    { header: "Semanas de servicio", key: "weeks", width: 34 }, { header: "Descuento total", key: "amount", width: 16 },
  ];
  let groupedCents = 0;
  for (const [num, g] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, "es"))) {
    groupedCents += g.cents;
    ge.addRow({ ref: batch.payrollReference, num, name: g.name, status: g.status, rev: g.reviewed ? "Sí" : "No", dept: g.dept, shift: g.shift,
      orders: g.orders, qty: g.services, weeks: [...g.weeks].sort().join(", "), amount: g.cents / 100 });
  }
  if (groupedCents !== (toCents(batch.committedAmount) ?? -1)) throw new Error("El agrupado por colaborador no cuadra con el total del lote");
  const gt = ge.addRow({ name: `TOTAL (${grouped.size} colaboradores)`, orders: batch.orderCount, qty: batch.serviceCount, amount: money(batch.committedAmount) });
  gt.font = { bold: true }; gt.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gold } }; });
  ge.getColumn("amount").numFmt = "#,##0.00";
  head(ge);

  const ws = wb.addWorksheet("Prenomina");
  ws.columns = [
    { header: "Referencia de prenómina", key: "ref", width: 24 }, { header: "Lote", key: "batch", width: 38 },
    { header: "No. colaborador", key: "num", width: 16 }, { header: "Colaborador", key: "name", width: 32 },
    { header: "Estado del colaborador", key: "status", width: 18 }, { header: "Revisado por RH (excolaborador)", key: "rev", width: 18 },
    { header: "Departamento", key: "dept", width: 22 }, { header: "Turno", key: "shift", width: 14 },
    { header: "Semana de servicio", key: "week", width: 16 }, { header: "Pedido", key: "order", width: 28 },
    { header: "Servicios", key: "qty", width: 10 }, { header: "Precio unitario histórico", key: "unit", width: 16 },
    { header: "Importe a descontar", key: "amount", width: 16 },
  ];
  for (const i of batch.items) {
    ws.addRow({ ref: batch.payrollReference, batch: batch.id, num: i.employeeNumber, name: i.employeeName, status: i.employeeStatusSnapshot,
      rev: i.inactiveEmployeeReviewed ? "Sí" : "No", dept: i.departmentName ?? "", shift: i.workShiftName ?? "", week: ymd(i.serviceWeekStart),
      order: i.orderId, qty: i.itemCount, unit: money(i.historicalUnitPrice), amount: money(i.committedAmount) });
  }
  const total = ws.addRow({ name: "TOTAL", qty: batch.serviceCount, amount: money(batch.committedAmount) });
  total.font = { bold: true }; total.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: gold } }; });
  ws.getColumn("unit").numFmt = "#,##0.00"; ws.getColumn("amount").numFmt = "#,##0.00";
  head(ws);

  const sv = wb.addWorksheet("Servicios");
  sv.columns = [
    { header: "No. colaborador", key: "num", width: 16 }, { header: "Colaborador", key: "name", width: 32 },
    { header: "Semana de servicio", key: "week", width: 16 }, { header: "Fecha", key: "date", width: 12 },
    { header: "Tipo", key: "type", width: 14 }, { header: "Platillo", key: "dish", width: 36 }, { header: "Pedido", key: "order", width: 28 },
  ];
  for (const i of batch.items) for (const s of i.services) {
    sv.addRow({ num: i.employeeNumber, name: i.employeeName, week: ymd(i.serviceWeekStart), date: ymd(s.serviceDate), type: s.serviceType, dish: s.menuItemName, order: i.orderId });
  }
  head(sv);

  const ctl = wb.addWorksheet("Control");
  ctl.columns = [{ header: "Concepto", key: "k", width: 34 }, { header: "Valor", key: "v", width: 60 }];
  const rows: Array<[string, string | number]> = [
    ["Lote", batch.id], ["Referencia de prenómina", batch.payrollReference], ["Referencia externa", externalReference ?? ""],
    ["Generado", batch.generatedAt ? batch.generatedAt.toISOString() : ""], ["Generado por", batch.createdBy.name],
    ["Exportado", exportedAt.toISOString()], ["Exportado por", exportedBy],
    ["Pedidos", batch.orderCount], ["Colaboradores", batch.employeeCount], ["Renglones en 'Descuentos por colaborador'", grouped.size], ["Servicios", batch.serviceCount],
    ["Importe total (MXN)", centsToDecimal(toCents(batch.committedAmount) ?? 0)],
    ["Semanas de servicio", [...new Set(batch.items.map(i => ymd(i.serviceWeekStart)))].sort().join(", ")],
    ["Aviso", "Exportación oficial para RH. Exportar no significa que el descuento haya sido aplicado; la aplicación se confirma en la conciliación."],
  ];
  for (const [k, v] of rows) ctl.addRow({ k, v });
  head(ctl);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function fileNameFor(reference: string, batchId: string, at: Date) {
  const slug = reference.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "prenomina";
  return `Prenomina_${slug}_${batchId.slice(0, 8)}_${ymd(at).replaceAll("-", "")}.xlsx`;
}

export async function exportFoodPayrollBatch(actor: AuthenticatedUser, batchId: string, raw: unknown, deps: Deps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCapability(actor, "export", client);
  const { externalReference } = parseOrThrow(exportRequestSchema, raw ?? {});
  return client.$transaction(async tx => {
    await requireCapability(actor, "export", tx);
    await lockBatch(tx, batchId);
    const batch = await tx.foodPayrollBatch.findUniqueOrThrow({ where: { id: batchId }, select: {
      id: true, status: true, exportedAt: true, payrollReference: true, generatedAt: true, orderCount: true, employeeCount: true, serviceCount: true, committedAmount: true,
      createdBy: { select: { name: true } },
      items: { orderBy: [{ serviceWeekStart: "asc" }, { employeeNumber: "asc" }], select: {
        orderId: true, employeeNumber: true, employeeName: true, employeeStatusSnapshot: true, inactiveEmployeeReviewed: true, departmentName: true,
        workShiftName: true, serviceWeekStart: true, itemCount: true, historicalUnitPrice: true, committedAmount: true,
        services: { orderBy: { serviceDate: "asc" }, select: { serviceDate: true, serviceType: true, menuItemName: true } },
      } },
    } });
    if (batch.status !== "GENERATED" || batch.exportedAt) throw stateError(batch.status, "exportar");
    const exportedAt = new Date();
    const content = await buildOfficialPayrollWorkbook(batch, exportedAt, actor.name, externalReference);
    const fileSha256 = createHash("sha256").update(content).digest("hex");
    const fileName = fileNameFor(batch.payrollReference, batch.id, exportedAt);
    await tx.foodPayrollBatch.update({ where: { id: batchId }, data: {
      status: "EXPORTED", exportedAt, exportedById: actor.id, fileName, fileSha256, fileContent: content, externalReference: externalReference || null,
    } });
    await tx.foodPayrollAuditEvent.create({ data: { eventType: "BATCH_EXPORTED", batchId, actorId: actor.id, orderCount: batch.orderCount,
      detail: { fileName, fileSha256, bytes: content.length } } });
    return { batchId, status: "EXPORTED" as const, fileName, fileSha256, bytes: content.length, exportedAt: exportedAt.toISOString() };
  }, { maxWait: 10_000, timeout: 60_000 });
}

/** Descarga del archivo oficial registrado; se verifica su SHA-256 antes de entregarlo. */
export async function downloadFoodPayrollExport(actor: AuthenticatedUser, batchId: string, deps: Deps = {}) {
  const client = deps.db ?? defaultDb;
  await requireCapability(actor, "view", client);
  const b = await client.foodPayrollBatch.findUnique({ where: { id: batchId }, select: { fileName: true, fileSha256: true, fileContent: true, exportedAt: true } });
  if (!b?.exportedAt || !b.fileContent || !b.fileName || !b.fileSha256) throw new FoodPayrollBatchError("EXPORT_NOT_FOUND", "El lote no tiene exportación oficial.", 404);
  const body = Buffer.from(b.fileContent);
  if (createHash("sha256").update(body).digest("hex") !== b.fileSha256) throw new FoodPayrollBatchError("EXPORT_INTEGRITY", "El archivo registrado no coincide con su SHA-256.", 500);
  return { fileName: b.fileName, fileSha256: b.fileSha256, body };
}

function parseOrThrow<T>(schema: { parse(v: unknown): T }, raw: unknown) {
  try { return schema.parse(raw); }
  catch (error) {
    const issue = (error as { issues?: Array<{ message: string }> }).issues?.[0]?.message;
    throw new FoodPayrollBatchError("INVALID_REQUEST", issue ?? "Solicitud inválida.", 400);
  }
}
