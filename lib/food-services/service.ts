import "server-only";

import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { FOOD_SERVICE_PRICE } from "@/lib/food-services/config";
import { getReservationWindowStatus } from "@/lib/food-services/reservation-window";
import {
  FoodShiftPolicyError,
  getFoodShiftPolicy,
  validateFoodSelectionForShift,
} from "@/lib/food-services/shift-policy";

export class FoodServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function verifyEmployeePin(
  employeeNumber: string,
  pin: string,
) {
  const employee = await db.employee.findUnique({
    where: {
      employeeNumber,
    },
    select: {
      id: true,
      status: true,
      pinHash: true,
    },
  });

  if (
    !employee ||
    employee.status !== "ACTIVE" ||
    !(await bcrypt.compare(pin, employee.pinHash))
  ) {
    throw new FoodServiceError(
      "Número de empleado o PIN inválido.",
      401,
    );
  }

  return employee.id;
}

export async function changeEmployeePin(
  employeeId: string,
  newPin: string,
) {
  const employee = await db.employee.findUnique({
    where: {
      id: employeeId,
    },
    select: {
      id: true,
      status: true,
      pinMustChange: true,
    },
  });

  if (!employee || employee.status !== "ACTIVE") {
    throw new FoodServiceError(
      "El colaborador no se encuentra activo.",
      409,
    );
  }

  if (!employee.pinMustChange) {
    throw new FoodServiceError(
      "El PIN temporal ya fue reemplazado.",
      409,
    );
  }

  const pinHash = await bcrypt.hash(newPin, 12);
  const pinUpdatedAt = new Date();

  await db.employee.update({
    where: {
      id: employee.id,
    },
    data: {
      pinHash,
      pinMustChange: false,
      pinUpdatedAt,
    },
  });

  return {
    employeeId: employee.id,
    pinMustChange: false,
    pinUpdatedAt,
  };
}
export async function getPublishedMenu() {
  return db.menuWeek.findMany({
    where: {
      status: "PUBLISHED",
    },
    orderBy: {
      weekStart: "desc",
    },
    select: {
      id: true,
      weekStart: true,
      days: {
        orderBy: {
          serviceDate: "asc",
        },
        select: {
          serviceDate: true,
          items: {
            where: {
              available: true,
              archivedAt: null,
            },
            orderBy: [
              {
                serviceType: "asc",
              },
              {
                name: "asc",
              },
            ],
            select: {
              id: true,
              serviceType: true,
              name: true,
              description: true,
              price: true,
            },
          },
        },
      },
    },
  });
}

export async function createReservation(
  employeeId: string,
  menuItemId: string,
) {
  const item = await db.menuItem.findFirst({
    where: {
      id: menuItemId,
      available: true,
      archivedAt: null,
      menuDay: {
        menuWeek: {
          status: "PUBLISHED",
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!item) {
    throw new FoodServiceError(
      "La opción ya no está disponible.",
      409,
    );
  }

  const existingReservation =
    await db.reservation.findUnique({
      where: {
        employeeId_menuItemId: {
          employeeId,
          menuItemId,
        },
      },
      select: {
        id: true,
      },
    });

  if (existingReservation) {
    throw new FoodServiceError(
      "Ya existe una reserva para esta opción.",
      409,
    );
  }

  return db.reservation.create({
    data: {
      employeeId,
      menuItemId,
    },
  });
}

export async function saveWeeklyReservations(
  employeeId: string,
  menuItemIds: string[],
) {
  const reservationWindow = getReservationWindowStatus();

  if (!reservationWindow.isOpen) {
    throw new FoodServiceError(
      "La ventana de reservaciones está cerrada. Las reservaciones abren el viernes a las 12:00 y cierran el sábado a las 23:59.",
      409,
    );
  }

  const targetWeekStart = reservationWindow.targetWeekStart;

  const existingOrder = await db.foodOrder.findFirst({
    where: {
      employeeId,
      menuWeek: {
        weekStart: targetWeekStart,
      },
      status: "CONFIRMED",
    },
    select: {
      id: true,
    },
  });

  if (existingOrder) {
    throw new FoodServiceError(
      "Tu pedido de esta semana ya fue confirmado y no puede modificarse.",
      409,
    );
  }

  const targetWeek = await db.menuWeek.findUnique({
    where: {
      weekStart: targetWeekStart,
    },
    select: {
      id: true,
      status: true,
      weekStart: true,
      days: {
        select: {
          id: true,
          serviceDate: true,
          items: {
            where: {
              available: true,
              archivedAt: null,
            },
            select: {
              id: true,
              serviceType: true,
            },
          },
        },
      },
    },
  });

  if (!targetWeek || targetWeek.status !== "PUBLISHED") {
    throw new FoodServiceError(
      "El menú de la próxima semana todavía no está publicado.",
      409,
    );
  }


  const employee = await db.employee.findUnique({
    where: {
      id: employeeId,
    },
    select: {
      status: true,
      workShift: {
        select: {
          code: true,
          startTime: true,
          endTime: true,
          crossesMidnight: true,
          active: true,
        },
      },
    },
  });

  if (!employee || employee.status !== "ACTIVE") {
    throw new FoodServiceError(
      "El colaborador no se encuentra activo.",
      409,
    );
  }

  if (!employee.workShift || !employee.workShift.active) {
    throw new FoodServiceError(
      "El colaborador no tiene un turno activo configurado para Food Services.",
      409,
    );
  }

  const availableItems = targetWeek.days.flatMap((day) =>
    day.items.map((item) => ({
      id: item.id,
      serviceType: item.serviceType,
      serviceDate: day.serviceDate,
    })),
  );

  const availableItemMap = new Map(
    availableItems.map((item) => [item.id, item]),
  );

  for (const menuItemId of menuItemIds) {
    if (!availableItemMap.has(menuItemId)) {
      throw new FoodServiceError(
        "La selección contiene una opción que no pertenece al menú disponible de la próxima semana.",
        409,
      );
    }
  }

  try {
    const shiftPolicy = getFoodShiftPolicy(
      employee.workShift,
    );

    validateFoodSelectionForShift(
      shiftPolicy,
      menuItemIds.map((menuItemId) => {
        const item = availableItemMap.get(menuItemId);

        if (!item) {
          throw new FoodServiceError(
            "La selecci?n contiene una opci?n inv?lida.",
            409,
          );
        }

        return {
          serviceDate: item.serviceDate,
          serviceType: item.serviceType,
        };
      }),
    );
  } catch (error) {
    if (error instanceof FoodServiceError) {
      throw error;
    }

    if (error instanceof FoodShiftPolicyError) {
      throw new FoodServiceError(
        error.message,
        409,
      );
    }

    throw error;
  }

  const serviceSelections = new Set<string>();

  for (const menuItemId of menuItemIds) {
    const item = availableItemMap.get(menuItemId);

    if (!item) {
      throw new FoodServiceError(
        "La selecci?n contiene una opci?n inv?lida.",
        409,
      );
    }

    const serviceKey = `${item.serviceDate.toISOString().slice(0, 10)}:${item.serviceType}`;

    if (serviceSelections.has(serviceKey)) {
      throw new FoodServiceError(
        "Solo puedes seleccionar una opción de desayuno y una opción de comida por día.",
        409,
      );
    }

    serviceSelections.add(serviceKey);
  }

  const targetWeekItemIds = availableItems.map(
    (item) => item.id,
  );

  const currentReservations =
    await db.reservation.findMany({
      where: {
        employeeId,
        menuItemId: {
          in: targetWeekItemIds,
        },
      },
      select: {
        id: true,
        menuItemId: true,
        status: true,
        consumption: {
          select: {
            id: true,
          },
        },
      },
    });

  const selectedIds = new Set(menuItemIds);

  const reservationsToDelete =
    currentReservations.filter(
      (reservation) =>
        !selectedIds.has(reservation.menuItemId),
    );

  const existingSelectedIds = new Set(
    currentReservations
      .filter((reservation) =>
        selectedIds.has(reservation.menuItemId),
      )
      .map((reservation) => reservation.menuItemId),
  );

  const menuItemIdsToCreate = menuItemIds.filter(
    (menuItemId) =>
      !existingSelectedIds.has(menuItemId),
  );

  const protectedReservation =
    reservationsToDelete.find(
      (reservation) =>
        Boolean(reservation.consumption),
    );

  if (protectedReservation) {
    throw new FoodServiceError(
      "No es posible eliminar una reservación que ya tiene un consumo registrado.",
      409,
    );
  }

  await db.$transaction(async (tx) => {
    if (reservationsToDelete.length > 0) {
      await tx.reservation.deleteMany({
        where: {
          id: {
            in: reservationsToDelete.map(
              (reservation) => reservation.id,
            ),
          },
        },
      });
    }

    if (menuItemIdsToCreate.length > 0) {
      await tx.reservation.createMany({
        data: menuItemIdsToCreate.map(
          (menuItemId) => ({
            employeeId,
            menuItemId,
            status: "ACTIVE",
          }),
        ),
      });
    }

    const cancelledSelectedReservations =
      currentReservations.filter(
        (reservation) =>
          selectedIds.has(reservation.menuItemId) &&
          reservation.status === "CANCELLED",
      );

    if (cancelledSelectedReservations.length > 0) {
      await tx.reservation.updateMany({
        where: {
          id: {
            in: cancelledSelectedReservations.map(
              (reservation) => reservation.id,
            ),
          },
        },
        data: {
          status: "ACTIVE",
        },
      });
    }
  });

  return {
    weekStart: targetWeek.weekStart,
    selectedCount: menuItemIds.length,
  };
}

export async function confirmWeeklyOrder(
  employeeId: string,
  menuItemIds: string[],
) {
  const reservationWindow = getReservationWindowStatus();

  if (!reservationWindow.isOpen) {
    throw new FoodServiceError(
      "La ventana de reservaciones está cerrada. Los pedidos abren el viernes a las 12:00 y cierran el sábado a las 23:59.",
      409,
    );
  }

  if (menuItemIds.length === 0) {
    throw new FoodServiceError(
      "Selecciona al menos un platillo antes de confirmar tu pedido.",
      409,
    );
  }

  const targetWeekStart = reservationWindow.targetWeekStart;

  const targetWeek = await db.menuWeek.findUnique({
    where: {
      weekStart: targetWeekStart,
    },
    select: {
      id: true,
      status: true,
      weekStart: true,
      days: {
        select: {
          serviceDate: true,
          items: {
            where: {
              available: true,
              archivedAt: null,
            },
            select: {
              id: true,
              serviceType: true,
            },
          },
        },
      },
    },
  });

  if (!targetWeek || targetWeek.status !== "PUBLISHED") {
    throw new FoodServiceError(
      "El menú de la próxima semana todavía no está publicado.",
      409,
    );
  }

  const employee = await db.employee.findUnique({
    where: {
      id: employeeId,
    },
    select: {
      status: true,
      workShift: {
        select: {
          code: true,
          startTime: true,
          endTime: true,
          crossesMidnight: true,
          active: true,
        },
      },
    },
  });

  if (!employee || employee.status !== "ACTIVE") {
    throw new FoodServiceError(
      "El colaborador no se encuentra activo.",
      409,
    );
  }

  if (!employee.workShift || !employee.workShift.active) {
    throw new FoodServiceError(
      "El colaborador no tiene un turno activo configurado para Food Services.",
      409,
    );
  }

  const availableItems = targetWeek.days.flatMap((day) =>
    day.items.map((item) => ({
      id: item.id,
      serviceType: item.serviceType,
      serviceDate: day.serviceDate,
    })),
  );

  const availableItemMap = new Map(
    availableItems.map((item) => [item.id, item]),
  );

  for (const menuItemId of menuItemIds) {
    if (!availableItemMap.has(menuItemId)) {
      throw new FoodServiceError(
        "La selección contiene una opción que no pertenece al menú disponible de la próxima semana.",
        409,
      );
    }
  }

  try {
    const shiftPolicy = getFoodShiftPolicy(
      employee.workShift,
    );

    validateFoodSelectionForShift(
      shiftPolicy,
      menuItemIds.map((menuItemId) => {
        const item = availableItemMap.get(menuItemId);

        if (!item) {
          throw new FoodServiceError(
            "La selección contiene una opción inválida.",
            409,
          );
        }

        return {
          serviceDate: item.serviceDate,
          serviceType: item.serviceType,
        };
      }),
    );
  } catch (error) {
    if (error instanceof FoodServiceError) {
      throw error;
    }

    if (error instanceof FoodShiftPolicyError) {
      throw new FoodServiceError(
        error.message,
        409,
      );
    }

    throw error;
  }

  const serviceSelections = new Set<string>();

  for (const menuItemId of menuItemIds) {
    const item = availableItemMap.get(menuItemId);

    if (!item) {
      throw new FoodServiceError(
        "La selección contiene una opción inválida.",
        409,
      );
    }

    const serviceKey =
      `${item.serviceDate.toISOString().slice(0, 10)}:${item.serviceType}`;

    if (serviceSelections.has(serviceKey)) {
      throw new FoodServiceError(
        "Solo puedes seleccionar una opción de desayuno y una opción de comida por día.",
        409,
      );
    }

    serviceSelections.add(serviceKey);
  }

  const itemCount = menuItemIds.length;
  const totalAmount = (
    Number(FOOD_SERVICE_PRICE) * itemCount
  ).toFixed(2);

  try {
    return await db.$transaction(async (tx) => {
      const existingOrder = await tx.foodOrder.findUnique({
        where: {
          employeeId_menuWeekId: {
            employeeId,
            menuWeekId: targetWeek.id,
          },
        },
        select: {
          id: true,
        },
      });

      if (existingOrder) {
        throw new FoodServiceError(
          "Tu pedido de esta semana ya fue confirmado y no puede modificarse.",
          409,
        );
      }

      const targetWeekItemIds = availableItems.map(
        (item) => item.id,
      );

      const existingReservations =
        await tx.reservation.findMany({
          where: {
            employeeId,
            menuItemId: {
              in: targetWeekItemIds,
            },
          },
          select: {
            id: true,
            consumption: {
              select: {
                id: true,
              },
            },
          },
        });

      const protectedReservation =
        existingReservations.find(
          (reservation) =>
            Boolean(reservation.consumption),
        );

      if (protectedReservation) {
        throw new FoodServiceError(
          "No es posible confirmar el pedido porque existe un consumo registrado en esta semana.",
          409,
        );
      }

      if (existingReservations.length > 0) {
        await tx.reservation.deleteMany({
          where: {
            id: {
              in: existingReservations.map(
                (reservation) => reservation.id,
              ),
            },
          },
        });
      }

      const order = await tx.foodOrder.create({
        data: {
          employeeId,
          menuWeekId: targetWeek.id,
          status: "CONFIRMED",
          itemCount,
          unitPrice: FOOD_SERVICE_PRICE,
          totalAmount,
        },
      });

      await tx.reservation.createMany({
        data: menuItemIds.map((menuItemId) => ({
          employeeId,
          menuItemId,
          foodOrderId: order.id,
          status: "ACTIVE",
        })),
      });

      return {
        id: order.id,
        weekStart: targetWeek.weekStart,
        itemCount,
        unitPrice: FOOD_SERVICE_PRICE,
        totalAmount,
        confirmedAt: order.confirmedAt,
        status: order.status,
      };
    });
  } catch (error) {
    if (error instanceof FoodServiceError) {
      throw error;
    }

    const existingOrder = await db.foodOrder.findUnique({
      where: {
        employeeId_menuWeekId: {
          employeeId,
          menuWeekId: targetWeek.id,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingOrder) {
      throw new FoodServiceError(
        "Tu pedido de esta semana ya fue confirmado y no puede modificarse.",
        409,
      );
    }

    throw new FoodServiceError(
      "No fue posible confirmar el pedido.",
      500,
    );
  }
}

export async function registerConsumption(
  employeeId: string,
  menuItemId: string,
  credentialType:
    | "EMPLOYEE_NUMBER"
    | "QR"
    | "BARCODE"
    | "NFC",
) {
  const reservation =
    await db.reservation.findUnique({
      where: {
        employeeId_menuItemId: {
          employeeId,
          menuItemId,
        },
      },
      select: {
        id: true,
        status: true,
        consumption: {
          select: {
            id: true,
          },
        },
        menuItem: {
          select: {
            id: true,
            available: true,
            archivedAt: true,
            menuDay: {
              select: {
                menuWeek: {
                  select: {
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });

  if (!reservation) {
    throw new FoodServiceError(
      "El empleado no reservó esta opción. No se puede registrar el consumo.",
      409,
    );
  }

  if (reservation.status !== "ACTIVE") {
    throw new FoodServiceError(
      "La reserva no está activa.",
      409,
    );
  }

  if (reservation.consumption) {
    throw new FoodServiceError(
      "Esta reserva ya fue entregada.",
      409,
    );
  }

  const item = reservation.menuItem;

  if (
    !item.available ||
    item.archivedAt ||
    item.menuDay.menuWeek.status !==
      "PUBLISHED"
  ) {
    throw new FoodServiceError(
      "La opción ya no está disponible.",
      409,
    );
  }

  try {
    return await db.consumption.create({
      data: {
        employeeId,
        menuItemId: item.id,
        reservationId: reservation.id,
        priceApplied: FOOD_SERVICE_PRICE,
        credentialType,
      },
    });
  } catch {
    const existingConsumption =
      await db.consumption.findUnique({
        where: {
          employeeId_menuItemId: {
            employeeId,
            menuItemId,
          },
        },
        select: {
          id: true,
        },
      });

    if (existingConsumption) {
      throw new FoodServiceError(
        "Esta reserva ya fue entregada.",
        409,
      );
    }

    throw new FoodServiceError(
      "No fue posible registrar el consumo.",
      500,
    );
  }
}