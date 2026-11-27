import { randomUUID } from "node:crypto";

/** Folio legible y único: PREFIJO-AAAAMMDD-XXXXXXXXXX (10 caracteres aleatorios en mayúsculas). */
export function warehouseFolio(prefix: string, now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}
