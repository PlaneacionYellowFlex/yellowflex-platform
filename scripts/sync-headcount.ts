import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import path from "node:path";

const prisma = new PrismaClient();

const HEADCOUNT_PATH =
  process.env.HEADCOUNT_PATH ??
  path.join(process.cwd(), "data", "headcount", "HEADCOUNT.xlsx");

const DEFAULT_PIN =
  process.env.FOOD_HEADCOUNT_DEFAULT_PIN ?? "1234";

type HeadcountRecord = {
  rowNumber: number;
  employeeNumber: string;
  fullName: string;
  shiftCode: string;
  position: string;
  departmentName: string;
};

type SyncSummary = {
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  omitted: number;
};

function cellText(cell: ExcelJS.Cell) {
  return cell.text.replace(/\s+/g, " ").trim();
}

function normalizeEmployeeNumber(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDepartmentCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseShift(value: string) {
  const normalized = value.trim().toUpperCase().replace(/^T/, "");
  if (!["1", "2", "3", "4"].includes(normalized)) return null;
  return `T${normalized}`;
}

async function readHeadcount() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(HEADCOUNT_PATH);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("El archivo HEADCOUNT no contiene ninguna hoja.");
  }

  const headers = [
    cellText(worksheet.getCell(1, 1)),
    cellText(worksheet.getCell(1, 2)),
    cellText(worksheet.getCell(1, 3)),
    cellText(worksheet.getCell(1, 4)),
    cellText(worksheet.getCell(1, 5)),
  ];

  if (headers.some((header) => !header)) {
    throw new Error(
      "No fue posible reconocer las cinco columnas operativas del HEADCOUNT.",
    );
  }

  const records: HeadcountRecord[] = [];
  const omittedRows: number[] = [];
  const errors: string[] = [];
  const seenEmployeeNumbers = new Map<string, number>();

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);

    const employeeNumber = normalizeEmployeeNumber(cellText(row.getCell(1)));
    const fullName = normalizeName(cellText(row.getCell(2)));
    const rawShift = cellText(row.getCell(3));
    const position = normalizeName(cellText(row.getCell(4)));
    const departmentName = normalizeName(cellText(row.getCell(5)));

    const hasOperationalData =
      employeeNumber || fullName || rawShift || position || departmentName;

    if (!hasOperationalData) continue;

    if (!employeeNumber) {
      omittedRows.push(rowNumber);
      continue;
    }

    const duplicateRow = seenEmployeeNumbers.get(employeeNumber);
    if (duplicateRow) {
      errors.push(
        `Nómina duplicada ${employeeNumber}: filas ${duplicateRow} y ${rowNumber}.`,
      );
      continue;
    }

    seenEmployeeNumbers.set(employeeNumber, rowNumber);

    if (!fullName) {
      errors.push(`Fila ${rowNumber}: falta el nombre del empleado.`);
    }

    if (!position) {
      errors.push(`Fila ${rowNumber}: falta el puesto.`);
    }

    if (!departmentName) {
      errors.push(`Fila ${rowNumber}: falta el departamento.`);
    }

    const shiftCode = parseShift(rawShift);

    if (!shiftCode) {
      errors.push(
        `Fila ${rowNumber}: turno inválido "${rawShift}". Solo se permiten T1, T2, T3 o T4.`,
      );
    }

    if (fullName && position && departmentName && shiftCode) {
      records.push({
        rowNumber,
        employeeNumber,
        fullName,
        shiftCode,
        position,
        departmentName,
      });
    }
  }

  if (errors.length > 0) {
    console.error(
      "\nHEADCOUNT rechazado. No se realizó ningún cambio en PostgreSQL.\n",
    );

    for (const error of errors) console.error(`- ${error}`);

    throw new Error(
      `La validación encontró ${errors.length} error(es) crítico(s).`,
    );
  }

  return { records, omittedRows };
}

async function synchronize(
  records: HeadcountRecord[],
  omittedRows: number[],
) {
  const shifts = await prisma.workShift.findMany({
    where: {
      code: { in: ["T1", "T2", "T3", "T4"] },
      active: true,
    },
  });

  const shiftByCode = new Map(shifts.map((shift) => [shift.code, shift]));

  for (const code of ["T1", "T2", "T3", "T4"]) {
    if (!shiftByCode.has(code)) {
      throw new Error(
        `El turno ${code} no existe o está inactivo. Ejecuta primero el seed de infraestructura.`,
      );
    }
  }

  const existingEmployees = await prisma.employee.findMany({
    where: {
      employeeNumber: {
        in: records.map((record) => record.employeeNumber),
      },
    },
    select: {
      id: true,
      employeeNumber: true,
      fullName: true,
      position: true,
      departmentId: true,
      workShiftId: true,
      status: true,
    },
  });

  const employeeByNumber = new Map(
    existingEmployees.map((employee) => [employee.employeeNumber, employee]),
  );

  const departmentNames = Array.from(
    new Set(records.map((record) => record.departmentName)),
  );

  const departmentByName = new Map<
    string,
    { id: string; name: string; code: string }
  >();

  for (const departmentName of departmentNames) {
    const code = normalizeDepartmentCode(departmentName);

    if (!code) {
      throw new Error(
        `No fue posible generar un código para el departamento "${departmentName}".`,
      );
    }

    const department = await prisma.department.upsert({
      where: { code },
      update: { name: departmentName },
      create: { code, name: departmentName },
    });

    departmentByName.set(departmentName, department);
  }

  const pinHash = await bcrypt.hash(DEFAULT_PIN, 12);

  const summary: SyncSummary = {
    processed: records.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    omitted: omittedRows.length,
  };

  await prisma.$transaction(
    async (tx) => {
      for (const record of records) {
        const department = departmentByName.get(record.departmentName);
        const shift = shiftByCode.get(record.shiftCode);

        if (!department || !shift) {
          throw new Error(
            `No fue posible resolver departamento o turno para la fila ${record.rowNumber}.`,
          );
        }

        const existing = employeeByNumber.get(record.employeeNumber);

        if (!existing) {
          await tx.employee.create({
            data: {
              employeeNumber: record.employeeNumber,
              fullName: record.fullName,
              position: record.position,
              departmentId: department.id,
              workShiftId: shift.id,
              status: "ACTIVE",
              pinHash,
            },
          });

          summary.created += 1;
          continue;
        }

        const changed =
          existing.fullName !== record.fullName ||
          existing.position !== record.position ||
          existing.departmentId !== department.id ||
          existing.workShiftId !== shift.id ||
          existing.status !== "ACTIVE";

        if (!changed) {
          summary.unchanged += 1;
          continue;
        }

        await tx.employee.update({
          where: { id: existing.id },
          data: {
            fullName: record.fullName,
            position: record.position,
            departmentId: department.id,
            workShiftId: shift.id,
            status: "ACTIVE",
          },
        });

        summary.updated += 1;
      }
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  return summary;
}

async function main() {
  console.log(`HEADCOUNT: ${HEADCOUNT_PATH}`);
  console.log("Validando archivo antes de modificar PostgreSQL...");

  const { records, omittedRows } = await readHeadcount();

  console.log(
    `Validación correcta: ${records.length} colaboradores válidos.`,
  );

  if (omittedRows.length > 0) {
    console.log(
      `Filas omitidas por no tener No. de nómina: ${omittedRows.join(", ")}.`,
    );
  }

  const summary = await synchronize(records, omittedRows);

  console.log("\nSincronización terminada.");
  console.log(`Procesados: ${summary.processed}`);
  console.log(`Nuevos: ${summary.created}`);
  console.log(`Actualizados: ${summary.updated}`);
  console.log(`Sin cambios: ${summary.unchanged}`);
  console.log(`Omitidos: ${summary.omitted}`);
  console.log(
    "No se eliminó ni inactivó automáticamente a ningún colaborador.",
  );
}

main()
  .catch((error) => {
    console.error("\nSincronización cancelada.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });