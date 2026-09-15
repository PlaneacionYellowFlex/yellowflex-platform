import "server-only";

import { db } from "@/lib/db";

export async function getChefProductionSummary() {
  const menuWeek = await db.menuWeek.findFirst({
    where: {
      status: "PUBLISHED",
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
              price: true,
              reservations: {
                where: {
                  status: "ACTIVE",
                  foodOrder: {
                    status: "CONFIRMED",
                  },
                },
                select: {
                  id: true,
                  employee: {
                    select: {
                      id: true,
                      employeeNumber: true,
                      fullName: true,
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
                  consumption: {
                    select: {
                      id: true,
                      consumedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!menuWeek) {
    return {
      week: null,
      totals: {
        confirmedServices: 0,
        consumedServices: 0,
        pendingServices: 0,
        extraordinaryServices: 0,
      },
      days: [],
    };
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
      const employeeConfirmed = item.reservations.length;
      const extraordinary = extraordinaryByItem.get(item.id) ?? 0;
      const confirmed = employeeConfirmed + extraordinary;
      const consumed = item.reservations.filter(
        (reservation) => reservation.consumption !== null,
      ).length;

      const pending = confirmed - consumed;

      dayConfirmedServices += confirmed;
      dayConsumedServices += consumed;
      extraordinaryServices += extraordinary;

      const departments = Array.from(
        item.reservations.reduce((map, reservation) => {
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
        item.reservations.reduce((map, reservation) => {
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
        extraordinary,
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
    week: {
      id: menuWeek.id,
      weekStart: menuWeek.weekStart,
      publishedAt: menuWeek.publishedAt,
    },
    totals: {
      confirmedServices,
      consumedServices,
      pendingServices:
        confirmedServices - consumedServices,
      extraordinaryServices,
    },
    days,
  };
}
