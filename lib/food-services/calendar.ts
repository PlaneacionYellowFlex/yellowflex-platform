const FOOD_TIME_ZONE =
  process.env.FOOD_TIME_ZONE ?? "America/Mexico_City";

export type FoodLocalDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

export function getFoodTimeZone() {
  return FOOD_TIME_ZONE;
}

export function getFoodLocalDateParts(
  date = new Date(),
): FoodLocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: FOOD_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);

  const getPart = (
    type: Intl.DateTimeFormatPartTypes,
  ) => parts.find((part) => part.type === type)?.value;

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const weekday = getPart("weekday");

  if (
    !weekday ||
    weekdayMap[weekday] === undefined
  ) {
    throw new Error(
      "No fue posible determinar el día local para Food Services.",
    );
  }

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    weekday: weekdayMap[weekday],
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
  };
}

export function getNextFoodWeekStart(
  date = new Date(),
) {
  const local = getFoodLocalDateParts(date);

  const result = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day,
    ),
  );

  const daysUntilMonday =
    local.weekday === 0
      ? 1
      : 8 - local.weekday;

  result.setUTCDate(
    result.getUTCDate() + daysUntilMonday,
  );

  return result;
}

export function addFoodDays(
  date: Date,
  days: number,
) {
  const result = new Date(date);

  result.setUTCDate(
    result.getUTCDate() + days,
  );

  return result;
}