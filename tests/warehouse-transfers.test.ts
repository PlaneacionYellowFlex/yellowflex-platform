import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { InvalidWarehouseQuantityError, parseWarehouseQuantity } from "../lib/warehouse-quantity";
import { internalTransferIdentity } from "../lib/warehouse-movement-idempotency";

const operationKind = "INTERNAL_TRANSFER";

function makeIdentity(actorId: string, payload: Record<string, unknown>, key = randomUUID()) {
  return internalTransferIdentity(
    new Request("http://localhost", { headers: { "Idempotency-Key": key } }),
    actorId,
    payload,
  );
}

test("warehouse quantity parser accepts exact Decimal(18,3) values", () => {
  assert.equal(parseWarehouseQuantity("0.001").toFixed(3), "0.001");
  assert.equal(parseWarehouseQuantity("00012.340").toFixed(3), "12.340");
  assert.equal(parseWarehouseQuantity("999999999999999.999").toFixed(3), "999999999999999.999");
});

test("warehouse quantity parser rejects values outside Decimal(18,3)", () => {
  for (const value of ["0", "-1", "1.0001", "1000000000000000", "1e2", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => parseWarehouseQuantity(value), InvalidWarehouseQuantityError);
  }
});

test("transfer identity scopes operation key to actor and kind", () => {
  const key = randomUUID();
  const payload = { itemId: "item", originLocationId: "origin", destinationLocationId: "destination", quantity: "1.000" };
  const first = makeIdentity("actor-1", payload, key);
  assert.ok(first);
  assert.equal(first.operationKey, `${operationKind}:actor-1:${key}`);
  assert.notEqual(makeIdentity("actor-2", payload, key)?.operationKey, first.operationKey);
  assert.notEqual(makeIdentity("actor-1", { ...payload, quantity: "2.000" }, key)?.operationPayloadHash, first.operationPayloadHash);
});

test("internal transfer idempotency integration against isolated PostgreSQL", {
  skip: process.env.RUN_WAREHOUSE_TRANSFER_DB_TESTS !== "1",
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
      `DETENIDO: ${name} no apunta al PostgreSQL aislado autorizado`,
    );
  }

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const identity = await db.$queryRaw<Array<{ database: string; host: string; port: number }>>`
      SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port() AS port
    `;
    assert.deepEqual(identity, [{ database: "yellowflex_idempotencia_test", host: "127.0.0.1", port: 55432 }]);

    const [actor, warehouseArea, productionArea] = await Promise.all([
      db.user.findFirst({ where: { active: true }, select: { id: true } }),
      db.operationalArea.findUnique({ where: { code: "ALMACEN" }, select: { id: true, active: true } }),
      db.operationalArea.findUnique({ where: { code: "PRODUCCION" }, select: { id: true, active: true } }),
    ]);
    if (!actor || !warehouseArea?.active || !productionArea?.active) {
      throw new Error("La base aislada requiere usuario activo y áreas ALMACEN/PRODUCCION activas.");
    }
    const actorId = actor.id;

    const { createInternalTransfer, InsufficientWarehouseTransferStockError, WarehouseStockOperationConflictError } = await import("../repositories/warehouse-movements.repository");
    const { createWarehouseMovement } = await import("../repositories/warehouse-movements.repository");
    const { createOperationalHandoff, InsufficientWarehouseStockError } = await import("../repositories/warehouse-custody.repository");
    const { getWarehouseStockBalance } = await import("../repositories/warehouse-stock-lock");
    const runId = randomUUID();

    async function withFixture<T>(initial: string, run: (fixture: {
      actorId: string;
      itemId: string;
      unit: string;
      originLocationId: string;
      originLocationCode: string;
      destinationLocationId: string;
      marker: string;
      operationKeys: string[];
      movementIds: string[];
      custodyIds: string[];
    }) => Promise<T>) {
      const marker = `QA-WH-TRANSFER-${runId}-${randomUUID()}`;
      const fixture = {
        actorId,
        itemId: "",
        unit: "EA",
        originLocationId: "",
        originLocationCode: `${marker}-SRC`,
        destinationLocationId: "",
        marker,
        operationKeys: [] as string[],
        movementIds: [] as string[],
        custodyIds: [] as string[],
      };
      let warehouseId: string | null = null;
      let itemId: string | null = null;
      const locationIds: string[] = [];

      try {
        const item = await db.inventoryItem.create({
          data: { code: `${marker}-ITEM`, description: marker, baseUnit: fixture.unit },
          select: { id: true },
        });
        itemId = item.id;
        fixture.itemId = item.id;

        const warehouse = await db.warehouse.create({
          data: { code: `${marker}-WH`, name: marker },
          select: { id: true },
        });
        warehouseId = warehouse.id;

        const origin = await db.warehouseLocation.create({
          data: { warehouseId, code: `${marker}-SRC`, name: `${marker} source` },
          select: { id: true },
        });
        locationIds.push(origin.id);
        fixture.originLocationId = origin.id;
        fixture.originLocationCode = `${marker}-SRC`;

        const destination = await db.warehouseLocation.create({
          data: { warehouseId, code: `${marker}-DST`, name: `${marker} destination` },
          select: { id: true },
        });
        locationIds.push(destination.id);
        fixture.destinationLocationId = destination.id;

        const opening = await createWarehouseMovement({
          folio: `IM-${randomUUID()}`,
          itemId: fixture.itemId,
          type: "EXTERNAL_RECEIPT",
          quantity: Number(initial),
          unit: fixture.unit,
          destinationLocationId: fixture.originLocationId,
          referenceType: "QA_WAREHOUSE_TRANSFER_TEST",
          referenceNumber: marker,
          notes: marker,
          occurredAt: new Date(),
          actorId: fixture.actorId,
        });
        fixture.movementIds.push(opening.id);

        return await run(fixture);
      } finally {
        await db.$transaction(async (tx) => {
          if (fixture.operationKeys.length) {
            await tx.warehouseStockOperation.deleteMany({ where: { operationKey: { in: fixture.operationKeys } } });
          }
          const markerCustodies = itemId
            ? await tx.inventoryCustody.findMany({
                where: { itemId, referenceNumber: marker, notes: marker },
                select: { id: true },
              })
            : [];
          const custodyIds = [...new Set([...fixture.custodyIds, ...markerCustodies.map((custody) => custody.id)])];
          if (custodyIds.length) {
            await tx.inventoryCustodyEvent.deleteMany({ where: { custodyId: { in: custodyIds } } });
            await tx.inventoryCustody.deleteMany({ where: { id: { in: custodyIds } } });
          }
          if (itemId) {
            await tx.inventoryMovement.deleteMany({ where: { itemId } });
          }
          if (locationIds.length) {
            await tx.warehouseLocation.deleteMany({ where: { id: { in: locationIds } } });
          }
          if (warehouseId) await tx.warehouse.delete({ where: { id: warehouseId } });
          if (itemId) await tx.inventoryItem.delete({ where: { id: itemId } });
        });
      }
    }

    async function transfer(fixture: {
      actorId: string; itemId: string; unit: string; originLocationId: string; originLocationCode: string; destinationLocationId: string; marker: string;
      operationKeys: string[]; movementIds: string[]; custodyIds: string[];
    }, amount: string, key = randomUUID()) {
      const quantity = parseWarehouseQuantity(amount);
      const requestBody = {
        itemId: fixture.itemId,
        originLocationId: fixture.originLocationId,
        destinationLocationId: fixture.destinationLocationId,
        quantity: quantity.toFixed(3),
        referenceType: "QA_WAREHOUSE_TRANSFER_TEST",
        referenceNumber: fixture.marker,
        notes: fixture.marker,
      };
      const operation = internalTransferIdentity(
        new Request("http://localhost", { headers: { "Idempotency-Key": key } }),
        fixture.actorId,
        requestBody,
      );
      assert.ok(operation);
      fixture.operationKeys.push(operation.operationKey);
      const response = await createInternalTransfer({
        folio: `IM-${randomUUID()}`,
        ...requestBody,
        quantity,
        unit: fixture.unit,
        occurredAt: new Date(),
        actorId: fixture.actorId,
        originLocationCode: fixture.originLocationCode,
        operationKey: operation.operationKey,
        operationPayloadHash: operation.operationPayloadHash,
      });
      const movement = await db.inventoryMovement.findUnique({
        where: { folio: response.movement.folio },
        select: { id: true },
      });
      if (movement) fixture.movementIds.push(movement.id);
      return response;
    }

    async function balance(itemId: string, locationId: string) {
      return db.$transaction((tx) => getWarehouseStockBalance(tx, itemId, locationId));
    }

    await t.test("single transfer and repeated request create one movement", async () => {
      await withFixture("10", async (fixture) => {
        const key = randomUUID();
        const first = await transfer(fixture, "3", key);
        const retry = await transfer(fixture, "3", key);
        assert.deepEqual(retry, first);
        assert.equal((await balance(fixture.itemId, fixture.originLocationId)).toFixed(3), "7.000");
        assert.equal((await balance(fixture.itemId, fixture.destinationLocationId)).toFixed(3), "3.000");
        assert.equal(await db.warehouseStockOperation.count({ where: { operationKey: fixture.operationKeys[0] } }), 1);
      });
    });

    await t.test("same key with different payload is rejected without a second movement", async () => {
      await withFixture("10", async (fixture) => {
        const key = randomUUID();
        await transfer(fixture, "2", key);
        await assert.rejects(transfer(fixture, "3", key), WarehouseStockOperationConflictError);
        assert.equal((await balance(fixture.itemId, fixture.originLocationId)).toFixed(3), "8.000");
        assert.equal(await db.inventoryMovement.count({ where: { itemId: fixture.itemId, type: "INTERNAL_TRANSFER" } }), 1);
      });
    });

    await t.test("insufficient source balance creates no transfer", async () => {
      await withFixture("2", async (fixture) => {
        await assert.rejects(transfer(fixture, "3"), InsufficientWarehouseTransferStockError);
        assert.equal((await balance(fixture.itemId, fixture.originLocationId)).toFixed(3), "2.000");
        assert.equal(await db.inventoryMovement.count({ where: { itemId: fixture.itemId, type: "INTERNAL_TRANSFER" } }), 0);
        assert.equal(await db.warehouseStockOperation.count({ where: { kind: operationKind } }), 0);
      });
    });

    await t.test("concurrent transfers cannot spend the same source balance", async () => {
      await withFixture("10", async (fixture) => {
        const attempts = await Promise.allSettled([transfer(fixture, "7"), transfer(fixture, "7")]);
        assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
        assert.equal(attempts.filter((attempt) => attempt.status === "rejected" && attempt.reason instanceof InsufficientWarehouseTransferStockError).length, 1);
        assert.equal((await balance(fixture.itemId, fixture.originLocationId)).toFixed(3), "3.000");
        assert.equal(await db.inventoryMovement.count({ where: { itemId: fixture.itemId, type: "INTERNAL_TRANSFER" } }), 1);
      });
    });

    await t.test("concurrent transfer and production handoff share the source lock", async () => {
      await withFixture("10", async (fixture) => {
        const transferAttempt = transfer(fixture, "7");
        const handoffAttempt = createOperationalHandoff({
          movementFolio: `IM-${randomUUID()}`,
          custodyFolio: `CUS-${randomUUID()}`,
          itemId: fixture.itemId,
          quantity: new Prisma.Decimal("7.000"),
          unit: fixture.unit,
          originLocationId: fixture.originLocationId,
          warehouseAreaId: warehouseArea.id,
          productionAreaId: productionArea.id,
          referenceType: "QA_WAREHOUSE_TRANSFER_TEST",
          referenceNumber: fixture.marker,
          notes: fixture.marker,
          occurredAt: new Date(),
          actorId: fixture.actorId,
        });
        const attempts = await Promise.allSettled([transferAttempt, handoffAttempt]);
        for (const attempt of attempts) {
          if (attempt.status === "fulfilled" && "custody" in attempt.value) {
            fixture.movementIds.push(attempt.value.movement.id);
            fixture.custodyIds.push(attempt.value.custody.id);
          }
        }
        assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
        assert.equal(attempts.filter((attempt) => attempt.status === "rejected" && (attempt.reason instanceof InsufficientWarehouseTransferStockError || attempt.reason instanceof InsufficientWarehouseStockError)).length, 1);
        assert.equal((await balance(fixture.itemId, fixture.originLocationId)).toFixed(3), "3.000");
        assert.equal(await db.inventoryMovement.count({ where: { itemId: fixture.itemId, originLocationId: fixture.originLocationId, referenceNumber: fixture.marker } }), 1);
      });
    });
  } finally {
    await db.$disconnect();
  }
});
