import "server-only";

import { db } from "@/lib/db";
import { RrhhServiceError } from "@/lib/rrhh/errors";
import type {
  EmployeeMovementInput,
  EmployeeProfileInput,
} from "@/lib/rrhh/validation";

const employeeSelect = {
  id: true,
  employeeNumber: true,
  fullName: true,
  position: true,
  status: true,
  pinMustChange: true,
  pinUpdatedAt: true,
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
  profile: {
    select: {
      id: true,
      birthDate: true,
      hireDate: true,
      managerId: true,
      manager: {
        select: {
          id: true,
          employeeNumber: true,
          fullName: true,
          position: true,
          department: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
      contractType: true,
      phone: true,
      email: true,
      terminationDate: true,
      terminationReason: true,
      transportRoute: true,
      photoUrl: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} as const;

export async function getEmployees() {
  return db.employee.findMany({
    select: employeeSelect,
    orderBy: {
      fullName: "asc",
    },
  });
}

export async function getEmployeeById(id: string) {
  return db.employee.findUnique({
    where: {
      id,
    },
    select: {
      ...employeeSelect,
      movements: {
        select: {
          id: true,
          type: true,
          effectiveDate: true,
          reason: true,
          notes: true,
          previousStatus: true,
          newStatus: true,
          previousPosition: true,
          newPosition: true,
          previousDepartmentId: true,
          previousDepartmentCode: true,
          previousDepartmentName: true,
          newDepartmentId: true,
          newDepartmentCode: true,
          newDepartmentName: true,
          previousWorkShiftId: true,
          previousWorkShiftCode: true,
          previousWorkShiftName: true,
          newWorkShiftId: true,
          newWorkShiftCode: true,
          newWorkShiftName: true,
          registeredById: true,
          registeredBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdAt: true,
        },
        orderBy: [
          {
            effectiveDate: "desc",
          },
          {
            createdAt: "desc",
          },
        ],
      },
    },
  });
}

export async function updateEmployeeProfile(
  employeeId: string,
  input: EmployeeProfileInput,
) {
  const employee = await db.employee.findUnique({
    where: {
      id: employeeId,
    },
    select: {
      id: true,
    },
  });

  if (!employee) {
    throw new RrhhServiceError("El colaborador no fue encontrado.", 404, "EMPLOYEE_NOT_FOUND");
  }

  const data = {
    birthDate: input.birthDate
      ? toDatabaseDate(input.birthDate)
      : null,
    hireDate: input.hireDate
      ? toDatabaseDate(input.hireDate)
      : null,
    contractType: input.contractType,
    phone: input.phone,
    email: input.email,
    transportRoute: input.transportRoute,
  };

  return db.employeeProfile.upsert({
    where: {
      employeeId,
    },
    create: {
      employeeId,
      ...data,
    },
    update: data,
    select: {
      id: true,
      employeeId: true,
      birthDate: true,
      hireDate: true,
      managerId: true,
      contractType: true,
      phone: true,
      email: true,
      terminationDate: true,
      terminationReason: true,
      transportRoute: true,
      photoUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function createEmployeeMovement(
  employeeId: string,
  input: EmployeeMovementInput,
  registeredById?: string | null,
) {
  return db.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({
      where: {
        id: employeeId,
      },
      select: {
        id: true,
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
          },
        },
        profile: {
          select: {
            id: true,
            hireDate: true,
            terminationDate: true,
            terminationReason: true,
          },
        },
      },
    });

    if (!employee) {
      throw new RrhhServiceError("El colaborador no fue encontrado.", 404, "EMPLOYEE_NOT_FOUND");
    }

    const effectiveDate = toDatabaseDate(input.effectiveDate);

    let newDepartment:
      | {
          id: string;
          code: string;
          name: string;
        }
      | null = null;

    let newWorkShift:
      | {
          id: string;
          code: string;
          name: string;
        }
      | null = null;

    if (input.newDepartmentId) {
      newDepartment = await tx.department.findUnique({
        where: {
          id: input.newDepartmentId,
        },
        select: {
          id: true,
          code: true,
          name: true,
        },
      });

      if (!newDepartment) {
        throw new RrhhServiceError("El departamento seleccionado no existe.", 404, "DEPARTMENT_NOT_FOUND");
      }
    }

    if (input.newWorkShiftId) {
      newWorkShift = await tx.workShift.findUnique({
        where: {
          id: input.newWorkShiftId,
        },
        select: {
          id: true,
          code: true,
          name: true,
        },
      });

      if (!newWorkShift) {
        throw new RrhhServiceError("El turno seleccionado no existe.", 404, "WORK_SHIFT_NOT_FOUND");
      }

      const activeWorkShift = await tx.workShift.findUnique({
        where: {
          id: input.newWorkShiftId,
        },
        select: {
          active: true,
        },
      });

      if (!activeWorkShift?.active) {
        throw new RrhhServiceError("El turno seleccionado se encuentra inactivo.", 422, "WORK_SHIFT_INACTIVE");
      }
    }

    validateMovementAgainstCurrentState({
      input,
      current: {
        position: employee.position,
        status: employee.status,
        departmentId: employee.department.id,
        workShiftId: employee.workShift?.id ?? null,
      },
    });

    const employeeUpdateData: {
      position?: string | null;
      departmentId?: string;
      workShiftId?: string | null;
      status?: "ACTIVE" | "INACTIVE";
    } = {};

    switch (input.type) {
      case "HIRE":
        employeeUpdateData.status = "ACTIVE";

        if (newDepartment) {
          employeeUpdateData.departmentId = newDepartment.id;
        }

        if (input.newPosition !== null) {
          employeeUpdateData.position = input.newPosition;
        }

        if (newWorkShift) {
          employeeUpdateData.workShiftId = newWorkShift.id;
        }
        break;

      case "POSITION_CHANGE":
        employeeUpdateData.position = input.newPosition;
        break;

      case "DEPARTMENT_CHANGE":
        if (newDepartment) {
          employeeUpdateData.departmentId = newDepartment.id;
        }
        break;

      case "SHIFT_CHANGE":
        if (newWorkShift) {
          employeeUpdateData.workShiftId = newWorkShift.id;
        }
        break;

      case "PROMOTION":
        employeeUpdateData.position = input.newPosition;

        if (newDepartment) {
          employeeUpdateData.departmentId = newDepartment.id;
        }

        if (newWorkShift) {
          employeeUpdateData.workShiftId = newWorkShift.id;
        }
        break;

      case "TERMINATION":
        employeeUpdateData.status = "INACTIVE";
        break;

      case "REHIRE":
        employeeUpdateData.status = "ACTIVE";

        if (newDepartment) {
          employeeUpdateData.departmentId = newDepartment.id;
        }

        if (input.newPosition !== null) {
          employeeUpdateData.position = input.newPosition;
        }

        if (newWorkShift) {
          employeeUpdateData.workShiftId = newWorkShift.id;
        }
        break;
    }

    await tx.employee.update({
      where: {
        id: employeeId,
      },
      data: employeeUpdateData,
    });

    if (input.type === "HIRE" || input.type === "REHIRE") {
      await tx.employeeProfile.upsert({
        where: {
          employeeId,
        },
        create: {
          employeeId,
          hireDate: effectiveDate,
          terminationDate: null,
          terminationReason: null,
        },
        update: {
          hireDate: effectiveDate,
          terminationDate: null,
          terminationReason: null,
        },
      });
    }

    if (input.type === "TERMINATION") {
      await tx.employeeProfile.upsert({
        where: {
          employeeId,
        },
        create: {
          employeeId,
          terminationDate: effectiveDate,
          terminationReason: input.reason,
        },
        update: {
          terminationDate: effectiveDate,
          terminationReason: input.reason,
        },
      });
    }

    return tx.employeeMovement.create({
      data: {
        employeeId,
        type: input.type,
        effectiveDate,
        reason: input.reason,
        notes: input.notes,

        previousStatus: employee.status,
        newStatus:
          employeeUpdateData.status ?? employee.status,

        previousPosition: employee.position,
        newPosition:
          employeeUpdateData.position !== undefined
            ? employeeUpdateData.position
            : employee.position,

        previousDepartmentId: employee.department.id,
        previousDepartmentCode: employee.department.code,
        previousDepartmentName: employee.department.name,

        newDepartmentId:
          newDepartment?.id ?? employee.department.id,
        newDepartmentCode:
          newDepartment?.code ?? employee.department.code,
        newDepartmentName:
          newDepartment?.name ?? employee.department.name,

        previousWorkShiftId: employee.workShift?.id ?? null,
        previousWorkShiftCode: employee.workShift?.code ?? null,
        previousWorkShiftName: employee.workShift?.name ?? null,

        newWorkShiftId:
          newWorkShift?.id ?? employee.workShift?.id ?? null,
        newWorkShiftCode:
          newWorkShift?.code ?? employee.workShift?.code ?? null,
        newWorkShiftName:
          newWorkShift?.name ?? employee.workShift?.name ?? null,

        registeredById: registeredById ?? null,
      },
      select: {
        id: true,
        employeeId: true,
        type: true,
        effectiveDate: true,
        reason: true,
        notes: true,
        previousStatus: true,
        newStatus: true,
        previousPosition: true,
        newPosition: true,
        previousDepartmentId: true,
        previousDepartmentCode: true,
        previousDepartmentName: true,
        newDepartmentId: true,
        newDepartmentCode: true,
        newDepartmentName: true,
        previousWorkShiftId: true,
        previousWorkShiftCode: true,
        previousWorkShiftName: true,
        newWorkShiftId: true,
        newWorkShiftCode: true,
        newWorkShiftName: true,
        registeredById: true,
        createdAt: true,
      },
    });
  });
}

function validateMovementAgainstCurrentState({
  input,
  current,
}: {
  input: EmployeeMovementInput;
  current: {
    position: string | null;
    status: "ACTIVE" | "INACTIVE";
    departmentId: string;
    workShiftId: string | null;
  };
}) {
  switch (input.type) {
    case "HIRE":
      if (current.status === "ACTIVE") {
        throw new RrhhServiceError("El colaborador ya se encuentra activo.", 409, "EMPLOYEE_ALREADY_ACTIVE");
      }
      break;

    case "POSITION_CHANGE":
      if (current.status !== "ACTIVE") {
        throw new RrhhServiceError("El movimiento no puede realizarse porque el colaborador se encuentra inactivo.", 409, "EMPLOYEE_INACTIVE");
      }

      if (input.newPosition === current.position) {
        throw new RrhhServiceError("El puesto seleccionado es el mismo que tiene actualmente.", 409, "POSITION_UNCHANGED");
      }
      break;

    case "DEPARTMENT_CHANGE":
      if (current.status !== "ACTIVE") {
        throw new RrhhServiceError("El movimiento no puede realizarse porque el colaborador se encuentra inactivo.", 409, "EMPLOYEE_INACTIVE");
      }

      if (input.newDepartmentId === current.departmentId) {
        throw new RrhhServiceError("El departamento seleccionado es el mismo que tiene actualmente.", 409, "DEPARTMENT_UNCHANGED");
      }
      break;

    case "SHIFT_CHANGE":
      if (current.status !== "ACTIVE") {
        throw new RrhhServiceError("El movimiento no puede realizarse porque el colaborador se encuentra inactivo.", 409, "EMPLOYEE_INACTIVE");
      }

      if (input.newWorkShiftId === current.workShiftId) {
        throw new RrhhServiceError("El turno seleccionado es el mismo que tiene actualmente.", 409, "WORK_SHIFT_UNCHANGED");
      }
      break;

    case "PROMOTION": {
      if (current.status !== "ACTIVE") {
        throw new RrhhServiceError("El movimiento no puede realizarse porque el colaborador se encuentra inactivo.", 409, "EMPLOYEE_INACTIVE");
      }

      const positionChanged =
        input.newPosition !== null &&
        input.newPosition !== current.position;

      const departmentChanged =
        input.newDepartmentId !== null &&
        input.newDepartmentId !== current.departmentId;

      const workShiftChanged =
        input.newWorkShiftId !== null &&
        input.newWorkShiftId !== current.workShiftId;

      if (
        !positionChanged &&
        !departmentChanged &&
        !workShiftChanged
      ) {
        throw new RrhhServiceError("La promoción no contiene cambios respecto a la situación actual del colaborador.", 409, "MOVEMENT_WITHOUT_CHANGES");
      }

      break;
    }

    case "TERMINATION":
      if (current.status === "INACTIVE") {
        throw new RrhhServiceError("El colaborador ya se encuentra inactivo.", 409, "EMPLOYEE_ALREADY_INACTIVE");
      }
      break;

    case "REHIRE":
      if (current.status === "ACTIVE") {
        throw new RrhhServiceError("El colaborador ya se encuentra activo.", 409, "EMPLOYEE_ALREADY_ACTIVE");
      }
      break;
  }
}

function toDatabaseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function getRrhhCatalogs() {
  const [departments, workShifts] = await Promise.all([
    db.department.findMany({
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
    db.workShift.findMany({
      where: {
        active: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        startTime: true,
        endTime: true,
        crossesMidnight: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  return {
    departments,
    workShifts,
  };
}
