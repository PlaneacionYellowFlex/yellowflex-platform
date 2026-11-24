export type PayrollEligibilityReason =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_CONFIRMED"
  | "PAYROLL_STATUS_NOT_PENDING"
  | "ORDER_CANCELLED"
  | "ORDER_UNVERIFIED"
  | "ACTIVE_ASSIGNMENT_EXISTS"
  | "EXTRAORDINARY_SERVICE"
  | "EMPLOYEE_INVALID"
  | "EMPLOYEE_INACTIVE"
  | "SERVICE_WEEK_INVALID"
  | "PAYROLL_PERIOD_INVALID"
  | "ITEM_COUNT_INVALID"
  | "RESERVATIONS_REQUIRED"
  | "RESERVATION_COUNT_MISMATCH"
  | "RESERVATION_ORDER_MISMATCH"
  | "RESERVATION_EMPLOYEE_MISMATCH"
  | "RESERVATION_NOT_ACTIVE"
  | "RESERVATION_MENU_ITEM_INVALID"
  | "RESERVATION_WEEK_MISMATCH"
  | "RESERVATION_DATE_OUTSIDE_WEEK"
  | "UNIT_PRICE_INVALID"
  | "TOTAL_AMOUNT_INVALID"
  | "TOTAL_AMOUNT_MISMATCH";

export type PayrollEligibilityInput = {
  id: string;
  status: string;
  payrollStatus: string;
  employeeId: string;
  employee: { id: string; employeeNumber: string; fullName: string; status: string } | null;
  menuWeekId: string;
  menuWeek: { id: string; weekStart: Date } | null;
  itemCount: number;
  unitPrice: unknown;
  totalAmount: unknown;
  reservations: Array<{
    id: string;
    foodOrderId: string | null;
    employeeId: string;
    status: string;
    menuItem: { menuDay: { menuWeekId: string; serviceDate: Date } } | null;
  }>;
  payrollAssignments?: Array<{ status: string }>;
  isExtraordinary?: boolean;
};

export type FoodPayrollEligibility = {
  eligible: boolean;
  reasons: PayrollEligibilityReason[];
  orderId: string;
  employeeId?: string;
  employeeNumber?: string;
  employeeName?: string;
  serviceWeekStart?: Date;
  payrollPeriod: string;
  quantity?: number;
  historicalUnitPrice?: string;
  committedAmount?: string;
};

function moneyCents(value: unknown): number | null {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value)
    : value && typeof (value as { toString?: unknown }).toString === "function"
      ? (value as { toString(): string }).toString()
      : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function plusDaysUtc(date: Date, days: number) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** Pure rules. No menu price is read or used: FoodOrder.unitPrice is the historical price. */
export function evaluateFoodPayrollEligibility(
  order: PayrollEligibilityInput | null,
  payrollPeriod: string,
): FoodPayrollEligibility {
  if (!order) return { eligible: false, reasons: ["ORDER_NOT_FOUND"], orderId: "", payrollPeriod };
  const reasons: PayrollEligibilityReason[] = [];
  if (order.status === "CANCELLED") reasons.push("ORDER_CANCELLED");
  else if (order.status !== "CONFIRMED") reasons.push("ORDER_NOT_CONFIRMED");
  if (order.payrollStatus === "UNVERIFIED") reasons.push("ORDER_UNVERIFIED");
  else if (order.payrollStatus !== "PENDING") reasons.push("PAYROLL_STATUS_NOT_PENDING");
  if (order.payrollAssignments?.some((assignment) => assignment.status === "ACTIVE")) reasons.push("ACTIVE_ASSIGNMENT_EXISTS");
  if (order.isExtraordinary) reasons.push("EXTRAORDINARY_SERVICE");
  if (!order.employee || order.employee.id !== order.employeeId || !order.employee.employeeNumber.trim() || !order.employee.fullName.trim()) {
    reasons.push("EMPLOYEE_INVALID");
  } else if (order.employee.status !== "ACTIVE") {
    reasons.push("EMPLOYEE_INACTIVE");
  }
  if (!order.menuWeek || order.menuWeek.id !== order.menuWeekId || Number.isNaN(order.menuWeek.weekStart.getTime())) {
    reasons.push("SERVICE_WEEK_INVALID");
  }
  // No canonical period syntax is defined in the application yet. Validate only
  // the persisted field's current contract; do not guess a month/quincena format.
  if (!payrollPeriod.trim() || payrollPeriod.length > 40) reasons.push("PAYROLL_PERIOD_INVALID");
  if (!Number.isInteger(order.itemCount) || order.itemCount <= 0) reasons.push("ITEM_COUNT_INVALID");

  if (order.itemCount > 0 && order.reservations.length === 0) reasons.push("RESERVATIONS_REQUIRED");
  if (order.reservations.length !== order.itemCount) reasons.push("RESERVATION_COUNT_MISMATCH");
  for (const reservation of order.reservations) {
    if (reservation.foodOrderId !== order.id) reasons.push("RESERVATION_ORDER_MISMATCH");
    if (reservation.employeeId !== order.employeeId) reasons.push("RESERVATION_EMPLOYEE_MISMATCH");
    if (reservation.status !== "ACTIVE") reasons.push("RESERVATION_NOT_ACTIVE");
    if (!reservation.menuItem) {
      reasons.push("RESERVATION_MENU_ITEM_INVALID");
      continue;
    }
    if (!order.menuWeek) continue;
    const { menuWeekId, serviceDate } = reservation.menuItem.menuDay;
    if (menuWeekId !== order.menuWeekId) reasons.push("RESERVATION_WEEK_MISMATCH");
    if (Number.isNaN(serviceDate.getTime()) || serviceDate < order.menuWeek.weekStart || serviceDate >= plusDaysUtc(order.menuWeek.weekStart, 7)) {
      reasons.push("RESERVATION_DATE_OUTSIDE_WEEK");
    }
  }

  const unitCents = moneyCents(order.unitPrice);
  const totalCents = moneyCents(order.totalAmount);
  if (unitCents === null || unitCents <= 0) reasons.push("UNIT_PRICE_INVALID");
  if (totalCents === null || totalCents <= 0) reasons.push("TOTAL_AMOUNT_INVALID");
  if (unitCents !== null && totalCents !== null && Number.isInteger(order.itemCount) && unitCents * order.itemCount !== totalCents) {
    reasons.push("TOTAL_AMOUNT_MISMATCH");
  }

  const uniqueReasons = [...new Set(reasons)];
  const historicalUnitPrice = unitCents === null ? undefined : (unitCents / 100).toFixed(2);
  const committedAmount = totalCents === null ? undefined : (totalCents / 100).toFixed(2);
  return {
    eligible: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    orderId: order.id,
    employeeId: order.employeeId,
    employeeNumber: order.employee?.employeeNumber,
    employeeName: order.employee?.fullName,
    serviceWeekStart: order.menuWeek?.weekStart,
    payrollPeriod,
    quantity: order.itemCount,
    historicalUnitPrice,
    committedAmount,
  };
}

/** Fetches the order/reservations and current assignment state without writing anything. */
export async function getFoodPayrollOrderEligibility(
  client: {
    foodOrder: { findUnique(args: unknown): Promise<PayrollEligibilityInput | null> };
  },
  orderId: string,
  payrollPeriod: string,
): Promise<FoodPayrollEligibility> {
  const order = await client.foodOrder.findUnique({
    where: { id: orderId },
    include: {
      employee: { select: { id: true, employeeNumber: true, fullName: true, status: true } },
      menuWeek: { select: { id: true, weekStart: true } },
      reservations: {
        select: {
          id: true, foodOrderId: true, employeeId: true, status: true,
          menuItem: { select: { menuDay: { select: { menuWeekId: true, serviceDate: true } } } },
        },
      },
      payrollAssignments: { where: { status: "ACTIVE" }, select: { status: true } },
    },
  });
  return evaluateFoodPayrollEligibility(order, payrollPeriod);
}
