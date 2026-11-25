/**
 * YF-002-C2 — reportes Excel de control de la conciliación (puros, sin base de datos).
 * Solo informan: generarlos no cambia estados financieros. El Excel oficial del Bloque B/C1 no se toca.
 */
import ExcelJS from "exceljs";
import { centsToDecimal } from "@/lib/food-services/payroll-batch-contract";

export const CONTROL_REPORT_TYPES = ["reconciliation", "differences", "adjustments", "summary"] as const;
export type ControlReportType = (typeof CONTROL_REPORT_TYPES)[number];

export const RESULT_LABEL: Record<string, string> = {
  COMPLETE: "Completo", PARTIAL: "Parcial", NOT_APPLIED: "No aplicado", OVER_APPLIED: "Superior al esperado",
};
export const KIND_LABEL: Record<string, string> = {
  NOT_APPLIED: "Descuento no aplicado", PARTIAL: "Descuento parcial", OVER_APPLIED: "Descuento superior al esperado",
};
export const RESOLUTION_LABEL: Record<string, string> = {
  RECOVERED: "Recuperado en nómina posterior", REFUNDED: "Devuelto al colaborador", COMPENSATED: "Compensado",
  CORRECTED: "Corrección justificada", WAIVED: "Condonado con autorización",
};
export const ADJ_STATUS_LABEL: Record<string, string> = { PENDING: "Pendiente", APPLIED: "Resuelto", VOIDED: "Anulado" };

export type ReportBatch = {
  id: string; payrollReference: string; status: string; orderCount: number; employeeCount: number; committedCents: number;
  exportedAt: Date | null; fileSha256: string | null; closedAt: Date | null; closedBy: string | null; closeNote: string | null;
};
export type ReportReconciliation = {
  id: string; status: string; fileName: string; evidenceSha256: string; externalReference: string | null; actor: string; reconciledAt: Date;
  expectedCents: number; appliedCents: number; coveredCents: number; pendingRecoveryCents: number; pendingRefundCents: number;
  employeeCount: number; completeCount: number; partialCount: number; notAppliedCount: number; overCount: number; closedAt: Date | null;
} | null;
export type ReportEmployee = {
  employeeNumber: string; employeeName: string; orderCount: number; expectedCents: number; appliedCents: number; differenceCents: number;
  result: string; sourceRow: number; note: string | null; covered: boolean; pendingBalanceCents: number;
};
export type ReportAdjustment = {
  id: string; employeeNumber: string; employeeName: string; kind: string; status: string; originalCents: number; appliedCents: number;
  differenceCents: number; balanceCents: number; reason: string; actor: string; createdAt: Date; parentId: string | null;
  resolutionType: string | null; resolvedCents: number | null; resolutionReference: string | null; resolutionNote: string | null;
  resolvedBy: string | null; resolvedAt: Date | null; voidedAt: Date | null; voidReason: string | null;
};
export type ReportInput = {
  batch: ReportBatch; reconciliation: ReportReconciliation; employees: ReportEmployee[]; adjustments: ReportAdjustment[];
  orderStatus: Record<string, number>; generatedAt: Date; generatedBy: string;
};

const BLUE = "FF0B3A82"; const GOLD = "FFF4B400";
const money = (c: number | null) => (c === null ? null : c / 100);
const iso = (d: Date | null) => (d ? d.toISOString() : "");

function style(ws: ExcelJS.Worksheet, moneyKeys: string[] = []) {
  const row = ws.getRow(1);
  row.eachCell(cell => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const k of moneyKeys) ws.getColumn(k).numFmt = "#,##0.00";
}
function totalRow(ws: ExcelJS.Worksheet, values: Record<string, unknown>) {
  const r = ws.addRow(values);
  r.font = { bold: true }; r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } }; });
}

function employeesSheet(wb: ExcelJS.Workbook, name: string, ref: string, rows: ReportEmployee[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { header: "Referencia de prenómina", key: "ref", width: 24 }, { header: "No. colaborador", key: "num", width: 16 },
    { header: "Colaborador", key: "name", width: 32 }, { header: "Pedidos", key: "orders", width: 10 },
    { header: "Importe esperado", key: "exp", width: 16 }, { header: "Importe aplicado", key: "app", width: 16 },
    { header: "Diferencia (aplicado - esperado)", key: "diff", width: 20 }, { header: "Resultado", key: "res", width: 22 },
    { header: "Saldo pendiente vigente", key: "bal", width: 18 }, { header: "Cubierto", key: "cov", width: 10 },
    { header: "Renglón del archivo", key: "row", width: 12 }, { header: "Comentario", key: "note", width: 36 },
  ];
  let e = 0, a = 0, d = 0, b = 0;
  for (const r of rows) {
    e += r.expectedCents; a += r.appliedCents; d += r.differenceCents; b += r.pendingBalanceCents;
    ws.addRow({ ref, num: r.employeeNumber, name: r.employeeName, orders: r.orderCount, exp: money(r.expectedCents), app: money(r.appliedCents),
      diff: money(r.differenceCents), res: RESULT_LABEL[r.result] ?? r.result, bal: money(r.pendingBalanceCents), cov: r.covered ? "Sí" : "No", row: r.sourceRow, note: r.note ?? "" });
  }
  totalRow(ws, { name: `TOTAL (${rows.length} colaboradores)`, exp: money(e), app: money(a), diff: money(d), bal: money(b) });
  style(ws, ["exp", "app", "diff", "bal"]);
}

function adjustmentsSheet(wb: ExcelJS.Workbook, ref: string, rows: ReportAdjustment[]) {
  const ws = wb.addWorksheet("Ajustes");
  ws.columns = [
    { header: "Referencia de prenómina", key: "ref", width: 24 }, { header: "Ajuste", key: "id", width: 38 }, { header: "Ajuste origen", key: "parent", width: 38 },
    { header: "No. colaborador", key: "num", width: 16 }, { header: "Colaborador", key: "name", width: 30 }, { header: "Tipo", key: "kind", width: 28 },
    { header: "Estado", key: "status", width: 12 }, { header: "Importe original", key: "orig", width: 16 }, { header: "Importe aplicado", key: "app", width: 16 },
    { header: "Diferencia", key: "diff", width: 14 }, { header: "Saldo del ajuste (+ recuperar / - devolver)", key: "bal", width: 22 },
    { header: "Motivo", key: "reason", width: 50 }, { header: "Registrado por", key: "actor", width: 22 }, { header: "Fecha de registro", key: "created", width: 24 },
    { header: "Resolución", key: "rtype", width: 28 }, { header: "Importe resuelto", key: "rcents", width: 16 }, { header: "Referencia de resolución", key: "rref", width: 24 },
    { header: "Justificación", key: "rnote", width: 40 }, { header: "Resuelto por", key: "rby", width: 22 }, { header: "Fecha de resolución", key: "rat", width: 24 },
    { header: "Anulado", key: "void", width: 24 }, { header: "Motivo de anulación", key: "vreason", width: 36 },
  ];
  for (const r of rows) {
    ws.addRow({ ref, id: r.id, parent: r.parentId ?? "", num: r.employeeNumber, name: r.employeeName, kind: KIND_LABEL[r.kind] ?? r.kind,
      status: ADJ_STATUS_LABEL[r.status] ?? r.status, orig: money(r.originalCents), app: money(r.appliedCents), diff: money(r.differenceCents),
      bal: money(r.balanceCents), reason: r.reason, actor: r.actor, created: iso(r.createdAt), rtype: r.resolutionType ? RESOLUTION_LABEL[r.resolutionType] ?? r.resolutionType : "",
      rcents: money(r.resolvedCents), rref: r.resolutionReference ?? "", rnote: r.resolutionNote ?? "", rby: r.resolvedBy ?? "", rat: iso(r.resolvedAt),
      void: iso(r.voidedAt), vreason: r.voidReason ?? "" });
  }
  style(ws, ["orig", "app", "diff", "bal", "rcents"]);
}

function summarySheet(wb: ExcelJS.Workbook, input: ReportInput) {
  const { batch, reconciliation: r } = input;
  const ws = wb.addWorksheet("Resumen de cierre");
  ws.columns = [{ header: "Concepto", key: "k", width: 44 }, { header: "Valor", key: "v", width: 64 }];
  const pending = input.adjustments.filter(a => a.status === "PENDING");
  const rec = pending.filter(a => a.balanceCents > 0).reduce((s, a) => s + a.balanceCents, 0);
  const ref = -pending.filter(a => a.balanceCents < 0).reduce((s, a) => s + a.balanceCents, 0);
  const rows: Array<[string, string | number]> = [
    ["Lote", batch.id], ["Referencia de prenómina", batch.payrollReference], ["Estado del lote", batch.status],
    ["Pedidos", batch.orderCount], ["Colaboradores", batch.employeeCount], ["Importe esperado (MXN)", centsToDecimal(batch.committedCents)],
    ["Exportación oficial (SHA-256)", batch.fileSha256 ?? ""], ["Exportado", iso(batch.exportedAt)],
    ["Conciliación", r?.id ?? "Sin conciliación vigente"], ["Archivo de conciliación", r?.fileName ?? ""], ["SHA-256 del archivo de conciliación", r?.evidenceSha256 ?? ""],
    ["Referencia externa de Nómina", r?.externalReference ?? ""], ["Registrada por", r?.actor ?? ""], ["Registrada", iso(r?.reconciledAt ?? null)],
    ["Importe aplicado por Nómina (MXN)", r ? centsToDecimal(r.appliedCents) : ""], ["Importe cubierto (MXN)", r ? centsToDecimal(r.coveredCents) : ""],
    ["Diferencia por recuperar al registrar (MXN)", r ? centsToDecimal(r.pendingRecoveryCents) : ""], ["Diferencia por devolver al registrar (MXN)", r ? centsToDecimal(r.pendingRefundCents) : ""],
    ["Colaboradores completos", r?.completeCount ?? ""], ["Colaboradores con descuento parcial", r?.partialCount ?? ""],
    ["Colaboradores sin descuento aplicado", r?.notAppliedCount ?? ""], ["Colaboradores con descuento superior", r?.overCount ?? ""],
    ["Ajustes pendientes", pending.length], ["Saldo pendiente de recuperar vigente (MXN)", centsToDecimal(rec)], ["Saldo pendiente de devolver vigente (MXN)", centsToDecimal(ref)],
    ["Pedidos PROCESSED (descuento cubierto)", input.orderStatus.PROCESSED ?? 0], ["Pedidos EXPORTED (enviados, no cubiertos)", input.orderStatus.EXPORTED ?? 0],
    ["Pedidos PENDING", input.orderStatus.PENDING ?? 0],
    ["Cierre administrativo", iso(batch.closedAt)], ["Cerrado por", batch.closedBy ?? ""], ["Nota de cierre", batch.closeNote ?? ""],
    ["Reporte generado", input.generatedAt.toISOString()], ["Generado por", input.generatedBy],
    ["Aviso", "Reporte de control. Generarlo no cambia estados. Cerrar el lote no liquida diferencias: los ajustes pendientes siguen vigentes."],
  ];
  for (const [k, v] of rows) ws.addRow({ k, v });
  style(ws);
}

export async function buildControlReport(type: ControlReportType, input: ReportInput) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "YellowFlex Platform"; wb.created = input.generatedAt; wb.modified = input.generatedAt;
  const ref = input.batch.payrollReference;
  if (type === "reconciliation") employeesSheet(wb, "Conciliación por colaborador", ref, input.employees);
  else if (type === "differences") employeesSheet(wb, "Diferencias detectadas", ref, input.employees.filter(e => e.result !== "COMPLETE"));
  else if (type === "adjustments") adjustmentsSheet(wb, ref, input.adjustments);
  else {
    summarySheet(wb, input);
    employeesSheet(wb, "Diferencias detectadas", ref, input.employees.filter(e => e.result !== "COMPLETE"));
    adjustmentsSheet(wb, ref, input.adjustments);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function controlFileName(type: ControlReportType, reference: string, batchId: string, at: Date) {
  const slug = reference.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "prenomina";
  const label = { reconciliation: "Conciliacion", differences: "Diferencias", adjustments: "Ajustes", summary: "ResumenCierre" }[type];
  return `${label}_${slug}_${batchId.slice(0, 8)}_${at.toISOString().slice(0, 10).replaceAll("-", "")}.xlsx`;
}
