import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Cliente con service role -- SOLO servidor (rutas /api). Salta RLS, así
// que nunca se importa desde un componente "use client". Lo usan los
// agentes de la mesa para escribir propuestas; las decisiones humanas
// siguen pasando por funciones SECURITY DEFINER con la sesión del operador.
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el servidor.");
  return createClient(url, key, { auth: { persistSession: false } });
}
