import "server-only";

import { db } from "@/lib/db";
import { getNextFoodWeekStart } from "@/lib/food-services/calendar";
import { getConfirmedFoodOrderSummary, foodAmountCents } from "@/lib/food-services/confirmed-orders";
import { getFoodReferenceDate } from "@/lib/food-services/reference-date";

export async function getChefProductionSummary(weekId?: string) {
  // Validate the private QA reference before exposing its presentation flag.
  getFoodReferenceDate();
  const isQaReference = Boolean(process.env.FOOD_QA_REFERENCE_DATE);
  const menuWeek = await db.menuWeek.findFirst({
    where: {
      ...(weekId ? { id: weekId } : { weekStart: getNextFoodWeekStart() }),
      OR: [{ status: "PUBLISHED" }, { foodOrders: { some: { status: "CONFIRMED" } } }],
    },
    orderBy: {
      weekStart: "desc",
    },
    select: {
      id: true,
      weekStart: true,
      publishedAt: true,
      days: {
        orderBy: {
          serviceDate: "asc",
        },
        select: {
          id: true,
          serviceDate: true,
          items: {
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
              price: true,
            },
          },
        },
      },
    },
  });

  if (!menuWeek) {
    return {
      week: null,
      isQaReference,
      totals: {
        confirmedServices: 0,
        uniqueCollaborators: 0,
        confirmedOrders: 0,
        consumedServices: 0,
        pendingServices: 0,
        extraordinaryServices: 0,
        ordinaryServices: 0,
        ordinaryAmount: "0.00",
      },
      days: [],
    };
  }

  const ordinary = await getConfirmedFoodOrderSummary(db, { weekId: menuWeek.id });
  const reservationsByItem = new Map<string, {
    id: string;
    employee: (typeof ordinary.orders)[number]["employee"];
    foodOrder: { id: string; status: "CONFIRMED" };
    consumption: (typeof ordinary.orders)[number]["services"][number]["consumption"];
    amount: string;
  }[]>();
  for (const order of ordinary.orders) {
    for (const service of order.services) {
      const entries = reservationsByItem.get(service.menuItemId) ?? [];
      entries.push({ id: service.reservationId, employee: order.employee,
        foodOrder: { id: order.id, status: "CONFIRMED" },
        consumption: service.consumption, amount: service.amount });
      reservationsByItem.set(service.menuItemId, entries);
    }
  }

  const extraordinaryRecords = await db.foodExtraordinaryService.findMany({
    where: {
      status: "ACTIVE",
      menuItem: {
        menuDay: {
          menuWeekId: menuWeek.id,
        },
      },
    },
    select: {
      menuItemId: true,
      quantity: true,
    },
  });

  const extraordinaryByItem = extraordinaryRecords.reduce((map, record) => {
    map.set(record.menuItemId, (map.get(record.menuItemId) ?? 0) + record.quantity);
    return map;
  }, new Map<string, number>());

  let confirmedServices = 0;
  let consumedServices = 0;
  let extraordinaryServices = 0;

  const days = menuWeek.days.map((day) => {
    let dayConfirmedServices = 0;
    let dayConsumedServices = 0;

    const services = day.items.map((item) => {
      const reservations = reservationsByItem.get(item.id) ?? [];
      const ordinaryAmount = (reservations.reduce((total, entry) => total + foodAmountCents(entry.amount), 0) / 100).toFixed(2);
      const employeeConfirmed = reservations.length;
      const extraordinary = extraordinaryByItem.get(item.id) ?? 0;
      const confirmed = employeeConfirmed + extraordinary;
      const consumed = reservations.filter(
        (reservation) => reservation.consumption !== null,
      ).length;

      const pending = confirmed - consumed;

      dayConfirmedServices += confirmed;
      dayConsumedServices += consumed;
      extraordinaryServices += extraordinary;

      const collaborators = reservations.map((reservation) => {
        const shift = reservation.employee.workShift;
        return {
          name: reservation.employee.fullName,
          employeeNumber: reservation.employee.employeeNumber,
          shift: shift ? `${shift.code} · ${shift.name}` : "Sin turno asignado",
          quantity: 1,
          orderStatus: reservation.foodOrder?.status ?? null,
        };
      }).sort((a, b) => a.name.localeCompare(b.name, "es") || a.employeeNumber.localeCompare(b.employeeNumber, "es"));

      const departments = Array.from(
        reservations.reduce((map, reservation) => {
          const department = reservation.employee.department;
          const current = map.get(department.id);

          if (current) {
            current.quantity += 1;
          } else {
            map.set(department.id, {
              id: department.id,
              code: department.code,
              name: department.name,
              quantity: 1,
            });
          }

          return map;
        }, new Map<string, {
          id: string;
          code: string;
          name: string;
          quantity: number;
        }>()),
      ).map(([, department]) => department);

      const shifts = Array.from(
        reservations.reduce((map, reservation) => {
          const shift = reservation.employee.workShift;

          if (!shift) {
            const current = map.get("UNASSIGNED");

            if (current) {
              current.quantity += 1;
            } else {
              map.set("UNASSIGNED", {
                id: null,
                code: "SIN_TURNO",
                name: "Sin turno",
                startTime: null,
                endTime: null,
                quantity: 1,
              });
            }

            return map;
          }

          const current = map.get(shift.id);

          if (current) {
            current.quantity += 1;
          } else {
            map.set(shift.id, {
              id: shift.id,
              code: shift.code,
              name: shift.name,
              startTime: shift.startTime,
              endTime: shift.endTime,
              quantity: 1,
            });
          }

          return map;
        }, new Map<string, {
          id: string | null;
          code: string;
          name: string;
          startTime: string | null;
          endTime: string | null;
          quantity: number;
        }>()),
      ).map(([, shift]) => shift);

      return {
        id: item.id,
        serviceType: item.serviceType,
        name: item.name,
        price: item.price,
        confirmed,
        consumed,
        pending,
        employeeConfirmed,
        ordinaryAmount,
        extraordinary,
        collaborators,
        departments,
        shifts,
      };
    });

    confirmedServices += dayConfirmedServices;
    consumedServices += dayConsumedServices;

    return {
      id: day.id,
      serviceDate: day.serviceDate,
      confirmedServices: dayConfirmedServices,
      consumedServices: dayConsumedServices,
      pendingServices:
        dayConfirmedServices - dayConsumedServices,
      services,
    };
  });

  return {
    isQaReference,
    week: {
      id: menuWeek.id,
      weekStart: menuWeek.weekStart,
      publishedAt: menuWeek.publishedAt,
    },
    totals: {
      uniqueCollaborators: ordinary.totals.employees,
      confirmedOrders: ordinary.totals.orders,
      ordinaryServices: ordinary.totals.services,
      ordinaryAmount: ordinary.totals.amount,
      confirmedServices,
      consumedServices,
      pendingServices:
        confirmedServices - consumedServices,
      extraordinaryServices,
    },
    days,
  };
}
