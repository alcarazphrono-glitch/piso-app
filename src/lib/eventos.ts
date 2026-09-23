import { supabase } from "./supabase";
import { Evento } from "@/types";

// PISO Core, checkpoint 3-sep-2026: reemplaza el arreglo EVENTOS que vivía
// hardcodeado en src/types/index.ts. Todo lo que antes leía ese arreglo
// ahora pasa por aquí -- un operador puede crear/publicar un evento desde
// /admin/eventos y, sin ningún deploy de código, aparece en Consumer.

interface EventoRow {
  id: string;
  nombre: string;
  probabilidad: number;
  estado: "borrador" | "abierto" | "cerrado" | "resuelto";
  explicacion_1: string;
  explicacion_2: string;
  fecha_texto: string;
  fecha_contexto: string;
}

function mapearEvento(row: EventoRow): Evento {
  return {
    id: row.id,
    nombre: row.nombre,
    probabilidad: row.probabilidad,
    activo: row.estado === "abierto",
    explicacion: [row.explicacion_1 || "", row.explicacion_2 || ""],
    fecha: row.fecha_texto || "",
    fechaContexto: row.fecha_contexto || "",
  };
}

const COLUMNAS = "id, nombre, probabilidad, estado, explicacion_1, explicacion_2, fecha_texto, fecha_contexto";

/** Todos los eventos que Consumer puede mostrar -- abiertos y bloqueados. */
export async function obtenerEventos(): Promise<Evento[]> {
  const { data, error } = await supabase
    .from("eventos")
    .select(COLUMNAS)
    .order("creado_en", { ascending: true });
  if (error) throw error;
  return (data as EventoRow[]).map(mapearEvento);
}

/** Un evento por id, o null si no existe o todavía no se ha publicado. */
export async function obtenerEvento(id: string): Promise<Evento | null> {
  const { data, error } = await supabase.from("eventos").select(COLUMNAS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapearEvento(data as EventoRow) : null;
}

/**
 * El premio real, calculado en Postgres (calcular_premio_potencial() en
 * supabase/migrations/0002_piso_core.sql) -- nunca en el navegador. Se usa
 * para reemplazar el estimado instantáneo de src/lib/config.ts en cuanto
 * responde, no para bloquear el render inicial.
 */
export async function calcularPremioReal(eventoId: string): Promise<number> {
  const { data, error } = await supabase.rpc("calcular_premio_potencial", { p_evento_id: eventoId });
  if (error) throw error;
  return data as number;
}

/** Reemplaza el insert directo del cliente a `posiciones`. */
export async function confirmarPosicion(eventoId: string, respuesta: "si" | "no") {
  const { data, error } = await supabase.rpc("confirmar_posicion", {
    p_evento_id: eventoId,
    p_respuesta: respuesta,
  });
  if (error) throw error;
  return data as { id: string };
}

/** Reemplaza el Math.random() del cliente en posicion/page.tsx. */
export async function simularResultadoDemo(posicionId: string) {
  const { data, error } = await supabase.rpc("simular_resultado_posicion_demo", {
    p_posicion_id: posicionId,
  });
  if (error) throw error;
  return data;
}
