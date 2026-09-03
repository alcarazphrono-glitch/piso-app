import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Cliente único para toda la app -- si algo necesita hablar con Supabase,
// importa esto, nunca crea su propio createClient() suelto.
//
// Las credenciales vienen del proyecto de Supabase real (Dirección General /
// quien lo cree) -- ver README.md, sección "Lo que necesitas crear antes de
// que esto corra de verdad". Sin ellas, la app compila pero no puede leer ni
// escribir datos -- eso es intencional: falla explícito, no silencioso.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!url || !anonKey) {
  // No lanzamos una excepción en build/import -- Next.js evalúa este módulo
  // al compilar. En runtime del navegador, cualquier llamada real fallará
  // con un error claro de Supabase, no con un crash silencioso aquí.
  // eslint-disable-next-line no-console
  console.warn(
    "[PISO] Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Revisa .env.local -- ver README.md."
  );
}

export const supabase: SupabaseClient = createClient(url, anonKey);
