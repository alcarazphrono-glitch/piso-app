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
  const { error: perfilError } = await supabase
    .from("perfiles")
    .upsert({ user_id: userId, piso: "tierra" }, { onConflict: "user_id", ignoreDuplicates: true });

  if (perfilError) throw perfilError;

  const { error: balanceError } = await supabase
    .from("balances")
    .upsert(
      { user_id: userId, demo_balance: 1000, modo: "demo" },
      { onConflict: "user_id", ignoreDuplicates: true }
    );

  if (balanceError) throw balanceError;
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
