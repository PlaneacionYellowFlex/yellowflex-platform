import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXPECTED_ITEMS = 203;
const EXPECTED_LOCATIONS = 455;
const EXPECTED_INITIAL_BALANCES = 472;
const EXPECTED_PIECES = 2233174;
const EXPECTED_KG = 130827.9;

type Balance = {
  itemId: string;
  code: string;
  description: string;
  unit: string;
  locationId: string;
  locationCode: string;
  quantity: number;
};

async function main() {
  console.log("");
  console.log("YELLOWFLEX — AUDITORÍA DEL MOTOR FÍSICO DE INVENTARIO");
  console.log("=====================================================");
  console.log("SOLO LECTURA. NO SE ESCRIBIRÁ NADA EN POSTGRESQL.");
  console.log("");

  const [items, locations, incoming, outgoing, movementCount, initialCount] =
    await Promise.all([
      prisma.inventoryItem.findMany({
        where: { active: true },
        select: {
          id: true,
          code: true,
          description: true,
          baseUnit: true,
        },
      }),
      prisma.warehouseLocation.findMany({
        where: {
          active: true,
          warehouse: { active: true },
        },
        select: {
          id: true,
          code: true,
          warehouse: {
            select: { code: true, name: true },
          },
        },
      }),
      prisma.inventoryMovement.groupBy({
        by: ["itemId", "destinationLocationId"],
        where: { destinationLocationId: { not: null } },
        _sum: { quantity: true },
      }),
      prisma.inventoryMovement.groupBy({
        by: ["itemId", "originLocationId"],
        where: { originLocationId: { not: null } },
        _sum: { quantity: true },
      }),
      prisma.inventoryMovement.count(),
      prisma.inventoryMovement.count({
        where: { type: "INITIAL_BALANCE" },
      }),
    ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const calculated = new Map<string, number>();

  for (const movement of incoming) {
    if (!movement.destinationLocationId) continue;
    const key = `${movement.itemId}|||${movement.destinationLocationId}`;
    calculated.set(
      key,
      (calculated.get(key) ?? 0) + (movement._sum.quantity?.toNumber() ?? 0),
    );
  }

  for (const movement of outgoing) {
    if (!movement.originLocationId) continue;
    const key = `${movement.itemId}|||${movement.originLocationId}`;
    calculated.set(
      key,
      (calculated.get(key) ?? 0) - (movement._sum.quantity?.toNumber() ?? 0),
    );
  }

  const balances: Balance[] = [];

  for (const [key, quantity] of calculated) {
    const [itemId, locationId] = key.split("|||");
    const item = itemById.get(itemId);
    const location = locationById.get(locationId);

    if (!item || !location) {
      throw new Error(`No se pudo resolver el saldo ${key}.`);
    }

    balances.push({
      itemId,
      code: item.code,
      description: item.description,
      unit: item.baseUnit,
      locationId,
      locationCode: location.code,
      quantity,
    });
  }

  balances.sort(
    (a, b) =>
      a.code.localeCompare(b.code, "es") ||
      a.locationCode.localeCompare(b.locationCode, "es"),
  );

  const pieces = balances
    .filter((x) => x.unit === "PIEZAS")
    .reduce((sum, x) => sum + x.quantity, 0);

  const kg = balances
    .filter((x) => x.unit === "KG")
    .reduce((sum, x) => sum + x.quantity, 0);

  const negatives = balances.filter((x) => x.quantity < 0);
  const zeros = balances.filter((x) => x.quantity === 0);

  const locationsPerItem = new Map<string, Set<string>>();
  for (const balance of balances) {
    const set = locationsPerItem.get(balance.itemId) ?? new Set<string>();
    set.add(balance.locationId);
    locationsPerItem.set(balance.itemId, set);
  }

  const multiLocationItems = [...locationsPerItem.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([itemId, set]) => ({
      item: itemById.get(itemId)!,
      locationCount: set.size,
    }))
    .sort(
      (a, b) =>
        b.locationCount - a.locationCount ||
        a.item.code.localeCompare(b.item.code, "es"),
    );

  const emptyLocations = locations.filter(
    (location) =>
      !balances.some(
        (balance) =>
          balance.locationId === location.id && balance.quantity !== 0,
      ),
  );

  console.log("ESTADO DEL LIBRO MAYOR");
  console.log(`Artículos activos: ${items.length}`);
  console.log(`Ubicaciones físicas activas: ${locations.length}`);
  console.log(`Movimientos totales: ${movementCount}`);
  console.log(`INITIAL_BALANCE: ${initialCount}`);
  console.log("");

  console.log("SALDOS CALCULADOS DESDE MOVIMIENTOS");
  console.log(`Saldos artículo/ubicación: ${balances.length}`);
  console.log(`Total PIEZAS: ${pieces}`);
  console.log(`Total KG: ${kg}`);
  console.log(`Saldos negativos: ${negatives.length}`);
  console.log(`Saldos cero: ${zeros.length}`);
  console.log(`Ubicaciones actualmente vacías: ${emptyLocations.length}`);
  console.log(`Artículos presentes en múltiples ubicaciones: ${multiLocationItems.length}`);
  console.log("");

  console.log("ARTÍCULOS CON MAYOR DISTRIBUCIÓN");
  for (const row of multiLocationItems.slice(0, 15)) {
    console.log(
      `- ${row.item.code} | ${row.item.description} | ubicaciones=${row.locationCount}`,
    );
  }

  console.log("");
  console.log("MUESTRA DE SALDOS");
  for (const balance of balances.slice(0, 20)) {
    console.log(
      `- ${balance.code} | ${balance.locationCode} | ${balance.quantity} ${balance.unit}`,
    );
  }

  const checks = [
    {
      name: "Artículos",
      ok: items.length === EXPECTED_ITEMS,
      actual: items.length,
      expected: EXPECTED_ITEMS,
    },
    {
      name: "Ubicaciones",
      ok: locations.length === EXPECTED_LOCATIONS,
      actual: locations.length,
      expected: EXPECTED_LOCATIONS,
    },
    {
      name: "INITIAL_BALANCE",
      ok: initialCount === EXPECTED_INITIAL_BALANCES,
      actual: initialCount,
      expected: EXPECTED_INITIAL_BALANCES,
    },
    {
      name: "Saldos calculados",
      ok: balances.length === EXPECTED_INITIAL_BALANCES,
      actual: balances.length,
      expected: EXPECTED_INITIAL_BALANCES,
    },
    {
      name: "Total PIEZAS",
      ok: Math.abs(pieces - EXPECTED_PIECES) < 0.0001,
      actual: pieces,
      expected: EXPECTED_PIECES,
    },
    {
      name: "Total KG",
      ok: Math.abs(kg - EXPECTED_KG) < 0.0001,
      actual: kg,
      expected: EXPECTED_KG,
    },
    {
      name: "Saldos negativos",
      ok: negatives.length === 0,
      actual: negatives.length,
      expected: 0,
    },
  ];

  console.log("");
  console.log("CONTROLES DEL CORTE 07/10/2026");
  for (const check of checks) {
    console.log(
      `${check.ok ? "OK" : "ERROR"} | ${check.name}: ${check.actual} | esperado=${check.expected}`,
    );
  }

  const failed = checks.filter((check) => !check.ok);

  console.log("");
  console.log("DICTAMEN");

  if (failed.length > 0) {
    console.log("AUDITORÍA NO APROBADA.");
    console.log("No avanzar a Custodia hasta resolver las diferencias anteriores.");
    process.exitCode = 1;
    return;
  }

  console.log("AUDITORÍA APROBADA.");
  console.log(
    "El motor físico reconstruye correctamente el corte inicial desde InventoryMovement.",
  );
  console.log(
    "Warehouse puede avanzar a la capa de Custodia sin depender del Excel para consultar existencias.",
  );
}

main()
  .catch((error) => {
    console.error("");
    console.error("ERROR EN AUDITORÍA");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
