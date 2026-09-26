import "server-only";

import { createClient } from "@supabase/supabase-js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

export function getPurchaseStorage() {
  const url = required("SUPABASE_URL");
  const secret = required("SUPABASE_SECRET_KEY");
  const bucket = required("SUPABASE_PURCHASE_BUCKET");
  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, bucket };
}
