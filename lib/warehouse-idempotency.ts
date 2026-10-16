import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function payloadHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}

export function operationIdentity(
  request: Request,
  actorId: string,
  kind: string,
  custodyId: string,
  payload: unknown,
) {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    return null;
  }

  const normalizedKey = key.toLowerCase();
  return {
    key: `${kind}:${actorId}:${custodyId}:${normalizedKey}`,
    hash: payloadHash({ kind, actorId, custodyId, payload }),
  };
}

export function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}