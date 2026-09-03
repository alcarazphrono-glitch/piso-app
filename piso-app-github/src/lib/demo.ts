import { supabase } from "./supabase";

/**
 * Prioridad 2 del memo de DG: "El MVP arranca en modo sandbox. El usuario
 * tiene $1,000 virtuales y juega con experiencia real sin mover dinero."
 *
 * Se llama una vez, justo después de que Supabase confirma la sesión (ver
 * src/app/auth/page.tsx). Si el usuario ya existe, upsert no hace nada
 * (onConflict evita duplicar el balance y resetear los $1,000 en cada login).
 */
export async function asegurarPerfilYBalanceDemo(userId: string) {
  // PISO Core V1 (migración 0002_piso_core_v1.sql): el upsert directo a
  // perfiles/balances se retiró -- RLS ya no deja escribir esas filas
  // desde el cliente. iniciar_balance_demo() hace lo mismo del lado
  // servidor: crea perfil + balance de $1,000 la primera vez, no hace
  // nada si ya existen, y deja un movimiento en el ledger. El userId que
  // recibe este parámetro ya no se usa para escribir -- la función usa
  // auth.uid() de la sesión, no lo que le pasa el cliente.
  const { error } = await supabase.rpc("iniciar_balance_demo");
  if (error) throw error;
}

export async function obtenerBalance(userId: string) {
  const { data, error } = await supabase
    .from("balances")
    .select("demo_balance, modo")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function obtenerPerfil(userId: string) {
  const { data, error } = await supabase
    .from("perfiles")
    .select("piso")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Racha -- pieza nueva del memo Behavioral (2-sep-2026, sección 3), no
 * estaba en las instrucciones originales de DG. Dato 4: solo 29% reabre
 * posición en 48h y 51% no vuelve en 7 días -- el copy de reassurance por
 * sí solo no retiene. La racha se mantiene viva independientemente de
 * ganar o perder: el gancho para volver deja de depender de procesar bien
 * la pérdida, y pasa a depender de no romper algo que ya construiste.
 *
 * Implementación simple a propósito para esta semana: cuenta cuántas
 * posiciones ha abierto el usuario en total (gane o pierda cada una). No
 * hay lógica de "se rompe si no vuelves en 24h" todavía -- eso es
 * candidato a instrumentar después si el número de D7 retention sigue
 * bajo con los primeros 20 usuarios (memo, sección 7).
 */
export async function obtenerRacha(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("posiciones")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Pantalla Modo real (memo Behavioral, sección 5). Dato 5: interés
 * orgánico <1.8%, así que cada correo que se guarda aquí es la señal más
 * directa que tenemos de que el copy sí está convirtiendo.
 */
export async function registrarInteresModoReal(userId: string, email: string) {
  const { error } = await supabase.from("intereses_modo_real").insert({ user_id: userId, email });
  if (error) throw error;
}
