export const HR_REQUEST_TYPES = {
  VACATION: { label: "Vacaciones", route: "MANAGER_THEN_HR" },
  ABSENCE_PERMISSION: { label: "Permiso de ausencia", route: "MANAGER_THEN_HR" },
  EARLY_DEPARTURE: { label: "Salida anticipada", route: "MANAGER_THEN_HR" },
  LATE_ARRIVAL: { label: "Entrada tardía", route: "MANAGER_THEN_HR" },
  HOURLY_PERMISSION: { label: "Permiso por horas", route: "MANAGER_THEN_HR" },
  ABSENCE_JUSTIFICATION: { label: "Justificación de falta", route: "HR_DIRECT" },
  LATE_JUSTIFICATION: { label: "Justificación de retardo", route: "HR_DIRECT" },
  MEDICAL_LEAVE: { label: "Incapacidad", route: "HR_DIRECT" },
} as const;

export type HrRequestTypeKey = keyof typeof HR_REQUEST_TYPES;

export const HR_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING_MANAGER: "Pendiente de jefe",
  PENDING_HR: "Pendiente de RH",
  INFORMATION_REQUIRED: "Información requerida",
  AUTHORIZED: "Autorizada",
  REJECTED: "Rechazada",
  CANCELLED: "Cancelada",
};

export function isHrRequestType(value: string): value is HrRequestTypeKey {
  return Object.prototype.hasOwnProperty.call(HR_REQUEST_TYPES, value);
}
