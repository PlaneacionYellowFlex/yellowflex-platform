import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import path from "node:path";

const prisma = new PrismaClient();

const OVERRIDES = new Map<string, string>([
  ["33-013-063*2579", "PIEZAS"],
  ["33-003-057*2577", "PIEZAS"],
]);

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

type Balance = {
  location: string;
  code: string;
  unit: string;
  quantity: number;
  rows: number[];
};

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    throw new Error("Indica la ruta de LAYOUT OCT.xlsx.");
  }

  const input = path.resolve(arg);
  const wb = new ExcelJS.Workbook();

  await wb.xlsx.readFile(input);

  const sh = wb.getWorksheet("LAYOUT");

  if (!sh) {
    throw new Error('No existe la hoja "LAYOUT".');
  }

  let location = "";
  let raw = 0;

  const map = new Map<string, Balance>();

  for (let n = 3; n <= sh.rowCount; n += 1) {
    const r = sh.getRow(n);

    const loc = txt(r.getCell(1).value);

    if (loc) {
      location = loc.toUpperCase();
    }

    const code = txt(r.getCell(2).value).toUpperCase();

    if (!code || code === "N/A") {
      continue;
    }

    const quantity = num(r.getCell(4).value);

    if (quantity === null || quantity <= 0) {
      continue;
    }

    let unit = txt(r.getCell(5).value).toUpperCase();

    if (!unit && OVERRIDES.has(code)) {
      unit = OVERRIDES.get(code)!;
    }

    if (!location || !["PIEZAS", "KG"].includes(unit)) {
      continue;
    }

    raw += 1;

    const key = `${location}|||${code}`;
    const existing = map.get(key);

    if (existing) {
      if (existing.unit !== unit) {
        throw new Error(
          `Conflicto de unidad: ${location} | ${code} | ${existing.unit} vs ${unit}`,
        );
      }

      existing.quantity += quantity;
      existing.rows.push(n);
    } else {
      map.set(key, {
        location,
        code,
        unit,
        quantity,
        rows: [n],
      });
    }
  }

  const balances = [...map.values()];
  const repeats = balances.filter((x) => x.rows.length > 1);

  const warehouse = await prisma.warehouse.findUnique({
    where: {
      code: "ALMACEN-GENERAL",
    },
    select: {
      code: true,
      name: true,
      active: true,
    },
  });

  const [
    items,
    locations,
    movements,
    initial,
    custodies,
    events,
    users,
  ] = await Promise.all([
    prisma.inventoryItem.count(),
    prisma.warehouseLocation.count(),
    prisma.inventoryMovement.count(),
    prisma.inventoryMovement.count({
      where: {
        type: "INITIAL_BALANCE",
      },
    }),
    prisma.inventoryCustody.count(),
    prisma.inventoryCustodyEvent.count(),
    prisma.user.findMany({
      where: {
        active: true,
      },
      orderBy: [
        {
          name: "asc",
        },
        {
          email: "asc",
        },
      ],
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        roles: {
          select: {
            role: true,
          },
          orderBy: {
            role: "asc",
          },
        },
      },
    }),
  ]);

  console.log("");
  console.log("YELLOWFLEX — PREFLIGHT CARGA INICIAL DE ALMACÉN");
  console.log("===============================================");
  console.log(`Archivo: ${input}`);
  console.log("SOLO LECTURA. NO SE ESCRIBIÓ NADA EN POSTGRESQL.");
  console.log("");

  console.log("PLAN CONSOLIDADO");
  console.log(`Filas importables originales: ${raw}`);
  console.log(`Saldos ubicación/código consolidados: ${balances.length}`);
  console.log(`Grupos repetidos consolidados: ${repeats.length}`);
  console.log("");

  console.log("REPETICIONES CONSOLIDADAS");

  if (!repeats.length) {
    console.log("- Ninguna");
  } else {
    repeats.forEach((x) => {
      console.log(
        `- ${x.location} | ${x.code} | filas=${x.rows.join(",")} | total=${x.quantity} ${x.unit}`,
      );
    });
  }

  console.log("");
  console.log("ESTADO POSTGRESQL");
  console.log(
    `Almacén General: ${
      warehouse
        ? `${warehouse.code} | ${warehouse.name} | activo=${warehouse.active}`
        : "NO ENCONTRADO"
    }`,
  );
  console.log(`InventoryItem: ${items}`);
  console.log(`WarehouseLocation: ${locations}`);
  console.log(`InventoryMovement: ${movements}`);
  console.log(`INITIAL_BALANCE: ${initial}`);
  console.log(`InventoryCustody: ${custodies}`);
  console.log(`InventoryCustodyEvent: ${events}`);

  console.log("");
  console.log("USUARIOS CORPORATIVOS ACTIVOS");

  if (!users.length) {
    console.log("- NINGUNO");
  }

  users.forEach((u, i) => {
    const roles =
      u.roles.length > 0
        ? u.roles.map((entry) => entry.role).join(", ")
        : "SIN_ROL";

    console.log(
      `${i + 1}. ${u.name} | ${u.email} | roles=${roles} | id=${u.id}`,
    );
  });

  const blockers: string[] = [];

  if (!warehouse) {
    blockers.push("No existe ALMACEN-GENERAL.");
  }

  if (!users.length) {
    blockers.push("No existe usuario corporativo activo.");
  }

  if (initial > 0) {
    blockers.push(
      "Ya existen INITIAL_BALANCE: existe riesgo de duplicar inventario.",
    );
  }

  if (movements > 0 && initial === 0) {
    blockers.push(
      "Ya existen otros movimientos de inventario: revisar antes de la carga inicial.",
    );
  }

  if (custodies > 0 || events > 0) {
    blockers.push(
      "Ya existen registros de custodia: revisar antes de la carga inicial.",
    );
  }

  console.log("");
  console.log("DICTAMEN");

  if (blockers.length > 0) {
    console.log("BLOQUEADO.");

    blockers.forEach((x) => {
      console.log(`- ${x}`);
    });

    console.log("No ejecutar carga real.");
  } else {
    console.log("PREFLIGHT APROBADO.");
    console.log(
      `Carga futura: ${balances.length} INITIAL_BALANCE consolidados.`,
    );
    console.log(
      "Falta seleccionar explícitamente el usuario corporativo que firmará la carga.",
    );
  }
}

main()
  .catch((error) => {
    console.error("");
    console.error("ERROR EN PREFLIGHT");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
