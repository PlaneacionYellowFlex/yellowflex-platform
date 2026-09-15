import { z } from "zod";

export const employeeAccessSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(64),
  pin: z
    .string()
    .regex(
      /^\d{4,12}$/,
      "El PIN debe contener entre 4 y 12 dígitos.",
    ),
});

export const changeEmployeePinSchema = z
  .object({
    newPin: z
      .string()
      .regex(
        /^\d{6}$/,
        "El nuevo PIN debe contener exactamente 6 dígitos.",
      ),
    confirmPin: z
      .string()
      .regex(
        /^\d{6}$/,
        "La confirmación debe contener exactamente 6 dígitos.",
      ),
  })
  .refine(
    (input) => input.newPin === input.confirmPin,
    {
      message: "Los PIN no coinciden.",
      path: ["confirmPin"],
    },
  );
export const reservationSchema = z.object({
  menuItemId: z.string().cuid(),
});

export const weeklyReservationSchema = z.object({
  menuItemIds: z
    .array(z.string().cuid())
    .max(
      14,
      "La selección semanal excede el número máximo de servicios permitidos.",
    )
    .refine(
      (items) => new Set(items).size === items.length,
      "La selección contiene opciones duplicadas.",
    ),
});

export const consumptionSchema = z.object({
  menuItemId: z.string().cuid(),
  credentialType: z
    .enum([
      "EMPLOYEE_NUMBER",
      "QR",
      "BARCODE",
      "NFC",
    ])
    .default("EMPLOYEE_NUMBER"),
});

const chefMenuItemSchema = z.object({
  serviceType: z.enum([
    "BREAKFAST",
    "LUNCH",
  ]),
  name: z
    .string()
    .trim()
    .min(
      1,
      "El nombre del platillo es obligatorio.",
    )
    .max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable(),
});

const chefMenuDaySchema = z
  .object({
    serviceDate: z.coerce.date(),
    items: z
      .array(chefMenuItemSchema)
      .max(
        2,
        "Cada día admite como máximo un desayuno y una comida.",
      ),
  })
  .superRefine((day, context) => {
    const serviceTypes = day.items.map(
      (item) => item.serviceType,
    );

    if (
      new Set(serviceTypes).size !==
      serviceTypes.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message:
          "No puede existir más de un servicio del mismo tipo por día.",
      });
    }
  });

export const chefWeeklyMenuSchema = z
  .object({
    weekStart: z.coerce.date(),
    days: z
      .array(chefMenuDaySchema)
      .length(
        7,
        "El menú semanal debe contener exactamente 7 días.",
      ),
  })
  .superRefine((week, context) => {
    const dates = week.days.map(
      (day) =>
        day.serviceDate
          .toISOString()
          .slice(0, 10),
    );

    if (new Set(dates).size !== 7) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days"],
        message:
          "El menú semanal contiene fechas duplicadas.",
      });
    }
  });

export type ChefWeeklyMenuInput =
  z.infer<typeof chefWeeklyMenuSchema>;

export const extraordinaryFoodServiceSchema = z.object({
  menuItemId: z.string().cuid(),
  guestName: z.string().trim().min(2, "El nombre o referencia es obligatorio.").max(120),
  guestType: z.enum(["PROVIDER", "VISITOR", "NEW_HIRE", "OTHER"]),
  company: z.string().trim().max(120).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(50),
  chargeType: z.enum(["YELLOWFLEX", "PROVIDER", "COURTESY", "OTHER"]),
  areaResponsible: z.string().trim().max(120).optional().nullable(),
  reason: z.string().trim().min(2, "El motivo es obligatorio.").max(240),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const cancelExtraordinaryFoodServiceSchema = z.object({
  id: z.string().cuid(),
});

export type ExtraordinaryFoodServiceInput = z.infer<typeof extraordinaryFoodServiceSchema>;
