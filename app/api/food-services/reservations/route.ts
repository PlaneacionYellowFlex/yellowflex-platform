import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { db } from "@/lib/db";
import { getEmployeeSession } from "@/lib/food-services/employee-session";
import { getReservationWindowStatus } from "@/lib/food-services/reservation-window";
import { saveWeeklyReservations } from "@/lib/food-services/service";
import {
  FoodShiftPolicyError,
  getFoodShiftPolicy,
} from "@/lib/food-services/shift-policy";
import { weeklyReservationSchema } from "@/lib/food-services/validation";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getEmployeeSession();

    if (!session) {
      return NextResponse.json(
        {
          error: "Acceso de empleado requerido.",
        },
        {
          status: 401,
        },
      );
    }

    const reservationWindow =
      getReservationWindowStatus();

    const employee = await db.employee.findUnique({
      where: {
        id: session.employee.id,
      },
      select: {
        id: true,
        employeeNumber: true,
        fullName: true,
        position: true,
        status: true,
        pinMustChange: true,
        department: {
          select: {
            code: true,
            name: true,
          },
        },
        workShift: {
          select: {
            code: true,
            name: true,
            startTime: true,
            endTime: true,
            crossesMidnight: true,
            active: true,
          },
        },
      },
    });

    if (!employee || employee.status !== "ACTIVE") {
      return NextResponse.json(
        {
          error: "El colaborador no se encuentra activo.",
        },
        {
          status: 409,
        },
      );
    }

    if (!employee.workShift || !employee.workShift.active) {
      return NextResponse.json(
        {
          error:
            "El colaborador no tiene un turno activo configurado para Food Services.",
        },
        {
          status: 409,
        },
      );
    }

    let shiftPolicy;

    try {
      shiftPolicy = getFoodShiftPolicy(
        employee.workShift,
      );
    } catch (error) {
      if (error instanceof FoodShiftPolicyError) {
        return NextResponse.json(
          {
            error: error.message,
          },
          {
            status: 409,
          },
        );
      }

      throw error;
    }

    const week = await db.menuWeek.findUnique({
      where: {
        weekStart: reservationWindow.targetWeekStart,
      },
      select: {
        id: true,
        weekStart: true,
        status: true,
        days: {
          select: {
            items: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    const baseData = {
      weekStart: reservationWindow.targetWeekStart,
      isOpen: reservationWindow.isOpen,
      pinMustChange: employee.pinMustChange,
      employee: {
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        position: employee.position,
        department: {
          code: employee.department.code,
          name: employee.department.name,
        },
        workShift: {
          code: employee.workShift.code,
          name: employee.workShift.name,
          startTime: employee.workShift.startTime,
          endTime: employee.workShift.endTime,
          crossesMidnight:
            employee.workShift.crossesMidnight,
        },
      },
      policy: {
        isNightShift: shiftPolicy.isNightShift,
        workdays: shiftPolicy.workdays,
        maximumServicesPerDay:
          shiftPolicy.maximumServicesPerDay,
        allowedServiceTypes:
          shiftPolicy.allowedServiceTypes,
        serviceLabel: shiftPolicy.serviceLabel,
      },
    };

    if (!week || week.status !== "PUBLISHED") {
      return NextResponse.json({
        data: {
          ...baseData,
          menuItemIds: [],
          order: null,
          isConfirmed: false,
        },
      });
    }

    const confirmedOrder = await db.foodOrder.findUnique({
      where: {
        employeeId_menuWeekId: {
          employeeId: employee.id,
          menuWeekId: week.id,
        },
      },
      select: {
        id: true,
        status: true,
        itemCount: true,
        unitPrice: true,
        totalAmount: true,
        confirmedAt: true,
      },
    });

    const weekItemIds = week.days.flatMap((day) =>
      day.items.map((item) => item.id),
    );

    const reservations =
      await db.reservation.findMany({
        where: {
          employeeId: employee.id,
          status: "ACTIVE",
          menuItemId: {
            in: weekItemIds,
          },
        },
        select: {
          menuItemId: true,
        },
      });

    return NextResponse.json({
      data: {
        ...baseData,
        weekStart: week.weekStart,
        menuItemIds: reservations.map(
          (reservation) => reservation.menuItemId,
        ),
        isConfirmed:
          confirmedOrder?.status === "CONFIRMED",
        order: confirmedOrder
          ? {
              id: confirmedOrder.id,
              status: confirmedOrder.status,
              itemCount: confirmedOrder.itemCount,
              unitPrice:
                confirmedOrder.unitPrice.toString(),
              totalAmount:
                confirmedOrder.totalAmount.toString(),
              confirmedAt: confirmedOrder.confirmedAt,
            }
          : null,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getEmployeeSession();

    if (!session) {
      return NextResponse.json(
        {
          error: "Acceso de empleado requerido.",
        },
        {
          status: 401,
        },
      );
    }

    const input = weeklyReservationSchema.parse(
      await request.json(),
    );

    const result = await saveWeeklyReservations(
      session.employee.id,
      input.menuItemIds,
    );

    return NextResponse.json({
      data: {
        weekStart: result.weekStart,
        selectedCount: result.selectedCount,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
