import "server-only";

import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { isSerializationConflict, isUniqueConflict } from "@/lib/warehouse-idempotency";
import { InvalidWarehouseQuantityError } from "@/lib/warehouse-quantity";
import { WarehouseCountError } from "@/repositories/warehouse-counts.repository";
import { WarehouseDiscrepancyError } from "@/repositories/warehouse-discrepancies.repository";
import { InsufficientWarehouseStockError, InvalidCustodyReceptionError, InvalidProductionCustodyOperationError } from "@/repositories/warehouse-custody.repository";
import { WarehouseOperationError } from "@/repositories/warehouse-operations.repository";
import { WarehouseCatalogStateError } from "@/repositories/warehouse-catalog-guard";
import { WarehouseCatalogError } from "@/repositories/warehouse-catalog.repository";
import { InsufficientWarehouseTransferStockError, WarehouseStockOperationConflictError } from "@/repositories/warehouse-movements.repository";
import { WarehouseRecountError } from "@/repositories/warehouse-recounts.repository";

/**
 * Errores de Warehouse con mensajes claros: negocio y concurrencia → 409, datos inválidos → 400; autenticación,
 * autorización y validación se delegan al manejador común (401/403/422). Nunca expone detalles internos.
 */
export function warehouseApiError(error: unknown) {
  if (error instanceof InvalidWarehouseQuantityError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof WarehouseStockOperationConflictError) {
    return NextResponse.json({ error: "Esta solicitud ya se registró con datos distintos. Actualiza la pantalla y captura de nuevo.", code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
  }
  if (error instanceof WarehouseCountError || error instanceof WarehouseRecountError || error instanceof WarehouseDiscrepancyError ||
      error instanceof InsufficientWarehouseStockError || error instanceof InsufficientWarehouseTransferStockError ||
      error instanceof InvalidCustodyReceptionError || error instanceof InvalidProductionCustodyOperationError || error instanceof WarehouseOperationError ||
      error instanceof WarehouseCatalogStateError || error instanceof WarehouseCatalogError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (isSerializationConflict(error) || isUniqueConflict(error)) {
    return NextResponse.json({ error: "Otra operación modificó este registro al mismo tiempo. Actualiza la pantalla y vuelve a intentarlo.", code: "CONCURRENT_UPDATE" }, { status: 409 });
  }
  return apiError(error);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Clave de idempotencia obligatoria para operaciones que cambian existencias. */
export function requireIdempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return UUID.test(key) ? key.toLowerCase() : null;
}

/** Respuesta de una operación idempotente: 201 la primera vez; 200 con replayed=true al repetir la misma solicitud. */
export function idempotentResponse(result: { response: Record<string, unknown>; replayed: boolean }) {
  return NextResponse.json({ ...result.response, replayed: result.replayed }, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
}

/** Lee el cuerpo JSON como objeto; un cuerpo vacío o inválido produce un error de validación en español (400). */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch { return null; }
}

export function invalidBody(message = "La solicitud no tiene un formato válido.") {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function missingIdempotencyKey() {
  return NextResponse.json({ error: "Se requiere Idempotency-Key con UUID válido.", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
}
