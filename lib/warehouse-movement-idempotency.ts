import { payloadHash } from "@/lib/warehouse-idempotency";

export const internalTransferKind = "INTERNAL_TRANSFER" as const;

export function internalTransferIdentity(
  request: Request,
  actorId: string,
  payload: unknown,
) {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    return null;
  }

  return {
    operationKey: `${internalTransferKind}:${actorId}:${key.toLowerCase()}`,
    operationPayloadHash: payloadHash({
      kind: internalTransferKind,
      actorId,
      payload,
    }),
  };
}