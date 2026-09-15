import { z } from "zod";

const optionalDate = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "La fecha debe tener formato AAAA-MM-DD",
  )
  .transform((value) => (value === "" ? null : value));

const requiredDate = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "La fecha debe tener formato AAAA-MM-DD",
  );

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value === "" ? null : value));

const requiredText = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1, "Este campo es obligatorio")
    .max(maxLength);

const optionalEmail = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" || z.string().email().safeParse(value).success,
    "El correo electrónico no es válido",
  )
  .transform((value) => (value === "" ? null : value));

export const employeeProfileSchema = z.object({
  birthDate: optionalDate,
  hireDate: optionalDate,
  contractType: z
    .enum([
      "INDEFINITE",
      "FIXED_TERM",
      "TEMPORARY",
      "TRAINING",
      "OTHER",
    ])
    .nullable(),
  phone: optionalText(30),
  email: optionalEmail,
  transportRoute: optionalText(150),
});

export const employeeMovementTypeSchema = z.enum([
  "HIRE",
  "POSITION_CHANGE",
  "DEPARTMENT_CHANGE",
  "SHIFT_CHANGE",
  "PROMOTION",
  "TERMINATION",
  "REHIRE",
]);

export const employeeMovementSchema = z
  .object({
    type: employeeMovementTypeSchema,
    effectiveDate: requiredDate,

    reason: optionalText(250),
    notes: optionalText(1000),

    newPosition: optionalText(150),
    newDepartmentId: optionalText(100),
    newWorkShiftId: optionalText(100),
  })
  .superRefine((input, ctx) => {
    switch (input.type) {
      case "HIRE":
        if (!input.newDepartmentId) {
          addRequiredIssue(
            ctx,
            "newDepartmentId",
            "El departamento es obligatorio para un alta",
          );
        }
        break;

      case "POSITION_CHANGE":
        if (!input.newPosition) {
          addRequiredIssue(
            ctx,
            "newPosition",
            "El nuevo puesto es obligatorio",
          );
        }
        break;

      case "DEPARTMENT_CHANGE":
        if (!input.newDepartmentId) {
          addRequiredIssue(
            ctx,
            "newDepartmentId",
            "El nuevo departamento es obligatorio",
          );
        }
        break;

      case "SHIFT_CHANGE":
        if (!input.newWorkShiftId) {
          addRequiredIssue(
            ctx,
            "newWorkShiftId",
            "El nuevo turno es obligatorio",
          );
        }
        break;

      case "PROMOTION":
        if (!input.newPosition) {
          addRequiredIssue(
            ctx,
            "newPosition",
            "El nuevo puesto es obligatorio para una promoción",
          );
        }
        break;

      case "TERMINATION":
        if (!input.reason) {
          addRequiredIssue(
            ctx,
            "reason",
            "El motivo de baja es obligatorio",
          );
        }
        break;

      case "REHIRE":
        if (!input.newDepartmentId) {
          addRequiredIssue(
            ctx,
            "newDepartmentId",
            "El departamento es obligatorio para un reingreso",
          );
        }
        break;
    }
  });

export const employeeMovementRequestSchema = z.object({
  employeeId: requiredText(100),
  movement: employeeMovementSchema,
});

export type EmployeeProfileInput = z.infer<
  typeof employeeProfileSchema
>;

export type EmployeeMovementTypeInput = z.infer<
  typeof employeeMovementTypeSchema
>;

export type EmployeeMovementInput = z.infer<
  typeof employeeMovementSchema
>;

export type EmployeeMovementRequestInput = z.infer<
  typeof employeeMovementRequestSchema
>;

function addRequiredIssue(
  ctx: z.RefinementCtx,
  field:
    | "reason"
    | "newPosition"
    | "newDepartmentId"
    | "newWorkShiftId",
  message: string,
) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [field],
    message,
  });
}