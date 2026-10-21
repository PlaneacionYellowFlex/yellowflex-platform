export type DiscrepancyAdjustment = { type: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT"; quantity: number };

export function authorizeDiscrepancyAdjustment(input: { authorized: boolean; approverId: string; countActorId: string | null; recountActorId: string | null }) {
  if (!input.authorized) throw new Error("Se requiere autorización expresa para aprobar ajustes.");
  if (input.approverId === input.countActorId || input.approverId === input.recountActorId) throw new Error("El aprobador debe ser distinto del contador.");
}

export function assertDiscrepancyCanBeApproved(input: { closed: boolean; movementId: string | null }) {
  if (input.closed || input.movementId) throw new Error("La investigación ya fue aprobada o está cerrada.");
}

export function createDiscrepancyAdjustment(input: { expected: number; counted: number; currentBalance: number }): DiscrepancyAdjustment | null {
  if (input.currentBalance !== input.expected) throw new Error("La existencia cambió desde el reconteo.");
  const difference = input.counted - input.expected;
  if (difference === 0) return null;
  return { type: difference > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: Math.abs(difference) };
}
