import "server-only";

import type { FoodServiceType } from "@prisma/client";

import { db } from "@/lib/db";
import {
  addFoodDays,
  getNextFoodWeekStart,
} from "@/lib/food-services/calendar";
import { FOOD_SERVICE_PRICE } from "@/lib/food-services/config";
import type { ChefWeeklyMenuInput } from "@/lib/food-services/validation";

export class ChefServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const menuWeekInclude = {
  days: {
    orderBy: {
      serviceDate: "asc" as const,
    },
    include: {
      items: {
        where: {
          archivedAt: null,
        },
        orderBy: [
          {
            serviceType: "asc" as const,
          },
          {
            name: "asc" as const,
          },
        ],
      },
    },
  },
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function getEditableWeekStart() {
  let weekStart = getNextFoodWeekStart();

  while (true) {
    const existingWeek =
      await db.menuWeek.findUnique({
        where: {
          weekStart,
        },
        select: {
          status: true,
        },
      });

    if (
      !existingWeek ||
      existingWeek.status === "DRAFT"
    ) {
      return weekStart;
    }

    weekStart = addFoodDays(
      weekStart,
      7,
    );
  }
}

function validateWeekDates(
  weekStart: Date,
  input: ChefWeeklyMenuInput,
) {
  if (
    dateKey(input.weekStart) !==
    dateKey(weekStart)
  ) {
    throw new ChefServiceError(
      "La semana enviada no corresponde a la próxima semana editable.",
      409,
    );
  }

  const expectedDates = new Set(
    Array.from(
      {
        length: 7,
      },
      (_, index) =>
        dateKey(
          addFoodDays(
            weekStart,
            index,
          ),
        ),
    ),
  );

  for (const day of input.days) {
    if (
      !expectedDates.has(
        dateKey(day.serviceDate),
      )
    ) {
      throw new ChefServiceError(
        "El menú contiene una fecha fuera de la semana operativa.",
        409,
      );
    }
  }
}

export async function getOrCreateNextMenuWeek() {
  const weekStart =
    await getEditableWeekStart();

  const existingWeek =
    await db.menuWeek.findUnique({
      where: {
        weekStart,
      },
      include: menuWeekInclude,
    });

  if (existingWeek) {
    return existingWeek;
  }

  try {
    await db.$transaction([
      db.menuWeek.create({
        data: {
          weekStart,
          status: "DRAFT",
        },
      }),
    ]);
  } catch (error) {
    const existingAfterRace =
      await db.menuWeek.findUnique({
        where: {
          weekStart,
        },
      });

    if (!existingAfterRace) {
      throw error;
    }
  }

  const menuWeek =
    await db.menuWeek.findUnique({
      where: {
        weekStart,
      },
    });

  if (!menuWeek) {
    throw new ChefServiceError(
      "No fue posible crear la semana de menú.",
      500,
    );
  }

  const existingDays =
    await db.menuDay.findMany({
      where: {
        menuWeekId: menuWeek.id,
      },
      select: {
        serviceDate: true,
      },
    });

  const existingDateKeys = new Set(
    existingDays.map((day) =>
      dateKey(day.serviceDate),
    ),
  );

  const missingDays = Array.from(
    {
      length: 7,
    },
    (_, index) =>
      addFoodDays(
        weekStart,
        index,
      ),
  ).filter(
    (serviceDate) =>
      !existingDateKeys.has(
        dateKey(serviceDate),
      ),
  );

  if (missingDays.length > 0) {
    await db.menuDay.createMany({
      data: missingDays.map(
        (serviceDate) => ({
          menuWeekId: menuWeek.id,
          serviceDate,
        }),
      ),
      skipDuplicates: true,
    });
  }

  const createdWeek =
    await db.menuWeek.findUnique({
      where: {
        id: menuWeek.id,
      },
      include: menuWeekInclude,
    });

  if (!createdWeek) {
    throw new ChefServiceError(
      "No fue posible recuperar la semana de menú creada.",
      500,
    );
  }

  return createdWeek;
}

export async function saveNextMenuWeek(
  input: ChefWeeklyMenuInput,
) {
  const weekStart =
    await getEditableWeekStart();

  validateWeekDates(
    weekStart,
    input,
  );

  const menuWeek =
    await getOrCreateNextMenuWeek();

  if (menuWeek.status !== "DRAFT") {
    throw new ChefServiceError(
      "El menú ya fue publicado o archivado y no puede modificarse como borrador.",
      409,
    );
  }

  if (
    dateKey(menuWeek.weekStart) !==
    dateKey(weekStart)
  ) {
    throw new ChefServiceError(
      "La semana editable cambió durante la operación. Actualiza la página e inténtalo nuevamente.",
      409,
    );
  }

  const menuDays =
    await db.menuDay.findMany({
      where: {
        menuWeekId: menuWeek.id,
      },
      include: {
        items: {
          where: {
            archivedAt: null,
          },
        },
      },
    });

  const dayByDate = new Map(
    menuDays.map((day) => [
      dateKey(day.serviceDate),
      day,
    ]),
  );

  const operations = [];

  for (const inputDay of input.days) {
    const key = dateKey(
      inputDay.serviceDate,
    );

    const menuDay =
      dayByDate.get(key);

    if (!menuDay) {
      throw new ChefServiceError(
        `No existe el día operativo ${key} dentro de la semana.`,
        409,
      );
    }

    const submittedServices =
      new Set<FoodServiceType>(
        inputDay.items.map(
          (item) =>
            item.serviceType,
        ),
      );

    for (
      const existingItem of menuDay.items
    ) {
      if (
        !submittedServices.has(
          existingItem.serviceType,
        )
      ) {
        operations.push(
          db.menuItem.update({
            where: {
              id: existingItem.id,
            },
            data: {
              available: false,
              archivedAt: new Date(),
            },
          }),
        );
      }
    }

    for (
      const inputItem of inputDay.items
    ) {
      const existingItem =
        menuDay.items.find(
          (item) =>
            item.serviceType ===
            inputItem.serviceType,
        );

      const description =
        inputItem.description?.trim() ||
        null;

      if (existingItem) {
        operations.push(
          db.menuItem.update({
            where: {
              id: existingItem.id,
            },
            data: {
              name:
                inputItem.name.trim(),
              description,
              price:
                FOOD_SERVICE_PRICE,
              available: true,
              archivedAt: null,
            },
          }),
        );

        continue;
      }

      operations.push(
        db.menuItem.create({
          data: {
            menuDayId: menuDay.id,
            serviceType:
              inputItem.serviceType,
            name:
              inputItem.name.trim(),
            description,
            price:
              FOOD_SERVICE_PRICE,
            available: true,
          },
        }),
      );
    }
  }

  if (operations.length > 0) {
    await db.$transaction(
      operations,
    );
  }

  const savedWeek =
    await db.menuWeek.findUnique({
      where: {
        id: menuWeek.id,
      },
      include: menuWeekInclude,
    });

  if (!savedWeek) {
    throw new ChefServiceError(
      "No fue posible recuperar el menú semanal guardado.",
      500,
    );
  }

  return savedWeek;
}

export async function publishNextMenuWeek() {
  const weekStart =
    await getEditableWeekStart();

  const menuWeek =
    await db.menuWeek.findUnique({
      where: {
        weekStart,
      },
      include: menuWeekInclude,
    });

  if (!menuWeek) {
    throw new ChefServiceError(
      "No existe un borrador de menú para publicar.",
      404,
    );
  }

  if (menuWeek.status !== "DRAFT") {
    throw new ChefServiceError(
      "La semana ya no se encuentra disponible para publicación.",
      409,
    );
  }

  const activeServices =
    menuWeek.days.reduce(
      (total, day) =>
        total +
        day.items.filter(
          (item) =>
            item.available &&
            !item.archivedAt,
        ).length,
      0,
    );

  if (activeServices === 0) {
    throw new ChefServiceError(
      "No es posible publicar una semana sin servicios configurados.",
      409,
    );
  }

  const publishedWeek =
    await db.menuWeek.update({
      where: {
        id: menuWeek.id,
      },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
      include: menuWeekInclude,
    });

  return {
    menuWeek: publishedWeek,
    activeServices,
    maximumServices: 14,
  };
}

export async function getChefMenuHistory() {
  const weeks =
    await db.menuWeek.findMany({
      where: {
        status: "PUBLISHED",
      },
      orderBy: {
        weekStart: "desc",
      },
      take: 5,
      include: menuWeekInclude,
    });

  return weeks.map((week) => {
    const activeServices =
      week.days.reduce(
        (total, day) =>
          total +
          day.items.filter(
            (item) =>
              item.available &&
              !item.archivedAt,
          ).length,
        0,
      );

    return {
      id: week.id,
      weekStart: week.weekStart,
      status: week.status,
      publishedAt: week.publishedAt,
      activeServices,
      maximumServices: 14,
      days: week.days,
    };
  });
}