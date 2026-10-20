import { Prisma } from "@prisma/client";

export class InvalidWarehouseQuantityError extends Error {
  constructor() {
    super("La cantidad debe ser positiva y tener máximo 15 enteros y 3 decimales.");
    this.name = "InvalidWarehouseQuantityError";
  }
}

export function parseWarehouseQuantity(value: unknown) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^\+?(\d+)(?:\.(\d{1,3}))?$/.exec(raw);
  if (!match) throw new InvalidWarehouseQuantityError();

  const significantInteger = match[1].replace(/^0+/, "") || "0";
  if (significantInteger.length > 15) throw new InvalidWarehouseQuantityError();

  const quantity = new Prisma.Decimal(raw.replace(/^\+/, ""));
  if (!quantity.isFinite() || !quantity.greaterThan(0)) {
    throw new InvalidWarehouseQuantityError();
  }

  return quantity;
}