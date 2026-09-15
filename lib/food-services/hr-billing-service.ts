import "server-only";

import { db } from "@/lib/db";

export async function getHrBillingSummary() {
  const orders = await db.foodOrder.findMany({
    where: {
      status: "CONFIRMED",
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
          menuItem: {
            select: {
              id: true,
              serviceType: true,
              name: true,
              price: true,
              menuDay: {
                select: {
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
      menuPrice: reservation.menuItem.price.toString(),
    })),
  }));

  const totalOrders = normalizedOrders.length;

  const totalServices = normalizedOrders.reduce(
    (total, order) => total + order.itemCount,
    0,
  );

  const totalAmount = normalizedOrders.reduce(
    (total, order) => total + Number(order.totalAmount),
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
      amount: totalAmount.toFixed(2),
    },
    weeks,
    orders: normalizedOrders,
  };
}
