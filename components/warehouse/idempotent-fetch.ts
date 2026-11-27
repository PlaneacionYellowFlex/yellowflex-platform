"use client";

/**
 * YF-003 · Envío idempotente desde el navegador. La misma captura conserva la misma Idempotency-Key hasta que el servidor
 * confirma: un reintento por red lenta, pérdida de conexión o una segunda pestaña recibe el resultado original en lugar de
 * duplicar la operación. La clave se descarta solo cuando el servidor responde (éxito o rechazo de negocio).
 */
const pending = new Map<string, string>();

export type IdempotentResult = { ok: boolean; status: number; body: Record<string, unknown> & { error?: string } };

export async function idempotentFetch(url: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<IdempotentResult> {
  const text = JSON.stringify(body ?? {});
  const fingerprint = `${method} ${url} ${text}`;
  let key = pending.get(fingerprint);
  if (!key) { key = crypto.randomUUID(); pending.set(fingerprint, key); }
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: text, credentials: "same-origin", cache: "no-store" });
  } catch {
    // Sin respuesta del servidor: se conserva la clave para que el reintento no duplique la operación.
    return { ok: false, status: 0, body: { error: "No hubo respuesta del servidor. Revisa tu conexión y vuelve a intentar: la operación no se duplicará." } };
  }
  let parsed: Record<string, unknown> = {};
  try { parsed = (await response.json()) as Record<string, unknown>; } catch { parsed = {}; }
  if (response.status !== 0 && response.status < 500) pending.delete(fingerprint);
  if (!response.ok && typeof parsed.error !== "string") {
    parsed.error = response.status === 403 ? "Acceso restringido: no tienes permiso para esta operación." : "No fue posible completar la operación. Intenta de nuevo.";
  }
  return { ok: response.ok, status: response.status, body: parsed as IdempotentResult["body"] };
}
