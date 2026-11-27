import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native TypeScript runner needs the explicit extension.
import { assertDiscrepancyCanBeApproved, authorizeDiscrepancyAdjustment, createDiscrepancyAdjustment } from "../lib/warehouse-discrepancy-adjustment.ts";

// YF-003: la cantidad del ajuste es un Decimal exacto; se compara tipo y valor exacto.
const plain = (a: { type: string; quantity: { toString(): string } } | null) => a && { type: a.type, quantity: a.quantity.toString() };

test("positive recount difference creates an inbound adjustment", () => {
  assert.deepEqual(plain(createDiscrepancyAdjustment({ expected: 8, counted: 10.5, currentBalance: 8 })), { type: "ADJUSTMENT_IN", quantity: "2.5" });
});

test("negative recount difference creates an outbound adjustment", () => {
  assert.deepEqual(plain(createDiscrepancyAdjustment({ expected: 8, counted: 6.25, currentBalance: 8 })), { type: "ADJUSTMENT_OUT", quantity: "1.75" });
});

test("decimal differences are exact (no floating point residue)", () => {
  assert.deepEqual(plain(createDiscrepancyAdjustment({ expected: 0.1, counted: 0.3, currentBalance: 0.1 })), { type: "ADJUSTMENT_IN", quantity: "0.2" });
  assert.equal(createDiscrepancyAdjustment({ expected: 0.3, counted: 0.3, currentBalance: 0.3 }), null);
});

test("duplicate approval and unauthorized or same-counter approvers are rejected", () => {
  assert.throws(() => assertDiscrepancyCanBeApproved({ closed: true, movementId: "movement-1" }));
  assert.throws(() => authorizeDiscrepancyAdjustment({ authorized: false, approverId: "approver", countActorId: "counter", recountActorId: "re-counter" }));
  assert.throws(() => authorizeDiscrepancyAdjustment({ authorized: true, approverId: "counter", countActorId: "counter", recountActorId: "re-counter" }));
  assert.doesNotThrow(() => authorizeDiscrepancyAdjustment({ authorized: true, approverId: "approver", countActorId: "counter", recountActorId: "re-counter" }));
});

test("a balance changed after the recount blocks either adjustment", () => {
  assert.throws(() => createDiscrepancyAdjustment({ expected: 8, counted: 10, currentBalance: 9 }));
});
