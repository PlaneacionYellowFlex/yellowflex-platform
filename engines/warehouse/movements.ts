import type { InventoryMovementType } from "@prisma/client";

export type InventoryMovementInput = {
  type: InventoryMovementType;
  quantity: number;
  originLocationId?: string | null;
  destinationLocationId?: string | null;
};

export type LocationInventoryEffect = {
  locationId: string;
  quantityDelta: number;
};

export type InventoryMovementValidationResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      error: string;
    };

function hasLocation(value?: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateInventoryMovement(
  input: InventoryMovementInput,
): InventoryMovementValidationResult {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return {
      valid: false,
      error: "La cantidad del movimiento debe ser mayor que cero.",
    };
  }

  const hasOrigin = hasLocation(input.originLocationId);
  const hasDestination = hasLocation(input.destinationLocationId);

  if (
    hasOrigin &&
    hasDestination &&
    input.originLocationId === input.destinationLocationId
  ) {
    return {
      valid: false,
      error: "El origen y el destino no pueden ser la misma ubicación.",
    };
  }

  switch (input.type) {
    case "INITIAL_BALANCE":
    case "EXTERNAL_RECEIPT":
    case "OPERATIONAL_RETURN":
    case "ADJUSTMENT_IN":
      if (hasOrigin || !hasDestination) {
        return {
          valid: false,
          error:
            "Este movimiento requiere únicamente una ubicación de destino.",
        };
      }
      break;

    case "EXTERNAL_ISSUE":
    case "OPERATIONAL_HANDOFF":
    case "ADJUSTMENT_OUT":
      if (!hasOrigin || hasDestination) {
        return {
          valid: false,
          error:
            "Este movimiento requiere únicamente una ubicación de origen.",
        };
      }
      break;

    case "INTERNAL_TRANSFER":
      if (!hasOrigin || !hasDestination) {
        return {
          valid: false,
          error:
            "Una transferencia interna requiere origen y destino.",
        };
      }
      break;

    default: {
      const exhaustiveCheck: never = input.type;
      return {
        valid: false,
        error: `Tipo de movimiento no soportado: ${exhaustiveCheck}`,
      };
    }
  }

  return { valid: true };
}

export function getMovementEffects(
  input: InventoryMovementInput,
): LocationInventoryEffect[] {
  const validation = validateInventoryMovement(input);

  if (!validation.valid) {
    throw new Error(validation.error);
  }

  switch (input.type) {
    case "INITIAL_BALANCE":
    case "EXTERNAL_RECEIPT":
    case "OPERATIONAL_RETURN":
    case "ADJUSTMENT_IN":
      return [
        {
          locationId: input.destinationLocationId as string,
          quantityDelta: input.quantity,
        },
      ];

    case "EXTERNAL_ISSUE":
    case "OPERATIONAL_HANDOFF":
    case "ADJUSTMENT_OUT":
      return [
        {
          locationId: input.originLocationId as string,
          quantityDelta: -input.quantity,
        },
      ];

    case "INTERNAL_TRANSFER":
      return [
        {
          locationId: input.originLocationId as string,
          quantityDelta: -input.quantity,
        },
        {
          locationId: input.destinationLocationId as string,
          quantityDelta: input.quantity,
        },
      ];

    default: {
      const exhaustiveCheck: never = input.type;
      throw new Error(`Tipo de movimiento no soportado: ${exhaustiveCheck}`);
    }
  }
}
