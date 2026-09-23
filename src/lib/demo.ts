import { supabase } from "./supabase";

/**
 * Prioridad 2 del memo de DG: "El MVP arranca en modo sandbox. El usuario
 * tiene $1,000 virtuales y juega con experiencia real sin mover dinero."
 *
 * Checkpoint 18-sep-2026 (hardening de seguridad, migración 0008): la
 * función asegurarPerfilYBalanceDemo() que vivía aquí y hacía el upsert
 * inicial de perfil+balance desde el CLIENTE se retiró -- esa escritura
 * abría una ventana real donde un usuario podía insertar su propio
 * balance inicial con el valor que quisiera, ganándole la carrera al
 * upsert legítimo (las políticas de RLS de insert en `perfiles`/`balances`
 * no distinguían "el upsert de la app" de "un insert manual del mismo
 * usuario"). Ahora un trigger en auth.users (manejar_nuevo_usuario(),
 * SECURITY DEFINER) crea esa fila atómicamente al signup, sin que el
 * cliente participe -- ver src/app/auth/page.tsx.
 */

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
 * Checkpoint 17-sep-2026 (Behavioral Forest, D6): antes esta función
 * CONTABA posiciones en cada carga de pantalla -- ahora lee
 * perfiles.racha_actual, un contador atómico real que confirmar_posicion()
 * incrementa server-side (migración 0005). Mismo comportamiento observable
 * (sube con cada posición abierta, gane o pierda), pero ahora es un dato
 * persistido, no un cálculo repetido -- prerequisito real que D6 pide
 * antes de que exista cualquier regla de reset (esa regla, a propósito,
 * NO está construida todavía -- ver /admin/configuracion).
 */
export async function obtenerRacha(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("perfiles")
    .select("racha_actual")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data?.racha_actual ?? 0;
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
