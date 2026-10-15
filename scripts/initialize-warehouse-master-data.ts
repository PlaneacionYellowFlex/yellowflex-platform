import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WAREHOUSE = {
  code: "ALMACEN-GENERAL",
  name: "ALMACÉN GENERAL",
};

const OPERATIONAL_AREAS = [
  { code: "ALMACEN", name: "ALMACÉN" },
  { code: "PRODUCCION", name: "PRODUCCIÓN" },
  { code: "CALIDAD", name: "CALIDAD" },
  { code: "EMBARQUES", name: "EMBARQUES" },
] as const;

async function main() {
  console.log("");
  console.log("YELLOWFLEX — INICIALIZACIÓN DE WAREHOUSE");
  console.log("========================================");

  const warehouse = await prisma.warehouse.upsert({
    where: { code: WAREHOUSE.code },
    update: {
      name: WAREHOUSE.name,
      active: true,
    },
    create: {
      code: WAREHOUSE.code,
      name: WAREHOUSE.name,
      active: true,
    },
  });

  console.log(`✓ Almacén físico: ${warehouse.code} | ${warehouse.name}`);

  console.log("");
  console.log("Áreas operativas:");

  for (const area of OPERATIONAL_AREAS) {
    const savedArea = await prisma.operationalArea.upsert({
      where: { code: area.code },
      update: {
        name: area.name,
        active: true,
      },
      create: {
        code: area.code,
        name: area.name,
        active: true,
      },
    });

    console.log(`✓ ${savedArea.code} | ${savedArea.name}`);
  }

  const areas = await prisma.operationalArea.findMany({
    where: {
      code: {
        in: OPERATIONAL_AREAS.map((area) => area.code),
      },
    },
    orderBy: {
      code: "asc",
    },
    select: {
      code: true,
      name: true,
      active: true,
    },
  });

  console.log("");
  console.log("VERIFICACIÓN");
  console.log(`Almacén: ${warehouse.name} | activo=${warehouse.active}`);
  console.log(`Áreas encontradas: ${areas.length}/${OPERATIONAL_AREAS.length}`);

  for (const area of areas) {
    console.log(`- ${area.code} | ${area.name} | activo=${area.active}`);
  }

  if (areas.length !== OPERATIONAL_AREAS.length) {
    throw new Error(
      "La verificación final no encontró todas las áreas operativas esperadas.",
    );
  }

  console.log("");
  console.log("Inicialización terminada correctamente.");
  console.log("No se crearon artículos, ubicaciones, custodias ni movimientos.");
}

main()
  .catch((error) => {
    console.error("");
    console.error("ERROR AL INICIALIZAR WAREHOUSE");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
