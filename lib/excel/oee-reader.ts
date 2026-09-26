import path from "node:path";

import ExcelJS from "exceljs";

import type {
  MachineUtilizationRecord,
  OeeOperationalRecord,
  OeeWorkbookData,
  WeeklyOeeRecord,
} from "@/types/oee";

const OEE_SHEET_PATTERN = /^OEE Semana(\d+)$/i;
const REGISTER_SHEET_PATTERN = /^RegistroSemana(\d+)$/i;

function getCalculatedNumber(cell: ExcelJS.Cell): number | null {
  const value = cell.value;

  if (
    value &&
    typeof value === "object" &&
    "result" in value &&
    value.result !== undefined &&
    value.result !== null
  ) {
    const result = value.result;

    if (typeof result === "number") {
      return Number.isFinite(result) ? result : null;
    }

    const resultText = String(result).trim();
    const parsedResult = Number(
      resultText.replace(/,/g, "").replace("%", "").trim(),
    );

    if (!Number.isFinite(parsedResult)) {
      return null;
    }

    return resultText.includes("%")
      ? parsedResult / 100
      : parsedResult;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = cell.text.trim();

  if (text === "") {
    return null;
  }

  const parsed = Number(
    text.replace(/,/g, "").replace("%", "").trim(),
  );

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return text.includes("%") ? parsed / 100 : parsed;
}

function getText(cell: ExcelJS.Cell): string {
  const value = cell.value;

  if (
    value &&
    typeof value === "object" &&
    "result" in value &&
    value.result !== undefined &&
    value.result !== null
  ) {
    return String(value.result).replace(/\s+/g, " ").trim();
  }

  return cell.text.replace(/\s+/g, " ").trim();
}

function getDateText(cell: ExcelJS.Cell): string | null {
  const value = cell.value;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value &&
    typeof value === "object" &&
    "result" in value &&
    value.result instanceof Date
  ) {
    return value.result.toISOString();
  }

  const text = cell.text.trim();
  return text === "" ? null : text;
}

function getWeekFromSheetName(
  sheetName: string,
  pattern: RegExp,
): number | null {
  const match = sheetName.match(pattern);

  if (!match) {
    return null;
  }

  const week = Number(match[1]);

  return Number.isInteger(week) && week >= 1 && week <= 53
    ? week
    : null;
}

function findTotalGeneralRow(
  worksheet: ExcelJS.Worksheet,
): number | null {
  const bottom = worksheet.dimensions?.bottom ?? worksheet.rowCount;

  for (let rowNumber = bottom; rowNumber >= 1; rowNumber -= 1) {
    const label = getText(worksheet.getCell(`A${rowNumber}`))
      .toLocaleUpperCase("es-MX");

    if (label === "TOTAL GENERAL") {
      return rowNumber;
    }
  }

  return null;
}

function readWeeklyOee(
  worksheet: ExcelJS.Worksheet,
  week: number,
): WeeklyOeeRecord | null {
  const totalRow = findTotalGeneralRow(worksheet);

  if (totalRow === null) {
    return null;
  }

  const availability = getCalculatedNumber(
    worksheet.getCell(`I${totalRow}`),
  );
  const performance = getCalculatedNumber(
    worksheet.getCell(`J${totalRow}`),
  );
  const quality = getCalculatedNumber(
    worksheet.getCell(`K${totalRow}`),
  );
  const oee = getCalculatedNumber(
    worksheet.getCell(`L${totalRow}`),
  );

  if (
    availability === null ||
    performance === null ||
    quality === null ||
    oee === null
  ) {
    return null;
  }

  return {
    week,
    availability,
    performance,
    quality,
    oee,
  };
}

function readOperationalRows(
  worksheet: ExcelJS.Worksheet,
  week: number,
): OeeOperationalRecord[] {
  const rows: OeeOperationalRecord[] = [];
  const bottom = worksheet.dimensions?.bottom ?? worksheet.rowCount;

  for (let rowNumber = 2; rowNumber <= bottom; rowNumber += 1) {
    const machine = getText(worksheet.getCell(`A${rowNumber}`));

    if (!machine) {
      continue;
    }

    const date = getDateText(worksheet.getCell(`D${rowNumber}`));
    const downtimeMinutes =
      getCalculatedNumber(worksheet.getCell(`F${rowNumber}`)) ?? 0;
    const downtimeReason = getText(
      worksheet.getCell(`G${rowNumber}`),
    );
    const availableMinutes =
      getCalculatedNumber(worksheet.getCell(`K${rowNumber}`)) ?? 0;
    const usedMinutes =
      getCalculatedNumber(worksheet.getCell(`O${rowNumber}`)) ?? 0;

    rows.push({
      rowNumber,
      machine,
      date,
      department: "",
      week,
      availableMinutes,
      usedMinutes,
      downtimeMinutes,
      downtimeReason,
    });
  }

  return rows;
}

function readMachineSummaries(
  worksheet: ExcelJS.Worksheet,
  week: number,
): Array<MachineUtilizationRecord & { downtimeMinutes: number }> {
  const bottom = worksheet.dimensions?.bottom ?? worksheet.rowCount;
  const totalRows: number[] = [];

  for (let rowNumber = 1; rowNumber <= bottom; rowNumber += 1) {
    const label = getText(worksheet.getCell(`A${rowNumber}`));

    if (/^Total\s+.+/i.test(label) && !/^Total general$/i.test(label)) {
      totalRows.push(rowNumber);
    }
  }

  const candidateRows =
    totalRows.length > 0
      ? totalRows
      : Array.from({ length: bottom }, (_, index) => index + 1).filter(
          (rowNumber) => {
            const label = getText(worksheet.getCell(`A${rowNumber}`));

            return (
              label !== "" &&
              !/^Etiquetas de fila$/i.test(label) &&
              !/^Máquina$/i.test(label) &&
              !/^Total general$/i.test(label) &&
              !/^\(en blanco\)$/i.test(label) &&
              !(worksheet.getCell(`A${rowNumber}`).value instanceof Date)
            );
          },
        );

  return candidateRows
    .map((rowNumber) => {
      const rawLabel = getText(worksheet.getCell(`A${rowNumber}`));
      const machine = rawLabel.replace(/^Total\s+/i, "").trim();
      const availableMinutes = getCalculatedNumber(
        worksheet.getCell(`B${rowNumber}`),
      );
      const downtimeMinutes = getCalculatedNumber(
        worksheet.getCell(`C${rowNumber}`),
      );
      const usedMinutes = getCalculatedNumber(
        worksheet.getCell(`D${rowNumber}`),
      );
      const utilization = getCalculatedNumber(
        worksheet.getCell(`M${rowNumber}`),
      );

      if (
        !machine ||
        availableMinutes === null ||
        downtimeMinutes === null ||
        usedMinutes === null ||
        utilization === null
      ) {
        return null;
      }

      return {
        machine,
        week,
        availableMinutes,
        usedMinutes,
        utilization,
        downtimeMinutes,
      };
    })
    .filter(
      (
        record,
      ): record is MachineUtilizationRecord & { downtimeMinutes: number } =>
        record !== null,
    );
}

function reconcileOperationalRows(
  operationalRows: OeeOperationalRecord[],
  officialMachines: Array<
    MachineUtilizationRecord & { downtimeMinutes: number }
  >,
): OeeOperationalRecord[] {
  const reconciled = [...operationalRows];

  for (const official of officialMachines) {
    const matchingRows = reconciled.filter(
      (row) =>
        row.week === official.week &&
        row.machine.trim().toLocaleUpperCase("es-MX") ===
          official.machine.trim().toLocaleUpperCase("es-MX"),
    );

    const availableMinutes = matchingRows.reduce(
      (total, row) => total + row.availableMinutes,
      0,
    );
    const usedMinutes = matchingRows.reduce(
      (total, row) => total + row.usedMinutes,
      0,
    );
    const downtimeMinutes = matchingRows.reduce(
      (total, row) => total + row.downtimeMinutes,
      0,
    );

    const availableDelta = official.availableMinutes - availableMinutes;
    const usedDelta = official.usedMinutes - usedMinutes;
    const downtimeDelta = official.downtimeMinutes - downtimeMinutes;

    if (
      Math.abs(availableDelta) < 0.000001 &&
      Math.abs(usedDelta) < 0.000001 &&
      Math.abs(downtimeDelta) < 0.000001
    ) {
      continue;
    }

    reconciled.push({
      rowNumber: 0,
      machine: official.machine,
      date: null,
      department: "",
      week: official.week,
      availableMinutes: availableDelta,
      usedMinutes: usedDelta,
      downtimeMinutes: downtimeDelta,
      downtimeReason: "",
    });
  }

  return reconciled;
}

function validateWeeklyStructure(
  weeklySheets: Array<{ worksheet: ExcelJS.Worksheet; week: number }>,
  registerSheets: Array<{ worksheet: ExcelJS.Worksheet; week: number }>,
): void {
  const oeeWeeks = new Set(weeklySheets.map((item) => item.week));
  const registerWeeks = new Set(registerSheets.map((item) => item.week));

  const missingRegisterWeeks = [...oeeWeeks]
    .filter((week) => !registerWeeks.has(week))
    .sort((left, right) => left - right);

  if (missingRegisterWeeks.length > 0) {
    throw new Error(
      `El archivo OEE está incompleto. Faltan las hojas ${missingRegisterWeeks
        .map((week) => `RegistroSemana${week}`)
        .join(", ")}.`,
    );
  }

  const orphanRegisterWeeks = [...registerWeeks]
    .filter((week) => !oeeWeeks.has(week))
    .sort((left, right) => left - right);

  if (orphanRegisterWeeks.length > 0) {
    throw new Error(
      `El archivo OEE contiene registros sin su hoja OEE correspondiente: ${orphanRegisterWeeks
        .map((week) => `RegistroSemana${week}`)
        .join(", ")}.`,
    );
  }
}

export async function readOeeWorkbook(): Promise<OeeWorkbookData> {
  const filePath = process.env.OEE_MASTER_PATH;

  if (!filePath) {
    throw new Error(
      "No está configurada la variable OEE_MASTER_PATH en el entorno.",
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const weeklySheets = workbook.worksheets
    .map((worksheet) => ({
      worksheet,
      week: getWeekFromSheetName(
        worksheet.name,
        OEE_SHEET_PATTERN,
      ),
    }))
    .filter(
      (
        item,
      ): item is {
        worksheet: ExcelJS.Worksheet;
        week: number;
      } => item.week !== null,
    )
    .sort((left, right) => left.week - right.week);

  if (weeklySheets.length === 0) {
    throw new Error(
      'No se encontraron hojas con el formato "OEE Semana##".',
    );
  }

  const registerSheets = workbook.worksheets
    .map((worksheet) => ({
      worksheet,
      week: getWeekFromSheetName(
        worksheet.name,
        REGISTER_SHEET_PATTERN,
      ),
    }))
    .filter(
      (
        item,
      ): item is {
        worksheet: ExcelJS.Worksheet;
        week: number;
      } => item.week !== null,
    )
    .sort((left, right) => left.week - right.week);

  validateWeeklyStructure(weeklySheets, registerSheets);

  const history: WeeklyOeeRecord[] = weeklySheets.map(
    ({ worksheet, week }) => {
      const record = readWeeklyOee(worksheet, week);

      if (!record) {
        throw new Error(
          `La hoja "OEE Semana${week}" no contiene un TOTAL GENERAL con KPIs válidos.`,
        );
      }

      return record;
    },
  );

  const rawOperationalRows = registerSheets.flatMap(
    ({ worksheet, week }) => readOperationalRows(worksheet, week),
  );

  const officialMachines = weeklySheets.flatMap(
    ({ worksheet, week }) => readMachineSummaries(worksheet, week),
  );

  if (officialMachines.length === 0) {
    throw new Error(
      "No se encontraron resultados oficiales por máquina en las hojas OEE semanales.",
    );
  }

  const latestWeek = history[history.length - 1].week;

  const latestWeekMachines = officialMachines.filter(
    (machine) => machine.week === latestWeek,
  );

  if (latestWeekMachines.length === 0) {
    throw new Error(
      `La semana ${latestWeek} no contiene resultados oficiales por máquina.`,
    );
  }

  const latestWeekOperationalRows = rawOperationalRows.filter(
    (row) => row.week === latestWeek,
  );

  if (latestWeekOperationalRows.length === 0) {
    throw new Error(
      `La hoja "RegistroSemana${latestWeek}" no contiene registros operativos válidos.`,
    );
  }

  const operationalRows = reconcileOperationalRows(
    rawOperationalRows,
    officialMachines,
  );

  const machines = officialMachines.map(
    ({ downtimeMinutes: _downtimeMinutes, ...machine }) => machine,
  );

  const current = history[history.length - 1];
  const currentWeek = current.week;

  return {
    currentWeek,
    current,
    history,
    machines,
    operationalRows,
    sourceFile: path.basename(filePath),
    sourceSheet: `OEE Semana${currentWeek}`,
    updatedAt: new Date().toISOString(),
  };
}
