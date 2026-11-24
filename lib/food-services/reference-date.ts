import "server-only";

/** Server-only QA clock. Never accepts a request date or changes the system clock. */
export function getFoodReferenceDate() {
  const reference = process.env.FOOD_QA_REFERENCE_DATE;
  if (!reference) return new Date();
  if (process.env.NODE_ENV === "production" || process.env.FOOD_QA_ISOLATED !== "1") {
    throw new Error("La fecha QA solo está disponible en el proceso local aislado.");
  }
  const exclusive = process.env.YELLOWFLEX_TEST_DATABASE_URL;
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    let url: URL;
    try { url = new URL(process.env[name] ?? ""); } catch { throw new Error("Conexión QA no verificada."); }
    if (!exclusive || process.env[name] !== exclusive || !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/yellowflex_restore_test" || url.search || url.hash) {
      throw new Error("La fecha QA requiere ambas conexiones locales exclusivas.");
    }
  }
  const date = new Date(reference);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(reference) || !Number.isFinite(date.getTime()) || date.toISOString() !== reference) {
    throw new Error("Fecha de referencia QA inválida.");
  }
  return date;
}
