import { buildOeeEngine } from "@/engines/oee";
import {
  getCachedWorkbook,
  setCachedWorkbook,
} from "@/lib/cache/oee-cache";
import { readOeeWorkbook } from "@/lib/excel/oee-reader";
import type { OeeWorkbookData } from "@/types/oee";

function buildActiveWeekData(
  workbook: OeeWorkbookData,
  activeWeek?: number,
): OeeWorkbookData {
  if (activeWeek === undefined) {
    return workbook;
  }

  const selectedWeekRecord = workbook.history.find(
    (record) => record.week === activeWeek,
  );

  if (!selectedWeekRecord) {
    throw new Error(
      `No existe información de OEE para la semana ${activeWeek}.`,
    );
  }

  return {
    ...workbook,
    currentWeek: activeWeek,
    current: selectedWeekRecord,
  };
}

export async function getOeeData(activeWeek?: number) {
  let workbook = await getCachedWorkbook();

  if (!workbook) {
    console.log("OEE: archivo nuevo o caché vacía. Leyendo Excel.");

    workbook = await readOeeWorkbook();

    await setCachedWorkbook(workbook);
  } else {
    console.log("OEE: archivo sin cambios. Usando caché validada.");
  }

  const activeWeekData = buildActiveWeekData(
    workbook,
    activeWeek,
  );

  const engine = buildOeeEngine(activeWeekData);

  return {
    ...activeWeekData,
    ...engine,
  };
}
