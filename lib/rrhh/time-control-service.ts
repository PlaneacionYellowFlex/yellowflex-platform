import "server-only";

import { db } from "@/lib/db";
import { RrhhServiceError } from "@/lib/rrhh/errors";
import type {
  EmployeeTimeMovementInput,
  EmployeeTimeMovementTypeInput,
} from "@/lib/rrhh/time-control-validation";

const timeControlEmployeeSelect = {
  id: true,
  employeeNumber: true,
  fullName: true,
  position: true,
  status: true,
  department: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  workShift: {
    select: {
      id: true,
      code: true,
      name: true,
      startTime: true,
      endTime: true,
    },
  },
} as const;

const timeMovementSelect = {
  id: true,
  type: true,
  reason: true,
  minutes: true,
  effectiveDate: true,
  notes: true,
  registeredById: true,
  registeredBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} as const;

function getMovementEffect(
  type: EmployeeTimeMovementTypeInput,
  minutes: number,
) {
  switch (type) {
    case "DEBT":
    case "DEBIT_ADJUSTMENT":
      return minutes;

    case "RECOVERY":
    case "CREDIT_ADJUSTMENT":
      return -minutes;
  }
}

function calculateBalance(
  movements: Array<{
    type: EmployeeTimeMovementTypeInput;
    minutes: number;
  }>,
) {
  return movements.reduce(
    (balance, movement) =>
      balance +
      getMovementEffect(
        movement.type,
        movement.minutes,
      ),
    0,
  );
}

function formatMinutes(totalMinutes: number) {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  return {
    totalMinutes: safeMinutes,
    hours,
    minutes,
    label:
      hours > 0
        ? `${hours} h ${minutes} min`
        : `${minutes} min`,
  };
}

export async function getEmployeeTimeBalance(
  employeeId: string,
) {
  const employee = await db.employee.findUnique({
    where: {
      id: employeeId,
    },
    select: {
      ...timeControlEmployeeSelect,
      timeMovements: {
        select: {
          type: true,
          minutes: true,
        },
      },
    },
  });

  if (!employee) {
    throw new RrhhServiceError(
      "El colaborador no existe.",
      404,
      "EMPLOYEE_NOT_FOUND",
    );
  }

  const balanceMinutes = calculateBalance(
    employee.timeMovements,
  );

  return {
    employee: {
      id: employee.id,
      employeeNumber: employee.employeeNumber,
      fullName: employee.fullName,
      position: employee.position,
      status: employee.status,
      department: employee.department,
      workShift: employee.workShift,
    },
    balance: formatMinutes(balanceMinutes),
  };
}

export async function getEmployeeTimeHistory(
  employeeId: string,
) {
  const employee = await db.employee.findUnique({
    where: {
      id: employeeId,
    },
    select: timeControlEmployeeSelect,
  });

  if (!employee) {
    throw new RrhhServiceError(
      "El colaborador no existe.",
      404,
      "EMPLOYEE_NOT_FOUND",
    );
  }

  const movements =
    await db.employeeTimeMovement.findMany({
      where: {
        employeeId,
      },
      select: timeMovementSelect,
      orderBy: [
        {
          effectiveDate: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
    });

  const balanceMinutes = calculateBalance(movements);

  return {
    employee,
    balance: formatMinutes(balanceMinutes),
    movements: movements.map((movement) => ({
      ...movement,
      effectMinutes: getMovementEffect(
        movement.type,
        movement.minutes,
      ),
    })),
  };
}

export async function getTimeControlSummary() {
  const employees = await db.employee.findMany({
    where: {
      status: "ACTIVE",
    },
    select: {
      ...timeControlEmployeeSelect,
      timeMovements: {
        select: {
          type: true,
          minutes: true,
        },
      },
    },
    orderBy: {
      fullName: "asc",
    },
  });

  const employeeBalances = employees.map((employee) => {
    const balanceMinutes = calculateBalance(
      employee.timeMovements,
    );

    return {
      employee: {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        position: employee.position,
        status: employee.status,
        department: employee.department,
        workShift: employee.workShift,
      },
      balance: formatMinutes(balanceMinutes),
    };
  });

  const debtors = employeeBalances
    .filter((item) => item.balance.totalMinutes > 0)
    .sort(
      (first, second) =>
        second.balance.totalMinutes -
        first.balance.totalMinutes,
    );

  const totalPendingMinutes = debtors.reduce(
    (total, item) =>
      total + item.balance.totalMinutes,
    0,
  );

  const totalDebtMinutes = employees.reduce(
    (total, employee) =>
      total +
      employee.timeMovements.reduce(
        (employeeTotal, movement) =>
          movement.type === "DEBT" ||
          movement.type === "DEBIT_ADJUSTMENT"
            ? employeeTotal + movement.minutes
            : employeeTotal,
        0,
      ),
    0,
  );

  const totalRecoveredMinutes = employees.reduce(
    (total, employee) =>
      total +
      employee.timeMovements.reduce(
        (employeeTotal, movement) =>
          movement.type === "RECOVERY" ||
          movement.type === "CREDIT_ADJUSTMENT"
            ? employeeTotal + movement.minutes
            : employeeTotal,
        0,
      ),
    0,
  );

  return {
    totals: {
      activeEmployees: employees.length,
      employeesWithDebt: debtors.length,
      employeesWithoutDebt:
        employees.length - debtors.length,
      pending: formatMinutes(totalPendingMinutes),
      generated: formatMinutes(totalDebtMinutes),
      recovered: formatMinutes(totalRecoveredMinutes),
    },
    debtors,
  };
}

export async function registerEmployeeTimeMovement(
  employeeId: string,
  input: EmployeeTimeMovementInput,
  registeredById?: string | null,
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
      timeMovements: {
        select: {
          type: true,
          minutes: true,
        },
      },
    },
  });

  if (!employee) {
    throw new RrhhServiceError(
      "El colaborador no existe.",
      404,
      "EMPLOYEE_NOT_FOUND",
    );
  }

  if (employee.status !== "ACTIVE") {
    throw new RrhhServiceError(
      "No se pueden registrar movimientos de tiempo para un colaborador inactivo.",
      409,
      "EMPLOYEE_INACTIVE",
    );
  }

  const currentBalance = calculateBalance(
    employee.timeMovements,
  );

  const decreasesBalance =
    input.type === "RECOVERY" ||
    input.type === "CREDIT_ADJUSTMENT";

  if (
    decreasesBalance &&
    input.minutes > currentBalance
  ) {
    throw new RrhhServiceError(
      `El movimiento excede el saldo pendiente del colaborador. Saldo actual: ${formatMinutes(currentBalance).label}.`,
      409,
      "TIME_MOVEMENT_EXCEEDS_BALANCE",
    );
  }

  const effectiveDate = new Date(
    `${input.effectiveDate}T00:00:00.000Z`,
  );

  if (Number.isNaN(effectiveDate.getTime())) {
    throw new RrhhServiceError(
      "La fecha efectiva no es válida.",
      400,
      "INVALID_EFFECTIVE_DATE",
    );
  }

  const movement =
    await db.employeeTimeMovement.create({
      data: {
        employeeId,
        type: input.type,
        reason: input.reason,
        minutes: input.minutes,
        effectiveDate,
        notes: input.notes,
        registeredById: registeredById ?? null,
      },
      select: timeMovementSelect,
    });

  const newBalance =
    currentBalance +
    getMovementEffect(
      movement.type,
      movement.minutes,
    );

  return {
    employee: {
      id: employee.id,
      employeeNumber: employee.employeeNumber,
      fullName: employee.fullName,
    },
    movement: {
      ...movement,
      effectMinutes: getMovementEffect(
        movement.type,
        movement.minutes,
      ),
    },
    previousBalance: formatMinutes(currentBalance),
    balance: formatMinutes(newBalance),
  };
}