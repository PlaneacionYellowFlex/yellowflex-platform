import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type ConfirmedFoodOrderPeriod = { weekId?: string; orderIds?: string[] };

/** Single ordinary-order source for CHEF, RH and informational reports.
 * Confirmation fixes the charge; consumption and current menu availability do not.
 */
export async function getConfirmedFoodOrderSummary(
  client: Prisma.TransactionClient = db,
  { weekId, orderIds }: ConfirmedFoodOrderPeriod = {},
) {
  const orders = await client.foodOrder.findMany({
    where: {
      status: "CONFIRMED",
      ...(weekId ? { menuWeekId: weekId } : {}),
      ...(orderIds ? { id: { in: orderIds } } : {}),
    },
    orderBy: {
      confirmedAt: "desc",
    },
    select: {
      id: true,
      itemCount: true,
      unitPrice: true,
      totalAmount: true,
      confirmedAt: true,
      menuWeek: {
        select: {
          id: true,
          weekStart: true,
        },
      },
      employee: {
        select: {
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
        },
      },
      reservations: {
        where: {
          status: "ACTIVE",
        },
        orderBy: {
          menuItem: {
            menuDay: {
              serviceDate: "asc",
            },
          },
        },
        select: {
          id: true,
          consumption: { select: { id: true, consumedAt: true } },
          menuItem: {
            select: {
              id: true,
              serviceType: true,
              name: true,
              menuDay: {
                select: {
                  id: true,
                  serviceDate: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const normalizedOrders = orders.map((order) => ({
    id: order.id,
    week: {
      id: order.menuWeek.id,
      weekStart: order.menuWeek.weekStart,
    },
    employee: order.employee,
    itemCount: order.itemCount,
    unitPrice: order.unitPrice.toString(),
    totalAmount: order.totalAmount.toString(),
    confirmedAt: order.confirmedAt,
    services: order.reservations.map((reservation) => ({
      reservationId: reservation.id,
      menuItemId: reservation.menuItem.id,
      serviceDate: reservation.menuItem.menuDay.serviceDate,
      serviceType: reservation.menuItem.serviceType,
      name: reservation.menuItem.name,
      // Compatibility field: historical charge, never the current menu price.
      menuPrice: order.unitPrice.toString(),
      quantity: 1,
      unitPrice: order.unitPrice.toString(),
      amount: order.unitPrice.toString(),
      menuDayId: reservation.menuItem.menuDay.id,
      consumption: reservation.consumption,
    })),
  }));

  const totalOrders = normalizedOrders.length;

  const totalServices = normalizedOrders.reduce(
    (total, order) => total + order.itemCount,
    0,
  );

  const totalAmount = normalizedOrders.reduce(
    (total, order) => total + foodAmountCents(order.totalAmount),
    0,
  );

  const employees = new Set(
    normalizedOrders.map((order) => order.employee.id),
  ).size;

  const weeks = Array.from(
    new Map(
      normalizedOrders.map((order) => [
        order.week.id,
        order.week,
      ]),
    ).values(),
  ).sort(
    (first, second) =>
      second.weekStart.getTime() -
      first.weekStart.getTime(),
  );

  return {
    totals: {
      orders: totalOrders,
      employees,
      services: totalServices,
      amount: (totalAmount / 100).toFixed(2),
    },
    weeks,
    orders: normalizedOrders,
  };
}

/** Decimal(10,2) amounts are added as integer cents, without floating point drift. */
export function foodAmountCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Importe Food Services inválido.");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Importe Food Services fuera de rango.");
  return cents;
}
