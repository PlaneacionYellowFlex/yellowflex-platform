/**
 * YF-002-C2 — contrato puro de conciliación de prenómina (sin base de datos).
 * Plantilla Excel, lectura estricta del archivo de Nómina, comparación esperado contra aplicado por colaborador,
 * token firmado de vista previa y huella de idempotencia. Importes siempre en centavos enteros.
 * Reglas: una fila ausente NO es descuento cero; el cero debe capturarse explícitamente.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import { canonicalJson, centsToDecimal, sha256Hex } from "@/lib/food-services/payroll-batch-contract";

export const RECONCILIATION_CONTRACT_VERSION = 1;
export const RECONCILIATION_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const RECONCILIATION_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const RECONCILIATION_MAX_ROWS = 20_000;
export const MAX_EMPLOYEE_CENTS = 999_999_999; // 9,999,999.99 por colaborador
export const TEMPLATE_SHEET = "Conciliación";

export type ReconciliationResult = "COMPLETE" | "PARTIAL" | "NOT_APPLIED" | "OVER_APPLIED";

export class ReconciliationContractError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ReconciliationContractError"; }
}

// ------------------------------------------------------------------ esperado por colaborador (fuente: snapshots del lote)
export type ExpectedEmployee = {
  employeeId: string; employeeNumber: string; employeeName: string; orderCount: number; expectedCents: number;
};

export type BatchContext = { id: string; payrollReference: string };

// ------------------------------------------------------------------ plantilla
const COLUMNS = [
  { key: "ref", header: "Referencia de prenómina", width: 24 },
  { key: "batch", header: "Lote", width: 30 },
  { key: "num", header: "No. colaborador", width: 18 },
  { key: "name", header: "Colaborador", width: 34 },
  { key: "orders", header: "Pedidos", width: 10 },
  { key: "expected", header: "Importe esperado", width: 16 },
  { key: "applied", header: "Importe aplicado por Nómina", width: 22 },
  { key: "note", header: "Comentario", width: 36 },
] as const;

export async function buildReconciliationTemplate(batch: BatchContext, expected: readonly ExpectedEmployee[], meta: { generatedAt: Date; generatedBy: string }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "YellowFlex Platform"; wb.created = meta.generatedAt; wb.modified = meta.generatedAt;
  const blue = "FF0B3A82"; const gold = "FFF4B400";
  const ws = wb.addWorksheet(TEMPLATE_SHEET);
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  const sorted = [...expected].sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, "es"));
  for (const e of sorted) {
    ws.addRow({ ref: batch.payrollReference, batch: batch.id, num: e.employeeNumber, name: e.employeeName, orders: e.orderCount,
      expected: e.expectedCents / 100, applied: null, note: null });
  }
  ws.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } }; });
  ws.getRow(1).getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: gold } };
  ws.getRow(1).getCell(7).font = { bold: true, color: { argb: blue } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.getColumn("num").numFmt = "@";
  ws.getColumn("expected").numFmt = "#,##0.00";
  ws.getColumn("applied").numFmt = "#,##0.00";
  for (let r = 2; r <= sorted.length + 1; r++) {
    ws.getCell(`G${r}`).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true,
      showErrorMessage: true, errorTitle: "Importe inválido", error: "Captura el importe aplicado (0 si Nómina no aplicó el descuento)." };
  }

  const ins = wb.addWorksheet("Instrucciones");
  ins.columns = [{ header: "Instrucciones de conciliación", key: "t", width: 120 }];
  for (const t of [
    "1. Captura en la columna 'Importe aplicado por Nómina' el descuento que Nómina aplicó realmente a cada colaborador.",
    "2. Si Nómina no aplicó el descuento, captura 0 (cero) explícitamente. Una celda vacía se considera información faltante y bloquea la conciliación.",
    "3. No elimines colaboradores: cada colaborador del lote debe aparecer exactamente una vez. No agregues colaboradores de otros lotes.",
    "4. No modifiques la referencia de prenómina, el lote ni el importe esperado. Usa importes con máximo 2 decimales, sin signo negativo.",
    "5. La columna 'Comentario' es opcional (máximo 500 caracteres) y se conserva como evidencia.",
    "6. Importa el archivo en Food Services → Prenómina → Conciliación y cierre. La vista previa muestra diferencias antes de confirmar.",
  ]) ins.addRow({ t });
  ins.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ins.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } };

  const ctl = wb.addWorksheet("Control");
  ctl.columns = [{ header: "Concepto", key: "k", width: 34 }, { header: "Valor", key: "v", width: 60 }];
  const total = sorted.reduce((s, e) => s + e.expectedCents, 0);
  for (const [k, v] of [
    ["Lote", batch.id], ["Referencia de prenómina", batch.payrollReference], ["Colaboradores", sorted.length],
    ["Importe esperado total (MXN)", centsToDecimal(total)], ["Plantilla generada", meta.generatedAt.toISOString()],
    ["Generada por", meta.generatedBy], ["Aviso", "Plantilla de control. Descargarla no cambia estados ni aplica descuentos."],
  ] as Array<[string, string | number]>) ctl.addRow({ k, v });
  ctl.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ctl.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: blue } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ lectura estricta del archivo
export type ParsedRow = {
  row: number; reference: string; batchId: string; employeeNumber: string; name: string;
  expected: AmountCell; applied: AmountCell; note: string;
};
export type AmountCell = { kind: "missing" } | { kind: "invalid"; raw: string } | { kind: "ok"; cents: number };

const normalizeHeader = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.:]/g, " ").replace(/\s+/g, " ").trim();
const HEADER_ALIASES: Record<string, readonly string[]> = {
  ref: ["referencia de prenomina", "referencia"],
  batch: ["lote"],
  num: ["no colaborador", "numero de colaborador", "no empleado", "numero de empleado", "num colaborador"],
  name: ["colaborador", "nombre"],
  orders: ["pedidos"],
  expected: ["importe esperado"],
  applied: ["importe aplicado por nomina", "importe aplicado", "descuento aplicado"],
  note: ["comentario", "comentarios"],
};
const REQUIRED_HEADERS = ["ref", "num", "applied"] as const;

type CellRaw = string | number | boolean | Date | null | { error: string };

function rawCell(value: ExcelJS.CellValue): CellRaw {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  const v = value as unknown as Record<string, unknown>;
  if ("error" in v) return { error: String(v.error) };
  if ("result" in v) return rawCell(v.result as ExcelJS.CellValue);
  if ("richText" in v && Array.isArray(v.richText)) return (v.richText as Array<{ text: string }>).map(t => t.text).join("");
  if ("text" in v) return String(v.text);
  return null;
}

function text(value: CellRaw) {
  if (value === null) return "";
  if (typeof value === "object" && !(value instanceof Date)) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/** Importe con máximo 2 decimales, no negativo. Acepta número o texto ("1,234.50", "$80"). */
export function parseAmountCell(value: CellRaw): AmountCell {
  if (value === null || (typeof value === "string" && value.trim() === "")) return { kind: "missing" };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return { kind: "invalid", raw: String(value) };
    const cents = Math.round(value * 100);
    if (Math.abs(value * 100 - cents) > 1e-6 || cents > MAX_EMPLOYEE_CENTS) return { kind: "invalid", raw: String(value) };
    return { kind: "ok", cents };
  }
  if (typeof value === "string") {
    const s = value.trim().replace(/^\$\s*/, "");
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(s)) return { kind: "invalid", raw: value.trim().slice(0, 40) };
    const [whole, fraction = ""] = s.replace(/,/g, "").split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents) || cents > MAX_EMPLOYEE_CENTS) return { kind: "invalid", raw: value.trim().slice(0, 40) };
    return { kind: "ok", cents };
  }
  return { kind: "invalid", raw: value instanceof Date ? "fecha" : typeof value === "object" ? "error de fórmula" : String(value) };
}

export async function parseReconciliationWorkbook(file: Buffer): Promise<ParsedRow[]> {
  if (!file.length) throw new ReconciliationContractError("FILE_EMPTY", "El archivo está vacío.");
  if (file.length > RECONCILIATION_MAX_FILE_BYTES) throw new ReconciliationContractError("FILE_TOO_LARGE", "El archivo supera 5 MB.");
  if (file[0] !== 0x50 || file[1] !== 0x4b) throw new ReconciliationContractError("FILE_FORMAT", "El archivo debe ser un Excel .xlsx (la plantilla de conciliación).");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(file as unknown as ArrayBuffer); }
  catch { throw new ReconciliationContractError("FILE_FORMAT", "No fue posible leer el archivo como Excel .xlsx."); }
  const ws = wb.worksheets.find(w => normalizeHeader(w.name) === normalizeHeader(TEMPLATE_SHEET));
  if (!ws) throw new ReconciliationContractError("STRUCTURE_INVALID", `El archivo no contiene la hoja '${TEMPLATE_SHEET}'.`);
  const columns: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  const seen = new Set<string>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const h = normalizeHeader(text(rawCell(cell.value)));
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(h)) {
        if (seen.has(key)) throw new ReconciliationContractError("STRUCTURE_INVALID", `Columna repetida en el encabezado: '${cell.text}'.`);
        seen.add(key); columns[key as keyof typeof HEADER_ALIASES] = col;
      }
    }
  });
  const missing = REQUIRED_HEADERS.filter(k => !columns[k]);
  if (missing.length) {
    throw new ReconciliationContractError("STRUCTURE_INVALID",
      `Faltan columnas obligatorias: ${missing.map(k => ({ ref: "Referencia de prenómina", num: "No. colaborador", applied: "Importe aplicado por Nómina" })[k as "ref" | "num" | "applied"]).join(", ")}.`);
  }
  const rows: ParsedRow[] = [];
  const at = (r: ExcelJS.Row, key: keyof typeof HEADER_ALIASES) => (columns[key] ? rawCell(r.getCell(columns[key]!).value) : null);
  for (let i = 2; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const values = (Object.keys(columns) as Array<keyof typeof HEADER_ALIASES>).map(k => at(r, k));
    if (values.every(v => v === null || text(v) === "")) continue;
    if (rows.length >= RECONCILIATION_MAX_ROWS) throw new ReconciliationContractError("FILE_TOO_LARGE", `El archivo supera ${RECONCILIATION_MAX_ROWS} renglones.`);
    const num = at(r, "num");
    rows.push({
      row: i, reference: text(at(r, "ref")), batchId: text(at(r, "batch")),
      employeeNumber: typeof num === "number" && Number.isInteger(num) ? String(num) : text(num),
      name: text(at(r, "name")).slice(0, 200),
      expected: columns.expected ? parseAmountCell(at(r, "expected")) : { kind: "missing" },
      applied: parseAmountCell(at(r, "applied")),
      note: text(at(r, "note")).slice(0, 500),
    });
  }
  return rows;
}

// ------------------------------------------------------------------ comparación esperado contra aplicado
export type ReconciliationIssue = { code: string; row: number | null; employeeNumber: string | null; message: string };
export type ComparedRow = ExpectedEmployee & {
  appliedCents: number; differenceCents: number; result: ReconciliationResult; sourceRow: number; note: string | null; matchedBy: "exact" | "leading-zeros";
};
export type ComparisonTotals = {
  employees: number; expectedCents: number; appliedCents: number; coveredCents: number; pendingRecoveryCents: number; pendingRefundCents: number;
  differenceCents: number; complete: number; partial: number; notApplied: number; overApplied: number;
};
export type Comparison = {
  rowsRead: number; errors: ReconciliationIssue[]; warnings: ReconciliationIssue[];
  missing: Array<ExpectedEmployee>; rows: ComparedRow[]; totals: ComparisonTotals; digest: string;
};

export function classifyAmount(expectedCents: number, appliedCents: number): ReconciliationResult {
  if (appliedCents === expectedCents) return "COMPLETE";
  if (appliedCents === 0) return "NOT_APPLIED";
  return appliedCents < expectedCents ? "PARTIAL" : "OVER_APPLIED";
}

const stripZeros = (v: string) => (/^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, "") : null);

export function compareReconciliation(batch: BatchContext, expected: readonly ExpectedEmployee[], parsed: readonly ParsedRow[]): Comparison {
  const errors: ReconciliationIssue[] = []; const warnings: ReconciliationIssue[] = [];
  const byNumber = new Map(expected.map(e => [e.employeeNumber, e]));
  const byStripped = new Map<string, ExpectedEmployee[]>();
  for (const e of expected) { const k = stripZeros(e.employeeNumber); if (k !== null) byStripped.set(k, [...(byStripped.get(k) ?? []), e]); }
  const firstRow = new Map<string, number>();
  const matched = new Map<string, ComparedRow>();
  for (const p of parsed) {
    const issue = (code: string, message: string) => errors.push({ code, row: p.row, employeeNumber: p.employeeNumber || null, message });
    if (!p.employeeNumber) { issue("EMPLOYEE_NUMBER_MISSING", "Renglón sin número de colaborador."); continue; }
    if (p.reference !== batch.payrollReference) issue("REFERENCE_MISMATCH", `La referencia '${p.reference || "(vacía)"}' no corresponde al lote '${batch.payrollReference}'.`);
    if (p.batchId && p.batchId !== batch.id) issue("BATCH_MISMATCH", "El renglón pertenece a otro lote.");
    let e = byNumber.get(p.employeeNumber); let matchedBy: ComparedRow["matchedBy"] = "exact";
    if (!e) {
      const k = stripZeros(p.employeeNumber); const candidates = k === null ? [] : byStripped.get(k) ?? [];
      if (candidates.length === 1) { e = candidates[0]; matchedBy = "leading-zeros"; }
    }
    if (!e) { issue("UNKNOWN_EMPLOYEE", `El colaborador ${p.employeeNumber} no pertenece a este lote.`); continue; }
    const prev = firstRow.get(e.employeeId);
    if (prev !== undefined) { issue("DUPLICATE_EMPLOYEE", `Colaborador ${e.employeeNumber} repetido (también en el renglón ${prev}).`); continue; }
    firstRow.set(e.employeeId, p.row);
    if (matchedBy === "leading-zeros") warnings.push({ code: "MATCHED_IGNORING_ZEROS", row: p.row, employeeNumber: p.employeeNumber, message: `Se identificó como ${e.employeeNumber} (ceros a la izquierda).` });
    if (p.expected.kind === "invalid" || (p.expected.kind === "ok" && p.expected.cents !== e.expectedCents)) {
      issue("EXPECTED_MISMATCH", `El importe esperado del archivo no coincide con el lote (${centsToDecimal(e.expectedCents)}).`);
    }
    if (p.applied.kind === "missing") { issue("AMOUNT_MISSING", "Importe aplicado vacío: captura 0 si Nómina no aplicó el descuento."); continue; }
    if (p.applied.kind === "invalid") { issue("AMOUNT_INVALID", `Importe aplicado inválido ('${p.applied.raw}'): usa un número no negativo con máximo 2 decimales.`); continue; }
    const appliedCents = p.applied.cents;
    matched.set(e.employeeId, { ...e, appliedCents, differenceCents: appliedCents - e.expectedCents, result: classifyAmount(e.expectedCents, appliedCents),
      sourceRow: p.row, note: p.note || null, matchedBy });
  }
  const missing = expected.filter(e => !firstRow.has(e.employeeId));
  for (const m of missing) errors.push({ code: "EMPLOYEE_MISSING", row: null, employeeNumber: m.employeeNumber, message: `Falta el colaborador ${m.employeeNumber} (${m.employeeName}); una fila ausente no equivale a descuento cero.` });
  const rows = [...matched.values()].sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, "es"));
  const totals: ComparisonTotals = { employees: expected.length, expectedCents: 0, appliedCents: 0, coveredCents: 0, pendingRecoveryCents: 0,
    pendingRefundCents: 0, differenceCents: 0, complete: 0, partial: 0, notApplied: 0, overApplied: 0 };
  for (const e of expected) totals.expectedCents += e.expectedCents;
  for (const r of rows) {
    totals.appliedCents += r.appliedCents; totals.coveredCents += Math.min(r.appliedCents, r.expectedCents);
    if (r.result === "COMPLETE") totals.complete++; else if (r.result === "PARTIAL") totals.partial++;
    else if (r.result === "NOT_APPLIED") totals.notApplied++; else totals.overApplied++;
  }
  totals.pendingRecoveryCents = totals.expectedCents - totals.coveredCents;
  totals.pendingRefundCents = totals.appliedCents - totals.coveredCents;
  totals.differenceCents = totals.appliedCents - totals.expectedCents;
  const digest = sha256Hex(canonicalJson({ batch: batch.id, reference: batch.payrollReference,
    rows: [...rows].sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1)).map(r => [r.employeeId, r.expectedCents, r.appliedCents, r.sourceRow, r.note]) }));
  return { rowsRead: parsed.length, errors, warnings, missing, rows, totals, digest };
}

// ------------------------------------------------------------------ token firmado e idempotencia
export const reconciliationMetaSchema = z.object({
  fileName: z.string().trim().min(1, "Nombre de archivo obligatorio.").max(255),
  externalReference: z.string().trim().max(160).optional(),
  previewToken: z.string().min(20).max(4000),
}).strict();

export type ReconciliationTokenPayload = {
  k: "RC"; v: number; a: string; b: string; f: string; d: string; s: string; iat: number; exp: number;
};

function secret(value = process.env.FOOD_PAYROLL_PREVIEW_SECRET) {
  if (!value || value.length < 32) {
    throw new ReconciliationContractError("PREVIEW_SECRET_MISSING", "FOOD_PAYROLL_PREVIEW_SECRET no está configurado (mínimo 32 caracteres).");
  }
  return value;
}
const DOMAIN = "yf-payroll-reconciliation.v1.";

export function signReconciliationToken(payload: ReconciliationTokenPayload, key?: string) {
  const body = Buffer.from(canonicalJson(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret(key)).update(DOMAIN + body).digest("base64url")}`;
}

export function verifyReconciliationToken(token: string, key?: string): ReconciliationTokenPayload & { expired: boolean } {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) throw new ReconciliationContractError("PREVIEW_INVALID", "Token de vista previa inválido.");
  const expected = createHmac("sha256", secret(key)).update(DOMAIN + body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new ReconciliationContractError("PREVIEW_INVALID", "Token de vista previa inválido o alterado.");
  }
  let payload: ReconciliationTokenPayload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { throw new ReconciliationContractError("PREVIEW_INVALID", "Token de vista previa ilegible."); }
  if (payload.k !== "RC" || payload.v !== RECONCILIATION_CONTRACT_VERSION || typeof payload.exp !== "number") {
    throw new ReconciliationContractError("PREVIEW_INVALID", "El token no corresponde a una vista previa de conciliación.");
  }
  return { ...payload, expired: Date.now() > payload.exp };
}

/** Huella del estado de conciliación del lote: cambia si otra conciliación se registró o se anuló después de la vista previa. */
export function reconciliationStateTag(batch: { id: string; status: string }, reconciliations: ReadonlyArray<{ id: string; voidedAt: Date | null }>) {
  return sha256Hex(canonicalJson({ batch: batch.id, status: batch.status,
    reconciliations: reconciliations.map(r => [r.id, r.voidedAt ? r.voidedAt.toISOString() : null]).sort() }));
}

export function reconciliationRequestHash(input: { actorId: string; batchId: string; fileSha256: string; digest: string; externalReference: string | null }) {
  return sha256Hex(canonicalJson({ mode: "RECONCILIATION", contractVersion: RECONCILIATION_CONTRACT_VERSION, ...input }));
}

// ------------------------------------------------------------------ resolución de ajustes
export const resolutionTypes = ["RECOVERED", "REFUNDED", "COMPENSATED", "CORRECTED", "WAIVED"] as const;
export type ResolutionType = (typeof resolutionTypes)[number];

export const resolveAdjustmentSchema = z.object({
  resolutionType: z.enum(resolutionTypes),
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Importe inválido (máximo 2 decimales)."),
  reference: z.string().trim().max(160).optional(),
  note: z.string().trim().min(10, "La justificación debe tener al menos 10 caracteres.").max(1000),
}).strict();

/** Reglas de resolución por tipo de ajuste. Devuelve el saldo remanente en centavos (0 si se liquida). */
export function validateResolution(kind: string, balanceCents: number, type: ResolutionType, amountCents: number, reference: string | undefined) {
  const recover = kind === "NOT_APPLIED" || kind === "PARTIAL";
  const allowed: readonly ResolutionType[] = recover ? ["RECOVERED", "CORRECTED", "WAIVED"] : ["REFUNDED", "COMPENSATED", "CORRECTED"];
  if (!allowed.includes(type)) throw new ReconciliationContractError("RESOLUTION_INVALID", "Tipo de resolución no válido para este ajuste.");
  const abs = Math.abs(balanceCents);
  if (amountCents <= 0 || amountCents > abs) throw new ReconciliationContractError("RESOLUTION_INVALID", `El importe debe ser mayor que cero y no exceder el saldo (${centsToDecimal(abs)}).`);
  if ((type === "CORRECTED" || type === "WAIVED") && amountCents !== abs) {
    throw new ReconciliationContractError("RESOLUTION_INVALID", "Una corrección o condonación liquida el saldo completo.");
  }
  if (type !== "WAIVED" && (!reference || reference.trim().length < 3)) {
    throw new ReconciliationContractError("RESOLUTION_INVALID", "La referencia de resolución es obligatoria (folio de nómina, transferencia o evidencia).");
  }
  return abs - amountCents;
}
