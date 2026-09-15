import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const employeeNumber =
  process.env.FOOD_SEED_EMPLOYEE_NUMBER ?? "DEV-0001";

const seedPin =
  process.env.FOOD_SEED_PIN ?? "1234";

const workShifts = [
  {
    code: "T1",
    name: "Lunes a jueves · Diurno",
    startTime: "07:00",
    endTime: "19:00",
    crossesMidnight: false,
  },
  {
    code: "T2",
    name: "Lunes a jueves · Nocturno",
    startTime: "19:00",
    endTime: "07:00",
    crossesMidnight: true,
  },
  {
    code: "T3",
    name: "Jueves a domingo · Diurno",
    startTime: "07:00",
    endTime: "19:00",
    crossesMidnight: false,
  },
  {
    code: "T4",
    name: "Jueves a domingo · Nocturno",
    startTime: "19:00",
    endTime: "07:00",
    crossesMidnight: true,
  },
] as const;

const testEmployees = [
  {
    employeeNumber: "TEST-T1",
    fullName: "Colaborador Prueba T1",
    shiftCode: "T1",
  },
  {
    employeeNumber: "TEST-T2",
    fullName: "Colaborador Prueba T2",
    shiftCode: "T2",
  },
  {
    employeeNumber: "TEST-T3",
    fullName: "Colaborador Prueba T3",
    shiftCode: "T3",
  },
  {
    employeeNumber: "TEST-T4",
    fullName: "Colaborador Prueba T4",
    shiftCode: "T4",
  },
] as const;

async function main() {
  const shifts = await Promise.all(
    workShifts.map((shift) =>
      prisma.workShift.upsert({
        where: {
          code: shift.code,
        },
        update: {
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          crossesMidnight: shift.crossesMidnight,
          active: true,
        },
        create: {
          code: shift.code,
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          crossesMidnight: shift.crossesMidnight,
          active: true,
        },
      }),
    ),
  );

  const shiftByCode = new Map(
    shifts.map((shift) => [shift.code, shift]),
  );

  const t1 = shiftByCode.get("T1");

  if (!t1) {
    throw new Error(
      "No fue posible crear o recuperar el turno T1.",
    );
  }

  const department =
    await prisma.department.upsert({
      where: {
        code: "DEV-OPS",
      },
      update: {
        name: "Operaciones de prueba",
      },
      create: {
        code: "DEV-OPS",
        name: "Operaciones de prueba",
      },
    });

  const pinHash = await bcrypt.hash(
    seedPin,
    12,
  );

  await prisma.employee.upsert({
    where: {
      employeeNumber,
    },
    update: {
      fullName: "Empleado de prueba",
      position: "Pruebas Food Services",
      departmentId: department.id,
      workShiftId: t1.id,
      status: "ACTIVE",
      pinHash,
    },
    create: {
      employeeNumber,
      fullName: "Empleado de prueba",
      position: "Pruebas Food Services",
      departmentId: department.id,
      workShiftId: t1.id,
      status: "ACTIVE",
      pinHash,
    },
  });

  for (const testEmployee of testEmployees) {
    const shift = shiftByCode.get(
      testEmployee.shiftCode,
    );

    if (!shift) {
      throw new Error(
        `No fue posible recuperar el turno ${testEmployee.shiftCode}.`,
      );
    }

    await prisma.employee.upsert({
      where: {
        employeeNumber:
          testEmployee.employeeNumber,
      },
      update: {
        fullName: testEmployee.fullName,
        position: "Pruebas Food Services",
        departmentId: department.id,
        workShiftId: shift.id,
        status: "ACTIVE",
        pinHash,
      },
      create: {
        employeeNumber:
          testEmployee.employeeNumber,
        fullName: testEmployee.fullName,
        position: "Pruebas Food Services",
        departmentId: department.id,
        workShiftId: shift.id,
        status: "ACTIVE",
        pinHash,
      },
    });
  }

  console.log(
    "Development seed completed: T1-T4, DEV-0001 and TEST-T1 through TEST-T4 are ready. PIN: 1234. No menu data was modified.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });