import type { FoodServiceType } from "@prisma/client";

export const FOOD_SERVICE_PRICE = "25.00";

export const foodServiceWindows: Record<
  FoodServiceType,
  {
    start: string;
    end: string;
  }
> = {
  BREAKFAST: {
    start:
      process.env.FOOD_BREAKFAST_START ?? "06:00",
    end:
      process.env.FOOD_BREAKFAST_END ?? "10:00",
  },
  LUNCH: {
    start:
      process.env.FOOD_LUNCH_START ?? "11:00",
    end:
      process.env.FOOD_LUNCH_END ?? "16:00",
  },
};

export function isWithinServiceWindow(
  service: FoodServiceType,
  date = new Date(),
) {
  const current = `${String(date.getHours()).padStart(
    2,
    "0",
  )}:${String(date.getMinutes()).padStart(2, "0")}`;

  const window = foodServiceWindows[service];

  return (
    current >= window.start &&
    current <= window.end
  );
}