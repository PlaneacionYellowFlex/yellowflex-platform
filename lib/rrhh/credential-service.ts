import "server-only";

import { randomInt } from "crypto";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { RrhhServiceError } from "@/lib/rrhh/errors";

const TEMPORARY_PIN_MIN = 100000;
const TEMPORARY_PIN_MAX_EXCLUSIVE = 1000000;
const BCRYPT_ROUNDS = 12;

export async function getEmployeeCredentialState(
  employeeId: string,
) {
  const employee = await db.employee.findUnique({
    where: {
      id: employeeId,
    },
    select: {
      id: true,
      employeeNumber: true,
      fullName: true,
      status: true,
      pinMustChange: true,
      pinUpdatedAt: true,
    },
  });

  if (!employee) {
    throw new RrhhServiceError(
      "El colaborador no fue encontrado.",
      404,
      "EMPLOYEE_NOT_FOUND",
    );
  }

  return employee;
}

export async function resetEmployeePin(
  employeeId: string,
) {
  const employee = await db.employee.findUnique({
    where: {
      id: employeeId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!employee) {
    throw new RrhhServiceError(
      "El colaborador no fue encontrado.",
      404,
      "EMPLOYEE_NOT_FOUND",
    );
  }

  if (employee.status !== "ACTIVE") {
    throw new RrhhServiceError(
      "No es posible restablecer la credencial de un colaborador inactivo.",
      409,
      "EMPLOYEE_INACTIVE",
    );
  }

  const temporaryPin = generateTemporaryPin();
  const pinHash = await bcrypt.hash(
    temporaryPin,
    BCRYPT_ROUNDS,
  );

  const pinUpdatedAt = new Date();

  await db.$transaction(async (tx) => {
    await tx.employee.update({
      where: {
        id: employeeId,
      },
      data: {
        pinHash,
        pinMustChange: true,
        pinUpdatedAt,
      },
    });

    await tx.foodAccessSession.deleteMany({
      where: {
        employeeId,
      },
    });
  });

  return {
    temporaryPin,
    pinMustChange: true,
    pinUpdatedAt,
  };
}

function generateTemporaryPin() {
  return randomInt(
    TEMPORARY_PIN_MIN,
    TEMPORARY_PIN_MAX_EXCLUSIVE,
  ).toString();
}