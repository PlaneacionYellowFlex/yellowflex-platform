import ExcelJS from "exceljs";
import path from "node:path";

type CellValue = ExcelJS.CellValue;
type RowData = {
  rowNumber:number; location:string; code:string; description:string;
  quantity:number|null; unit:string; issues:string[]; importable:boolean;
};

const UNIT_OVERRIDES = new Map([
  ["33-013-063*2579","PIEZAS"],
  ["33-003-057*2577","PIEZAS"],
]);
const VALID_UNITS = new Set(["PIEZAS","KG"]);

function text(value:CellValue):string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return text(value.result as CellValue);
    if ("richText" in value && Array.isArray(value.richText))
      return value.richText.map((p) => p.text ?? "").join("").trim();
    if ("text" in value && typeof value.text === "string") return value.text.trim();
  }
  return "";
}

function numeric(value:CellValue):number|null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "result" in value &&
      typeof value.result === "number" && Number.isFinite(value.result)) return value.result;
  return null;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error("Debes indicar la ruta del archivo LAYOUT OCT.xlsx.");

  const inputPath = path.resolve(arg);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const sheet = workbook.getWorksheet("LAYOUT");
  if (!sheet) throw new Error('No existe la hoja "LAYOUT".');

  const rows:RowData[] = [];
  let currentLocation = "";

  for (let n=3; n<=sheet.rowCount; n++) {
    const row=sheet.getRow(n);
    const explicit=text(row.getCell(1).value);
    if (explicit) currentLocation=explicit.toUpperCase();

    const rawCode=text(row.getCell(2).value);
    if (!rawCode) continue;

    const code=rawCode.toUpperCase();
    const description=text(row.getCell(3).value);
    const quantity=numeric(row.getCell(4).value);
    let unit=text(row.getCell(5).value).toUpperCase();
    if (!unit && UNIT_OVERRIDES.has(code)) unit=UNIT_OVERRIDES.get(code)!;

    const issues:string[]=[];
    if (!currentLocation) issues.push("SIN_UBICACION");
    if (code==="N/A") issues.push("CODIGO_NA");
    if (quantity===null) issues.push("CANTIDAD_NO_NUMERICA_O_VACIA");
    else if (quantity<0) issues.push("CANTIDAD_NEGATIVA");
    else if (quantity===0) issues.push("CANTIDAD_CERO");
    if (!unit) issues.push("UNIDAD_VACIA");
    else if (!VALID_UNITS.has(unit)) issues.push("UNIDAD_NO_RECONOCIDA");

    const expectedExclusions=new Set([
      "CODIGO_NA","CANTIDAD_NO_NUMERICA_O_VACIA","UNIDAD_VACIA","CANTIDAD_CERO"
    ]);
    const blocking=issues.filter((x)=>!expectedExclusions.has(x));
    const importable=code!=="N/A" && quantity!==null && quantity>0 &&
      !!unit && VALID_UNITS.has(unit) && blocking.length===0;

    rows.push({rowNumber:n,location:currentLocation,code,description,quantity,unit,issues,importable});
  }

  const imports=rows.filter(r=>r.importable);
  const excluded=rows.filter(r=>!r.importable);
  const locations=[...new Set(rows.map(r=>r.location).filter(Boolean))].sort();
  const codes=[...new Set(rows.map(r=>r.code).filter(c=>c!=="N/A"))].sort();
  const importCodes=[...new Set(imports.map(r=>r.code))].sort();

  const issueCounts=new Map<string,number>();
  excluded.forEach(r=>r.issues.forEach(i=>issueCounts.set(i,(issueCounts.get(i)??0)+1)));

  const unitsByCode=new Map<string,Set<string>>();
  imports.forEach(r=>{
    const s=unitsByCode.get(r.code)??new Set<string>();
    s.add(r.unit); unitsByCode.set(r.code,s);
  });
  const conflicts=[...unitsByCode].filter(([,u])=>u.size>1);
  const pairs=new Set(imports.map(r=>`${r.location}|||${r.code}`));

  const totals=new Map<string,number>();
  imports.forEach(r=>totals.set(r.unit,(totals.get(r.unit)??0)+(r.quantity??0)));

  console.log("\nYELLOWFLEX — SIMULACIÓN DE CARGA INICIAL DE ALMACÉN");
  console.log("===================================================");
  console.log(`Archivo: ${inputPath}`);
  console.log("NO SE ESCRIBIÓ NADA EN POSTGRESQL.\n");
  console.log("RESUMEN");
  console.log(`Filas con código: ${rows.length}`);
  console.log(`Ubicaciones físicas detectadas: ${locations.length}`);
  console.log(`Códigos reales únicos: ${codes.length}`);
  console.log(`Códigos importables únicos: ${importCodes.length}`);
  console.log(`Filas que generarían INITIAL_BALANCE: ${imports.length}`);
  console.log(`Pares ubicación/código: ${pairs.size}`);
  console.log(`Filas excluidas/revisión: ${excluded.length}\n`);

  console.log("TOTALES POR UNIDAD");
  [...totals].sort().forEach(([u,q])=>console.log(`- ${u}: ${q.toLocaleString("es-MX")}`));

  console.log("\nCORRECCIONES AUTORIZADAS");
  UNIT_OVERRIDES.forEach((u,c)=>{
    const found=imports.filter(r=>r.code===c);
    console.log(`- ${c}: ${u} | filas importables=${found.length}`);
  });

  console.log("\nINCIDENCIAS / EXCLUSIONES");
  [...issueCounts].sort().forEach(([i,n])=>console.log(`- ${i}: ${n}`));

  console.log("\nCONFLICTOS DE UNIDAD POR CÓDIGO");
  if (!conflicts.length) console.log("- Ninguno");
  else conflicts.forEach(([c,u])=>console.log(`- ${c}: ${[...u].join(", ")}`));

  console.log("\nPRIMEROS 20 INITIAL_BALANCE");
  imports.slice(0,20).forEach(r=>console.log(
    `fila=${r.rowNumber} | ubicacion=${r.location} | codigo=${r.code} | cantidad=${r.quantity} | unidad=${r.unit} | ${r.description}`
  ));

  const unexpected=excluded.filter(r=>r.issues.some(i=>
    !["CODIGO_NA","CANTIDAD_NO_NUMERICA_O_VACIA","UNIDAD_VACIA","CANTIDAD_CERO"].includes(i)
  ));

  console.log("\nRESULTADO");
  if (conflicts.length || unexpected.length) {
    console.log(`REVISIÓN REQUERIDA. Conflictos unidad=${conflicts.length}; filas estructurales=${unexpected.length}.`);
    console.log("NO ejecutar carga real.");
    process.exitCode=2;
  } else {
    console.log("SIMULACIÓN APROBABLE.");
    console.log("N/A, cantidades vacías y cantidades cero quedan fuera de la carga.");
    console.log("Todavía no se ha creado ningún movimiento.");
  }
}

main().catch(e=>{
  console.error("\nERROR EN LA SIMULACIÓN");
  console.error(e);
  process.exitCode=1;
});
