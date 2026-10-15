import ExcelJS from "exceljs";
import path from "node:path";

type AuditRow = {
  excelRow: number;
  location: string;
  code: string;
  description: string;
  quantity: number | null;
  unit: string;
  line: string;
  process: string;
  segmentation: string;
  observations: string;
  importable: boolean;
  issues: string[];
};

function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "result" in value) {
    const result = value.result;
    return result === null || result === undefined ? "" : String(result).trim();
  }
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  return String(value).trim();
}

function numeric(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "result" in value) {
    const result = value.result;
    if (typeof result === "number" && Number.isFinite(result)) return result;
  }
  return null;
}

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    throw new Error('Uso: npx tsx scripts/audit-warehouse-layout.ts "C:\\ruta\\LAYOUT OCT.xlsx"');
  }

  const inputPath = path.resolve(inputArg);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  const sheet = workbook.getWorksheet("LAYOUT");
  if (!sheet) throw new Error('No existe la hoja "LAYOUT".');

  const rows: AuditRow[] = [];
  let currentLocation = "";

  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const explicitLocation = text(row.getCell(1).value);
    if (explicitLocation) currentLocation = explicitLocation;

    const code = text(row.getCell(2).value);
    if (!code) continue;

    const quantity = numeric(row.getCell(4).value);
    const unit = text(row.getCell(5).value).toUpperCase();
    const issues: string[] = [];

    if (!currentLocation) issues.push("SIN_UBICACION");
    if (code.toUpperCase() === "N/A") issues.push("CODIGO_NA");
    if (quantity === null) issues.push("CANTIDAD_NO_NUMERICA_O_VACIA");
    if (quantity !== null && quantity < 0) issues.push("CANTIDAD_NEGATIVA");
    if (quantity === 0) issues.push("CANTIDAD_CERO");
    if (!unit) issues.push("UNIDAD_VACIA");
    if (unit && unit !== "PIEZAS" && unit !== "KG") issues.push("UNIDAD_NO_RECONOCIDA");

    const blockingIssues = issues.filter(
      (issue) =>
        issue !== "CANTIDAD_CERO",
    );

    rows.push({
      excelRow: rowNumber,
      location: currentLocation,
      code,
      description: text(row.getCell(3).value),
      quantity,
      unit,
      line: text(row.getCell(6).value),
      process: text(row.getCell(7).value),
      segmentation: text(row.getCell(8).value),
      observations: text(row.getCell(10).value),
      importable: blockingIssues.length === 0 && quantity !== null && quantity > 0,
      issues,
    });
  }

  const uniqueLocations = new Set(rows.map((row) => row.location).filter(Boolean));
  const uniqueCodes = new Set(
    rows.filter((row) => row.code.toUpperCase() !== "N/A").map((row) => row.code),
  );
  const importableRows = rows.filter((row) => row.importable);
  const reviewRows = rows.filter((row) => !row.importable);

  const issueCounts = new Map<string, number>();
  for (const row of rows) {
    for (const issue of row.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }
  }

  console.log("");
  console.log("YELLOWFLEX — AUDITORÍA DE LAYOUT DE ALMACÉN");
  console.log("Archivo:", inputPath);
  console.log("Hoja: LAYOUT");
  console.log("");
  console.log("Renglones con código:", rows.length);
  console.log("Ubicaciones físicas únicas:", uniqueLocations.size);
  console.log("Códigos reales únicos:", uniqueCodes.size);
  console.log("Renglones importables (> 0):", importableRows.length);
  console.log("Renglones que requieren revisión:", reviewRows.length);
  console.log("");
  console.log("INCIDENCIAS");

  if (issueCounts.size === 0) {
    console.log("Sin incidencias.");
  } else {
    for (const [issue, count] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`- ${issue}: ${count}`);
    }
  }

  console.log("");
  console.log("MUESTRA DE RENGLONES A REVISAR");
  for (const row of reviewRows.slice(0, 25)) {
    console.log(
      `Fila ${row.excelRow} | ${row.location || "SIN UBICACIÓN"} | ${row.code} | ${row.quantity ?? "SIN CANTIDAD"} ${row.unit} | ${row.issues.join(", ")}`,
    );
  }

  console.log("");
  console.log("AUDITORÍA TERMINADA. NO SE MODIFICÓ POSTGRESQL.");
}

main().catch((error) => {
  console.error("ERROR DE AUDITORÍA:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
