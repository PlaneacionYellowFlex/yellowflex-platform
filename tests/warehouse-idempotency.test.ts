import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { operationIdentity, payloadHash } from "../lib/warehouse-idempotency";

const operationKind = "CONSUME_PRODUCTION_CUSTODY";
const validKey = "123e4567-e89b-42d3-a456-426614174000";

test("operation identity scopes key to operation, actor, and custody", () => {
  const request = new Request("http://localhost", { headers: { "Idempotency-Key": validKey } });
  const identity = operationIdentity(request, "actor-1", operationKind, "custody-1", { quantity: 2 });

  assert.deepEqual(identity, {
    key: `${operationKind}:actor-1:custody-1:${validKey}`,
    hash: payloadHash({
      kind: operationKind,
      actorId: "actor-1",
      custodyId: "custody-1",
      payload: { quantity: 2 },
    }),
  });
  assert.notEqual(
    operationIdentity(request, "actor-2", operationKind, "custody-1", { quantity: 2 })?.key,
    identity?.key,
  );
  assert.notEqual(
    operationIdentity(request, "actor-1", operationKind, "custody-2", { quantity: 2 })?.key,
    identity?.key,
  );
});

test("operation identity rejects missing or malformed keys", () => {
  assert.equal(operationIdentity(new Request("http://localhost"), "actor", operationKind, "custody", {}), null);
  assert.equal(
    operationIdentity(new Request("http://localhost", { headers: { "Idempotency-Key": "bad" } }), "actor", operationKind, "custody", {}),
    null,
  );
});

test("payload hash is canonical for object key order", () => {
  assert.equal(payloadHash({ quantity: 2, referenceNumber: "OP-1" }), payloadHash({ referenceNumber: "OP-1", quantity: 2 }));
});

test("payload changes produce a different hash", () => {
  assert.notEqual(payloadHash({ quantity: 2 }), payloadHash({ quantity: 3 }));
});

test("production custody consumption idempotency against PostgreSQL", {
  skip: process.env.RUN_WAREHOUSE_IDEMPOTENCY_DB_TESTS !== "1",
}, async (t) => {
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const value = process.env[name];
    assert.ok(value, `DETENIDO: falta ${name}`);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      assert.fail(`DETENIDO: ${name} no es una URL válida`);
    }
    assert.ok(
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
        url.hostname === "127.0.0.1" &&
        url.port === "55432" &&
        url.pathname === "/yellowflex_idempotencia_test",
      `DETENIDO: ${name} no apunta a la base aislada autorizada`,
    );
  }

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const identity = await db.$queryRaw<Array<{ database: string; host: string; port: number }>>`
      SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port
    `;
    assert.deepEqual(identity, [{ database: "yellowflex_idempotencia_test", host: "127.0.0.1", port: 55432 }]);

    const [actor, item, productionArea] = await Promise.all([
      db.user.findFirst({ where: { active: true }, select: { id: true } }),
      db.inventoryItem.findFirst({ where: { active: true }, select: { id: true, baseUnit: true }, orderBy: { code: "asc" } }),
      db.operationalArea.findUnique({ where: { code: "PRODUCCION" }, select: { id: true, active: true } }),
    ]);
    if (!actor || !item || !productionArea?.active) {
      throw new Error("La base aislada debe tener un actor, artículo y área PRODUCCION activos para las FK de prueba.");
    }
    const actorId = actor.id;
    const itemId = item.id;
    const unit = item.baseUnit;
    const productionAreaId = productionArea.id;
    const { consumeProductionCustody, InvalidProductionCustodyOperationError } = await import("../repositories/warehouse-custody.repository");
    const runId = randomUUID();
    const results: Array<Record<string, number | string>> = [];

    async function withCustody<T>(quantity: number, run: (custodyId: string) => Promise<T>) {
      const marker = `QA-IDEMPOTENCY-${runId}`;
      const custody = await db.inventoryCustody.create({
        data: {
          folio: `${marker}-${randomUUID()}`,
          itemId,
          quantity,
          unit,
          custodianAreaId: productionAreaId,
          status: "AVAILABLE",
          referenceType: "QA_IDEMPOTENCY_TEST",
          referenceNumber: marker,
          notes: marker,
          enteredAt: new Date(),
          createdById: actorId,
        },
        select: { id: true },
      });
      try {
        return await run(custody.id);
      } finally {
        await db.$transaction(async (tx) => {
          await tx.inventoryCustodyOperation.deleteMany({ where: { custodyId: custody.id } });
          await tx.inventoryCustodyEvent.deleteMany({ where: { custodyId: custody.id } });
          await tx.inventoryCustody.delete({ where: { id: custody.id } });
        });
      }
    }

    function consume(custodyId: string, quantity: number, key: string) {
      const payload = {
        quantity,
        referenceNumber: `QA-ORDER-${runId}`,
        notes: `QA-IDEMPOTENCY-${runId}`,
      };
      const operation = operationIdentity(
        new Request("http://localhost", { headers: { "Idempotency-Key": key } }),
        actorId,
        operationKind,
        custodyId,
        payload,
      );
      assert.ok(operation);
      return consumeProductionCustody({
        custodyId,
        ...payload,
        actorId,
        occurredAt: new Date(),
        operationKey: operation.key,
        operationPayloadHash: operation.hash,
      });
    }

    async function metrics(custodyId: string) {
      const [custody, events, operations] = await Promise.all([
        db.inventoryCustody.findUniqueOrThrow({ where: { id: custodyId }, select: { quantity: true, status: true } }),
        db.inventoryCustodyEvent.count({ where: { custodyId, type: "CONSUMED" } }),
        db.inventoryCustodyOperation.count({ where: { custodyId, kind: operationKind } }),
      ]);
      return { quantity: Number(custody.quantity), status: custody.status, consumedEvents: events, operations };
    }

    await t.test("partial consumption, retry, and conflicting payload", async () => {
      await withCustody(10, async (custodyId) => {
        const key = randomUUID();
        const first = await consume(custodyId, 2, key);
        const retry = await consume(custodyId, 2, key);
        assert.equal(first.remaining, 8);
        assert.equal(retry.remaining, 8);
        await assert.rejects(
          consume(custodyId, 3, key),
          (error: unknown) => error instanceof InvalidProductionCustodyOperationError,
        );
        const actual = await metrics(custodyId);
        assert.deepEqual(actual, { quantity: 8, status: "AVAILABLE", consumedEvents: 1, operations: 1 });
        results.push({ test: "partial-retry-conflict", quantity: actual.quantity, consumedEvents: actual.consumedEvents, operations: actual.operations });
      });
    });

    await t.test("concurrent duplicate request", async () => {
      await withCustody(10, async (custodyId) => {
        const key = randomUUID();
        const attempts = await Promise.allSettled([consume(custodyId, 3, key), consume(custodyId, 3, key)]);
        assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 2);
        const actual = await metrics(custodyId);
        assert.deepEqual(actual, { quantity: 7, status: "AVAILABLE", consumedEvents: 1, operations: 1 });
        results.push({ test: "concurrent-duplicate", quantity: actual.quantity, consumedEvents: actual.consumedEvents, operations: actual.operations });
      });
    });

    await t.test("insufficient balance rolls back", async () => {
      await withCustody(1, async (custodyId) => {
        await assert.rejects(
          consume(custodyId, 2, randomUUID()),
          (error: unknown) => error instanceof InvalidProductionCustodyOperationError,
        );
        const actual = await metrics(custodyId);
        assert.deepEqual(actual, { quantity: 1, status: "AVAILABLE", consumedEvents: 0, operations: 0 });
        results.push({ test: "insufficient", quantity: actual.quantity, consumedEvents: actual.consumedEvents, operations: actual.operations });
      });
    });

    await t.test("total consumption closes custody once", async () => {
      await withCustody(4, async (custodyId) => {
        const response = await consume(custodyId, 4, randomUUID());
        assert.equal(response.remaining, 0);
        const actual = await metrics(custodyId);
        assert.deepEqual(actual, { quantity: 0, status: "CLOSED", consumedEvents: 1, operations: 1 });
        results.push({ test: "total", quantity: actual.quantity, consumedEvents: actual.consumedEvents, operations: actual.operations });
      });
    });

    t.diagnostic(`WAREHOUSE_IDEMPOTENCY_RESULTS ${JSON.stringify(results)}`);
  } finally {
    await db.$disconnect();
  }
});
