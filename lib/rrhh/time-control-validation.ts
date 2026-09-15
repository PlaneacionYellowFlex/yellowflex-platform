import { z } from "zod";

export const employeeTimeMovementTypeSchema = z.enum([
  "DEBT",
  "RECOVERY",
  "CREDIT_ADJUSTMENT",
  "DEBIT_ADJUSTMENT",
]);

export const employeeTimeReasonSchema = z.enum([
  "LATE_ARRIVAL",
  "ABSENCE",
  "EARLY_DEPARTURE",
  "PERMISSION",
  "OTHER",
]);

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

export const employeeTimeMovementSchema = z.object({
  type: employeeTimeMovementTypeSchema,
  reason: employeeTimeReasonSchema,
  minutes: z
    .number()
    .int("Los minutos deben ser un número entero")
    .positive("Los minutos deben ser mayores a cero")
    .max(
      10080,
      "Un movimiento no puede superar 168 horas",
    ),
  effectiveDate: requiredDate,
  notes: optionalText(1000),
});

export const employeeTimeMovementRequestSchema = z.object({
  employeeId: z
    .string()
    .trim()
    .min(1, "El colaborador es obligatorio")
    .max(100),
  movement: employeeTimeMovementSchema,
});

export type EmployeeTimeMovementTypeInput = z.infer<
  typeof employeeTimeMovementTypeSchema
>;

export type EmployeeTimeReasonInput = z.infer<
  typeof employeeTimeReasonSchema
>;

export type EmployeeTimeMovementInput = z.infer<
  typeof employeeTimeMovementSchema
>;

export type EmployeeTimeMovementRequestInput = z.infer<
  typeof employeeTimeMovementRequestSchema
>;