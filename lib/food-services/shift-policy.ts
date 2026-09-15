import type { FoodServiceType } from "@prisma/client";

export type FoodShiftPolicy = {
  shiftCode: string;
  workdays: number[];
  isNightShift: boolean;
  maximumServicesPerDay: number;
  allowedServiceTypes: FoodServiceType[];
  serviceLabel: string;
};

const DAY_SHIFT_START = "07:00";
const DAY_SHIFT_END = "19:00";
const NIGHT_SHIFT_START = "19:00";
const NIGHT_SHIFT_END = "07:00";

const WORKDAYS_BY_SHIFT: Record<string, number[]> = {
  T1: [1, 2, 3, 4],
  T2: [1, 2, 3, 4],
  T3: [4, 5, 6, 0],
  T4: [4, 5, 6, 0],
};

type WorkShiftInput = {
  code: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
};

export class FoodShiftPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoodShiftPolicyError";
  }
}

export function getFoodShiftPolicy(
  shift: WorkShiftInput,
): FoodShiftPolicy {
  const workdays = WORKDAYS_BY_SHIFT[shift.code];

  if (!workdays) {
    throw new FoodShiftPolicyError(
      `El turno ${shift.code} no tiene días laborales configurados para Food Services.`,
    );
  }

  const isDayShift =
    shift.startTime === DAY_SHIFT_START &&
    shift.endTime === DAY_SHIFT_END &&
    !shift.crossesMidnight;

  const isNightShift =
    shift.startTime === NIGHT_SHIFT_START &&
    shift.endTime === NIGHT_SHIFT_END &&
    shift.crossesMidnight;

  if (!isDayShift && !isNightShift) {
    throw new FoodShiftPolicyError(
      `El horario ${shift.startTime}-${shift.endTime} del turno ${shift.code} no tiene una política de alimentos configurada.`,
    );
  }

  if (isNightShift) {
    return {
      shiftCode: shift.code,
      workdays,
      isNightShift: true,
      maximumServicesPerDay: 1,
      allowedServiceTypes: ["LUNCH"],
      serviceLabel: "Alimento de turno",
    };
  }

  return {
    shiftCode: shift.code,
    workdays,
    isNightShift: false,
    maximumServicesPerDay: 2,
    allowedServiceTypes: ["BREAKFAST", "LUNCH"],
    serviceLabel: "Desayuno + Comida",
  };
}

export function isFoodServiceDateAllowed(
  policy: FoodShiftPolicy,
  serviceDate: Date,
) {
  return policy.workdays.includes(
    serviceDate.getUTCDay(),
  );
}

export function isFoodServiceTypeAllowed(
  policy: FoodShiftPolicy,
  serviceType: FoodServiceType,
) {
  return policy.allowedServiceTypes.includes(
    serviceType,
  );
}

export function validateFoodSelectionForShift(
  policy: FoodShiftPolicy,
  items: Array<{
    serviceDate: Date;
    serviceType: FoodServiceType;
  }>,
) {
  const selectionsPerDay = new Map<string, number>();

  for (const item of items) {
    if (!isFoodServiceDateAllowed(policy, item.serviceDate)) {
      throw new FoodShiftPolicyError(
        "La selección contiene un día que no corresponde al turno del colaborador.",
      );
    }

    if (!isFoodServiceTypeAllowed(policy, item.serviceType)) {
      throw new FoodShiftPolicyError(
        policy.isNightShift
          ? "El turno nocturno solo puede reservar un alimento de turno por día."
          : "La selección contiene un servicio no permitido para el turno del colaborador.",
      );
    }

    const dateKey = item.serviceDate
      .toISOString()
      .slice(0, 10);

    const count =
      (selectionsPerDay.get(dateKey) ?? 0) + 1;

    if (count > policy.maximumServicesPerDay) {
      throw new FoodShiftPolicyError(
        policy.isNightShift
          ? "El turno nocturno solo puede reservar un alimento de turno por día."
          : "Se excedió el número de servicios permitidos para un día.",
      );
    }

    selectionsPerDay.set(dateKey, count);
  }
}