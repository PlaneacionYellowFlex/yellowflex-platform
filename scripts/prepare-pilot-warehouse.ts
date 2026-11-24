import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { configureIsolatedConnection, assertIsolatedIdentity } from "../tests/helpers/isolated-postgres.cjs";

async function main() {
  const url = configureIsolatedConnection();
  const db = new PrismaClient({ datasourceUrl: url });
  let itemId: string | undefined;
  let warehouseId: string | undefined;
  let complete = false;
  try {
    await assertIsolatedIdentity(db);
    const file = "data/qa-pilot-local-manifest.json";
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    if (manifest.database !== "yellowflex_restore_test") throw new Error("Manifiesto rechazado");
    if (manifest.warehouseFixture) { console.log("Fixtures manuales QA ya registrados; no se duplican."); return; }
    const actor = manifest.profiles.find((p: { key: string }) => p.key === "warehouse");
    const user = await db.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } });
    if (!user?.name.startsWith("QA Pilot Warehouse ") || !user.email?.endsWith("@example.invalid")) throw new Error("Actor QA no verificado");
    const [warehouseArea, productionArea] = await Promise.all([
      db.operationalArea.findUnique({ where: { code: "ALMACEN" } }),
      db.operationalArea.findUnique({ where: { code: "PRODUCCION" } }),
    ]);
    if (!warehouseArea?.active || !productionArea?.active) throw new Error("Faltan catálogos estructurales");
    const marker = `QA-PILOT-${manifest.runId.slice(0, 8)}`;
    const item = await db.inventoryItem.create({ data: { code: `${marker}-ITEM`, description: `Fictitious manual pilot ${manifest.runId}`, baseUnit: "EA" } });
    itemId = item.id;
    const warehouse = await db.warehouse.create({ data: { code: `${marker}-WH`, name: marker } });
    warehouseId = warehouse.id;
    const origin = await db.warehouseLocation.create({ data: { warehouseId, code: `${marker}-SRC`, name: "QA origin" } });
    const destination = await db.warehouseLocation.create({ data: { warehouseId, code: `${marker}-DST`, name: "QA destination" } });
    const { createWarehouseMovement } = await import("../repositories/warehouse-movements.repository");
    const { createOperationalHandoff } = await import("../repositories/warehouse-custody.repository");
    await createWarehouseMovement({ folio: `QA-${randomUUID()}`, itemId, type: "EXTERNAL_RECEIPT", quantity: 20, unit: "EA", destinationLocationId: origin.id,
      referenceType: "QA_PILOT_MANUAL", referenceNumber: marker, notes: marker, occurredAt: new Date(), actorId: actor.userId });
    const handoff = await createOperationalHandoff({ movementFolio: `QA-${randomUUID()}`, custodyFolio: `QA-${randomUUID()}`, itemId,
      quantity: new Prisma.Decimal(5), unit: "EA", originLocationId: origin.id, warehouseAreaId: warehouseArea.id, productionAreaId: productionArea.id,
      referenceType: "QA_PILOT_MANUAL", referenceNumber: marker, notes: marker, occurredAt: new Date(), actorId: actor.userId });
    manifest.warehouseFixture = { marker, itemId, itemCode: item.code, warehouseId, originLocationId: origin.id, originCode: origin.code,
      destinationLocationId: destination.id, destinationCode: destination.code, custodyId: handoff.custody.id, custodyFolio: handoff.custody.folio,
      initialQuantity: 20, remainingInOrigin: 15, quantityInTransit: 5 };
    writeFileSync(file, JSON.stringify(manifest, null, 2));
    complete = true;
    console.log("Preparados exclusivamente fixtures QA locales: artículo, almacén, dos ubicaciones, saldo 15 EA y custodia en tránsito 5 EA.");
  } finally {
    try {
      if (!complete && itemId) await db.$transaction(async tx => {
        const custodies = await tx.inventoryCustody.findMany({ where: { itemId }, select: { id: true } });
        await tx.inventoryCustodyEvent.deleteMany({ where: { custodyId: { in: custodies.map(c => c.id) } } });
        await tx.inventoryCustody.deleteMany({ where: { itemId } });
        await tx.inventoryMovement.deleteMany({ where: { itemId } });
        if (warehouseId) {
          await tx.warehouseLocation.deleteMany({ where: { warehouseId } });
          await tx.warehouse.delete({ where: { id: warehouseId } });
        }
        await tx.inventoryItem.delete({ where: { id: itemId } });
      });
    } finally {
      await db.$disconnect();
      await (globalThis as { prisma?: PrismaClient }).prisma?.$disconnect();
    }
  }
}
main().catch(() => { console.error("DETENIDO: preparación manual QA fallida; revisar fixtures locales antes de continuar."); process.exitCode = 1; });
