// PISO Core V1 -- helpers para el Event Manager (sección 3.1 del brief de
// arranque, 3-sep-2026) y el Resolution Engine (sección 3.2).
//
// Autoridad de escritura, ver migración supabase/migrations/0002_piso_core_v1.sql
// y el memo de arquitectura del mismo día:
// - crearEventoCore / actualizarEstadoEventoCore escriben directo a la
//   tabla `eventos` -- permitido por RLS solo si quien llama está en
//   public.operadores (policy "operadores administran eventos"). No hace
//   falta una función RPC para esto porque no toca datos de OTROS
//   usuarios, solo el catálogo público de eventos.
// - resolverEventoCore SÍ pasa por una función RPC (resolver_evento) --
//   esa sí toca posiciones y balances de otros usuarios, así que necesita
//   quedar auditada y no expuesta como un update directo aunque sea un
//   operador quien la llame.
import { supabase } from "./supabase";

export type EstadoEventoCore = "borrador" | "abierto" | "cerrado" | "resuelto";

export interface EventoCore {
  id: string;
  nombre: string;
  probabilidad: number;
  activo: boolean;
  categoria: string | null;
  descripcion: string | null;
  opciones: string[];
  imagen_url: string | null;
  explicacion_corta: string | null;
  explicacion_larga: string | null;
  fecha_display: string | null;
  fecha_contexto: string | null;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  fecha_resolucion: string | null;
  fuente_resolucion: string | null;
  estado: EstadoEventoCore;
  resultado_oficial: string | null;
  creado_en: string;
  actualizado_en: string;
}

export async function listarEventosCore(): Promise<EventoCore[]> {
  const { data, error } = await supabase
    .from("eventos")
    .select("*")
    .order("creado_en", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventoCore[];
}

export interface NuevoEventoCore {
  id: string; // slug, ej. "america_chivas_15sep" -- lo escribe el operador, no se autogenera
  nombre: string;
  probabilidad: number; // histórica -- usada por simular_resultado_posicion_demo() en modo demo
  categoria?: string;
  descripcion?: string;
  opciones?: string[]; // default ["si","no"] en la base -- ver limitación de multi-opción en la migración
  explicacion_corta?: string;
  explicacion_larga?: string;
  fecha_display?: string;
  fecha_contexto?: string;
  fecha_cierre?: string; // datetime-local, ISO
  fecha_resolucion?: string; // datetime-local, ISO
  fuente_resolucion?: string;
}

export async function crearEventoCore(evento: NuevoEventoCore): Promise<void> {
  const { error } = await supabase.from("eventos").insert({
    ...evento,
    estado: "borrador",
  });
  if (error) throw error;
}

export async function actualizarEstadoEventoCore(id: string, estado: EstadoEventoCore): Promise<void> {
  const { error } = await supabase.from("eventos").update({ estado }).eq("id", id);
  if (error) throw error;
}

export interface ResolverEventoParams {
  eventoId: string;
  resultado: string; // debe ser uno de eventos.opciones
  fuente: string; // ej. "Banxico -- comunicado oficial"
  evidencia?: string; // url o descripción de la evidencia
}

// Llama a resolver_evento() -- el Resolution Engine real, un operador
// resolviendo el evento una sola vez para todos. Distinto de
// simular_resultado_posicion_demo(), que sigue viviendo en la pantalla de
// Posición de Consumer para la beta de Track A. Ver memo de arquitectura,
// "ajuste de alcance".
export async function resolverEventoCore(params: ResolverEventoParams): Promise<number> {
  const { data, error } = await supabase.rpc("resolver_evento", {
    p_evento_id: params.eventoId,
    p_resultado: params.resultado,
    p_fuente: params.fuente,
    p_evidencia: params.evidencia ?? null,
  });
  if (error) throw error;
  return data as number; // número de posiciones resueltas
}
