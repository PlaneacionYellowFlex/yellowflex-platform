import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.inventoryCustody.findMany({
    where: {
      referenceNumber: "TEST-CUS-001",
    },
    include: {
      item: true,
      custodianArea: true,
      nextActionArea: true,
      events: {
        orderBy: { occurredAt: "asc" },
      },
    },
  });

  console.dir(rows, { depth: null });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
