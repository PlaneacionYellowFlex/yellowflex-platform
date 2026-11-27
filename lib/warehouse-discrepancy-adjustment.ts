import { Prisma } from "@prisma/client";

export type DiscrepancyAdjustment = { type: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT"; quantity: Prisma.Decimal };

type Qty = Prisma.Decimal | number;
const dec = (v: Qty) => (v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v));

export function authorizeDiscrepancyAdjustment(input: { authorized: boolean; approverId: string; countActorId: string | null; recountActorId: string | null; investigatorId?: string | null }) {
  if (!input.authorized) throw new Error("Se requiere autorización expresa para aprobar ajustes.");
  if (input.approverId === input.countActorId || input.approverId === input.recountActorId) throw new Error("El aprobador debe ser distinto del contador.");
  // YF-003: separación de funciones; quien investigó y documentó la causa no aprueba su propio expediente.
  if (input.investigatorId && input.approverId === input.investigatorId) throw new Error("El aprobador debe ser distinto de quien investigó la diferencia.");
}

export function assertDiscrepancyCanBeApproved(input: { closed: boolean; movementId: string | null }) {
  if (input.closed || input.movementId) throw new Error("La investigación ya fue aprobada o está cerrada.");
}

/** Aritmética decimal exacta (YF-003): sin errores de punto flotante en la diferencia ni en la comparación de existencias. */
export function createDiscrepancyAdjustment(input: { expected: Qty; counted: Qty; currentBalance: Qty }): DiscrepancyAdjustment | null {
  const expected = dec(input.expected);
  if (!dec(input.currentBalance).equals(expected)) throw new Error("La existencia cambió desde el reconteo.");
  const difference = dec(input.counted).minus(expected);
  if (difference.isZero()) return null;
  return { type: difference.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: difference.abs() };
}
