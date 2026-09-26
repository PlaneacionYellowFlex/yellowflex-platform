import ExcelJS from "exceljs";
import path from "node:path";

export async function exploreWorkbook() {
  const workbook = new ExcelJS.Workbook();

  const filePath =
  "C:\\yellowflex\\data\\active\\oee-master.xlsm";
console.log("Ruta del archivo:", filePath);
  await workbook.xlsx.readFile(filePath);

  console.clear();

  console.log("====================================");
  console.log(" YELLOWFLEX EXCEL EXPLORER");
  console.log("====================================");

  console.log("");

  console.log("Hojas encontradas:");

  workbook.worksheets.forEach((sheet, index) => {
    console.log(`${index + 1}. ${sheet.name}`);
  });

  console.log("");

  return workbook;
}