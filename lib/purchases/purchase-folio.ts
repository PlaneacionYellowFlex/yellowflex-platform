import "server-only";

import { db } from "@/lib/db";

export async function generatePurchaseFolio(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `OC-${year}-`;

  const latest = await db.purchaseRequest.findFirst({
    where: { folio: { startsWith: prefix } },
    orderBy: { folio: "desc" },
    select: { folio: true },
  });

  const lastNumber = latest
    ? Number.parseInt(latest.folio.slice(prefix.length), 10) || 0
    : 0;

  return `${prefix}${String(lastNumber + 1).padStart(5, "0")}`;
}
