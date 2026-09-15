import {
  getFoodLocalDateParts,
  getFoodTimeZone,
  getNextFoodWeekStart,
} from "@/lib/food-services/calendar";

const RESERVATION_OPEN_DAY = 5; // Viernes
const RESERVATION_CLOSE_DAY = 6; // Sábado

const RESERVATION_OPEN_MINUTES = 12 * 60; // 12:00
const RESERVATION_CLOSE_MINUTES = 23 * 60 + 59; // 23:59

const DEVELOPMENT_RESERVATION_OVERRIDE =
  process.env.NODE_ENV !== "production" &&
  process.env.FOOD_RESERVATION_DEV_OPEN === "true";

export type ReservationWindowStatus = {
  isOpen: boolean;
  timeZone: string;
  targetWeekStart: Date;
  localDay: number;
  localHour: number;
  localMinute: number;
};

export function getReservationWindowStatus(
  date = new Date(),
): ReservationWindowStatus {
  const local = getFoodLocalDateParts(date);

  const currentMinutes =
    local.hour * 60 + local.minute;

  const isFridayOpen =
    local.weekday === RESERVATION_OPEN_DAY &&
    currentMinutes >= RESERVATION_OPEN_MINUTES;

  const isSaturdayOpen =
    local.weekday === RESERVATION_CLOSE_DAY &&
    currentMinutes <= RESERVATION_CLOSE_MINUTES;

  const isRealWindowOpen =
    isFridayOpen || isSaturdayOpen;

  return {
    isOpen:
      isRealWindowOpen ||
      DEVELOPMENT_RESERVATION_OVERRIDE,
    timeZone: getFoodTimeZone(),
    targetWeekStart: getNextFoodWeekStart(date),
    localDay: local.weekday,
    localHour: local.hour,
    localMinute: local.minute,
  };
}