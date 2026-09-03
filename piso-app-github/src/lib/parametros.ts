// PISO Core V1 -- Configuración (parámetros del modelo). Ver migración
// supabase/migrations/0004_parametros_pricing.sql.
//
// Fila única (id=1): no es "una config entre varias", es el estado
// vigente del modelo. Lectura vía RLS (solo operadores); escritura vía
// actualizar_parametros_pricing() (SECURITY DEFINER) -- mismo patrón de
// autoridad que core.ts usa para eventos.
import { supabase } from "./supabase";

export interface ParametrosPricing {
  id: number;
  ticket_demo_mxn: number;
  multiplicador_demo: number;
  float_pct: number | null;
  carry_pct: number | null;
  cetes_rate_anual: number | null;
  actualizado_por: string | null;
  actualizado_en: string;
}

export async function obtenerParametrosPricing(): Promise<ParametrosPricing> {
  const { data, error } = await supabase.from("parametros_pricing").select("*").eq("id", 1).single();
  if (error) throw error;
  return data as ParametrosPricing;
}

export interface ActualizarParametrosPricingInput {
  ticket_demo_mxn: number;
  multiplicador_demo: number;
  float_pct?: number | null;
  carry_pct?: number | null;
  cetes_rate_anual?: number | null;
}

export async function actualizarParametrosPricing(p: ActualizarParametrosPricingInput): Promise<void> {
  const { error } = await supabase.rpc("actualizar_parametros_pricing", {
    p_ticket_demo_mxn: p.ticket_demo_mxn,
    p_multiplicador_demo: p.multiplicador_demo,
    p_float_pct: p.float_pct ?? null,
    p_carry_pct: p.carry_pct ?? null,
    p_cetes_rate_anual: p.cetes_rate_anual ?? null,
  });
  if (error) throw error;
}
