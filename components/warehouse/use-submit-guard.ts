"use client";

import { useRef } from "react";

/**
 * YF-003 · Protección de envío para operaciones de Almacén.
 *  - begin()/end(): bloqueo síncrono (un ref, no estado de React), así un doble o triple clic no dispara dos solicitudes.
 *  - key(payload): la misma captura reutiliza la misma Idempotency-Key hasta que el servidor confirma; si la red falla y el
 *    usuario reintenta, el servidor devuelve el registro original en lugar de crear otro.
 */
export function useSubmitGuard() {
  const busy = useRef(false);
  const keys = useRef(new Map<string, string>());
  return {
    begin() { if (busy.current) return false; busy.current = true; return true; },
    end() { busy.current = false; },
    key(payload: unknown) {
      const fingerprint = JSON.stringify(payload);
      let key = keys.current.get(fingerprint);
      if (!key) { key = crypto.randomUUID(); keys.current.set(fingerprint, key); }
      return { key, fingerprint };
    },
    confirm(fingerprint: string) { keys.current.delete(fingerprint); },
  };
}
