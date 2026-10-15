import { PrismaClient, Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import path from "node:path";

const prisma = new PrismaClient();

const ACTOR_EMAIL = "planeacion@yellow-flex.com";
const WAREHOUSE_CODE = "ALMACEN-GENERAL";
const CUT_DATE = "2026-10-07";
const REFERENCE_TYPE = "WAREHOUSE_LAYOUT_CUT";
const REFERENCE_NUMBER = "ALMACEN-GENERAL-2026-10-07";

const EXPECTED_IMPORTABLE_ROWS = 479;
const EXPECTED_ITEMS = 203;
const EXPECTED_LOCATIONS = 455;
const EXPECTED_BALANCES = 472;

const UNIT_OVERRIDES = new Map<string, string>([
  ["33-013-063*2579", "PIEZAS"],
  ["33-003-057*2577", "PIEZAS"],
  ["33-003-057", "PIEZAS"],
]);

type Balance = {
  location: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  rows: number[];
};

function txt(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (v instanceof Date) return v.toISOString();

  if (typeof v === "object") {
    if ("result" in v) return txt(v.result as ExcelJS.CellValue);

    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((x) => x.text ?? "").join("").trim();
    }

    if ("text" in v && typeof v.text === "string") {
      return v.text.trim();
    }
  }

  return "";
}

function num(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;

  if (
    v &&
    typeof v === "object" &&
    "result" in v &&
    typeof v.result === "number" &&
    Number.isFinite(v.result)
  ) {
    return v.result;
  }

  return null;
}

function norm(value: string): string {
  return value.trim().toUpperCase();
}

function folio(index: number): string {
  return `INI-20261007-${String(index).padStart(4, "0")}`;
}

async function buildPlan(file: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);

  const sheet = workbook.getWorksheet("LAYOUT");

  if (!sheet) {
    throw new Error('No existe la hoja "LAYOUT".');
  }

  let currentLocation = "";
  let importableRows = 0;

  const balances = new Map<string, Balance>();
  const descriptions = new Map<string, string>();
  const units = new Map<string, string>();
  const locations = new Set<string>();

  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);

    const explicitLocation = txt(row.getCell(1).value);

    if (explicitLocation) {
      currentLocation = norm(explicitLocation);
      locations.add(currentLocation);
    }

    const code = norm(txt(row.getCell(2).value));

    if (!code || code === "N/A") {
      continue;
    }

    const quantity = num(row.getCell(4).value);

    if (quantity === null || quantity <= 0) {
      continue;
    }

    let unit = norm(txt(row.getCell(5).value));

    if (!unit && UNIT_OVERRIDES.has(code)) {
      unit = UNIT_OVERRIDES.get(code)!;
    }

    if (!currentLocation) {
      throw new Error(
        `Fila ${rowNumber}: ${code} tiene cantidad positiva pero no tiene ubicación.`,
      );
    }

    if (!["PIEZAS", "KG"].includes(unit)) {
      throw new Error(
        `Fila ${rowNumber}: ${code} tiene unidad inválida "${unit}".`,
      );
    }

    const previousUnit = units.get(code);

    if (previousUnit && previousUnit !== unit) {
      throw new Error(
        `Conflicto de unidad para ${code}: ${previousUnit} vs ${unit}.`,
      );
    }

    const description = txt(row.getCell(3).value) || code;

    units.set(code, unit);

    if (!descriptions.has(code)) {
      descriptions.set(code, description);
    }

    importableRows += 1;

    const key = `${currentLocation}|||${code}`;
    const existing = balances.get(key);

    if (existing) {
      existing.quantity += quantity;
      existing.rows.push(rowNumber);
    } else {
      balances.set(key, {
        location: currentLocation,
        code,
        description,
        unit,
        quantity,
        rows: [rowNumber],
      });
    }
  }

  return {
    importableRows,
    balances: [...balances.values()].sort(
      (a, b) =>
        a.location.localeCompare(b.location, "es") ||
        a.code.localeCompare(b.code, "es"),
    ),
    items: [...units.entries()]
      .map(([code, unit]) => ({
        code,
        unit,
        description: descriptions.get(code) ?? code,
      }))
      .sort((a, b) => a.code.localeCompare(b.code, "es")),
    locations: [...locations].sort((a, b) => a.localeCompare(b, "es")),
  };
}

async function main() {
  const inputArgument = process.argv[2];

  if (!inputArgument) {
    throw new Error(
      'Indica la ruta del archivo. Ejemplo: npx tsx scripts/import-warehouse-initial-load.ts "C:\\yellowflex\\data\\warehouse\\LAYOUT OCT 07-10-2026.xlsx"',
    );
  }

  const inputPath = path.resolve(inputArgument);
  const plan = await buildPlan(inputPath);

  if (
    plan.importableRows !== EXPECTED_IMPORTABLE_ROWS ||
    plan.items.length !== EXPECTED_ITEMS ||
    plan.locations.length !== EXPECTED_LOCATIONS ||
    plan.balances.length !== EXPECTED_BALANCES
  ) {
    throw new Error(
      [
        "CONTROL DE CORTE FALLIDO.",
        `Esperado: filas=${EXPECTED_IMPORTABLE_ROWS}, artículos=${EXPECTED_ITEMS}, ubicaciones=${EXPECTED_LOCATIONS}, saldos=${EXPECTED_BALANCES}.`,
        `Detectado: filas=${plan.importableRows}, artículos=${plan.items.length}, ubicaciones=${plan.locations.length}, saldos=${plan.balances.length}.`,
        "No se escribió nada.",
      ].join(" "),
    );
  }

  const actor = await prisma.user.findUnique({
    where: {
      email: ACTOR_EMAIL,
    },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
    },
  });

  if (!actor?.active) {
    throw new Error(
      `El actor ${ACTOR_EMAIL} no existe o se encuentra inactivo.`,
    );
  }

  const warehouse = await prisma.warehouse.findUnique({
    where: {
      code: WAREHOUSE_CODE,
    },
    select: {
      id: true,
      code: true,
      name: true,
      active: true,
    },
  });

  if (!warehouse?.active) {
    throw new Error(
      `${WAREHOUSE_CODE} no existe o se encuentra inactivo.`,
    );
  }

  const [
    existingItems,
    existingLocations,
    existingMovements,
    existingCustodies,
    existingCustodyEvents,
  ] = await Promise.all([
    prisma.inventoryItem.count(),
    prisma.warehouseLocation.count(),
    prisma.inventoryMovement.count(),
    prisma.inventoryCustody.count(),
    prisma.inventoryCustodyEvent.count(),
  ]);

  if (
    existingItems !== 0 ||
    existingLocations !== 0 ||
    existingMovements !== 0 ||
    existingCustodies !== 0 ||
    existingCustodyEvents !== 0
  ) {
    throw new Error(
      [
        "CARGA BLOQUEADA: Warehouse ya contiene información.",
        `artículos=${existingItems}, ubicaciones=${existingLocations}, movimientos=${existingMovements}, custodias=${existingCustodies}, eventos=${existingCustodyEvents}.`,
        "Este importador sólo puede ejecutarse sobre un Warehouse vacío.",
      ].join(" "),
    );
  }

  console.log("");
  console.log("YELLOWFLEX — CORTE INICIAL DE ALMACÉN GENERAL");
  console.log("=============================================");
  console.log(`Fecha de corte: ${CUT_DATE}`);
  console.log(`Archivo: ${inputPath}`);
  console.log(`Alcance: existencia según Layout de ${warehouse.name}`);
  console.log(
    "Nota: este corte NO representa por sí solo el inventario físico total de YellowFlex.",
  );
  console.log(`Actor histórico: ${actor.name} | ${actor.email}`);
  console.log("");
  console.log("PLAN VALIDADO");
  console.log(`Filas importables: ${plan.importableRows}`);
  console.log(`Artículos: ${plan.items.length}`);
  console.log(`Ubicaciones físicas: ${plan.locations.length}`);
  console.log(`Saldos consolidados: ${plan.balances.length}`);
  console.log("");
  console.log("Iniciando transacción única...");

  const occurredAt = new Date(`${CUT_DATE}T00:00:00`);

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.inventoryItem.createMany({
        data: plan.items.map((item) => ({
          code: item.code,
          description: item.description,
          baseUnit: item.unit,
          active: true,
        })),
      });

      await tx.warehouseLocation.createMany({
        data: plan.locations.map((locationCode) => ({
          warehouseId: warehouse.id,
          code: locationCode,
          name: locationCode,
          active: true,
        })),
      });

      const savedItems = await tx.inventoryItem.findMany({
        where: {
          code: {
            in: plan.items.map((item) => item.code),
          },
        },
        select: {
          id: true,
          code: true,
        },
      });

      const savedLocations = await tx.warehouseLocation.findMany({
        where: {
          warehouseId: warehouse.id,
          code: {
            in: plan.locations,
          },
        },
        select: {
          id: true,
          code: true,
        },
      });

      const itemIds = new Map(
        savedItems.map((item) => [item.code, item.id]),
      );

      const locationIds = new Map(
        savedLocations.map((location) => [location.code, location.id]),
      );

      if (itemIds.size !== EXPECTED_ITEMS) {
        throw new Error(
          `Después de createMany se esperaban ${EXPECTED_ITEMS} artículos y se recuperaron ${itemIds.size}.`,
        );
      }

      if (locationIds.size !== EXPECTED_LOCATIONS) {
        throw new Error(
          `Después de createMany se esperaban ${EXPECTED_LOCATIONS} ubicaciones y se recuperaron ${locationIds.size}.`,
        );
      }

      const movementData = plan.balances.map((balance, index) => {
        const itemId = itemIds.get(balance.code);
        const destinationLocationId = locationIds.get(balance.location);

        if (!itemId || !destinationLocationId) {
          throw new Error(
            `No se pudo resolver ${balance.code} en ${balance.location}.`,
          );
        }

        return {
          folio: folio(index + 1),
          itemId,
          type: "INITIAL_BALANCE" as const,
          quantity: new Prisma.Decimal(balance.quantity),
          unit: balance.unit,
          originLocationId: null,
          destinationLocationId,
          referenceType: REFERENCE_TYPE,
          referenceNumber: REFERENCE_NUMBER,
          notes:
            `Corte inicial según Layout de ALMACÉN GENERAL al 07/10/2026. ` +
            `No representa por sí solo el inventario físico total de YellowFlex. ` +
            `Filas fuente Excel: ${balance.rows.join(", ")}.`,
          occurredAt,
          actorId: actor.id,
        };
      });

      const movementResult = await tx.inventoryMovement.createMany({
        data: movementData,
      });

      if (movementResult.count !== EXPECTED_BALANCES) {
        throw new Error(
          `Se esperaban ${EXPECTED_BALANCES} movimientos y createMany creó ${movementResult.count}.`,
        );
      }

      return {
        items: itemIds.size,
        locations: locationIds.size,
        movements: movementResult.count,
      };
    },
    {
      maxWait: 10000,
      timeout: 120000,
    },
  );

  const [
    finalItems,
    finalLocations,
    finalMovements,
    finalInitialBalances,
  ] = await Promise.all([
    prisma.inventoryItem.count(),
    prisma.warehouseLocation.count({
      where: {
        warehouseId: warehouse.id,
      },
    }),
    prisma.inventoryMovement.count(),
    prisma.inventoryMovement.count({
      where: {
        type: "INITIAL_BALANCE",
      },
    }),
  ]);

  console.log("");
  console.log("TRANSACCIÓN COMPLETADA");
  console.log(`Artículos creados: ${result.items}`);
  console.log(`Ubicaciones creadas: ${result.locations}`);
  console.log(`INITIAL_BALANCE creados: ${result.movements}`);
  console.log("");
  console.log("VERIFICACIÓN POSTERIOR");
  console.log(`InventoryItem: ${finalItems}`);
  console.log(`Ubicaciones ALMACÉN GENERAL: ${finalLocations}`);
  console.log(`InventoryMovement: ${finalMovements}`);
  console.log(`INITIAL_BALANCE: ${finalInitialBalances}`);

  if (
    finalItems !== EXPECTED_ITEMS ||
    finalLocations !== EXPECTED_LOCATIONS ||
    finalMovements !== EXPECTED_BALANCES ||
    finalInitialBalances !== EXPECTED_BALANCES
  ) {
    throw new Error(
      "La verificación posterior no coincide con el corte esperado. No realizar movimientos adicionales hasta auditar.",
    );
  }

  console.log("");
  console.log("CARGA INICIAL VALIDADA.");
  console.log(
    "Platform ya tiene el corte base del Layout de ALMACÉN GENERAL al 07/10/2026.",
  );
  console.log(
    "A partir de este punto, los cambios de existencia deberán generarse mediante movimientos trazables.",
  );
}

main()
  .catch((error) => {
    console.error("");
    console.error("ERROR EN CARGA INICIAL");
    console.error(error);
    console.error("");
    console.error(
      "Si el error ocurrió dentro de la transacción, Prisma revirtió automáticamente toda la escritura.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
