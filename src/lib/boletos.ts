import { supabase } from "./supabase";

// Sistema de boletos por nivel -- spec de Finanzas, 23-sep-2026 (migraciones
// 0009/0010). Reemplaza el ticket plano ($500 fijo) como el producto que se
// lanza, pero NO reemplaza `eventos`/`posiciones` (src/lib/eventos.ts) --
// ese modelo sigue siendo infraestructura válida y de hecho boletos.ts la
// reutiliza (racha, piso, referidos).

export interface Producto {
  clave: "entrada" | "crecimiento" | "elite";
  nombre: string;
  precio: number;
  gente_requerida: number;
  dias_resolucion: number;
  activo: boolean;
}

export interface Ciclo {
  id: string;
  producto_clave: Producto["clave"];
  evento_id: string;
  lugares_ocupados: number;
  estado: "llenando" | "lleno" | "resuelto" | "cancelado";
  fecha_inicio: string;
  fecha_resolucion: string;
  bono_bienvenida_activado: boolean;
}

export interface CicloConProducto extends Ciclo {
  producto: Producto;
  evento_nombre: string;
}

export interface Boleto {
  id: string;
  ciclo_id: string;
  user_id: string;
  respuesta: "si" | "no";
  monto: number;
  acerto: boolean | null;
  ganador: boolean;
  creado_en: string;
  resuelto_en: string | null;
}

/** Los 3 niveles activos, ordenados de menor a mayor precio. */
export async function obtenerProductos(): Promise<Producto[]> {
  const { data, error } = await supabase
    .from("productos")
    .select("clave, nombre, precio, gente_requerida, dias_resolucion, activo")
    .eq("activo", true)
    .order("precio", { ascending: true });
  if (error) throw error;
  return (data as Producto[]) ?? [];
}

/**
 * Ciclos que Consumer puede mostrar -- solo "llenando" y "lleno" (los ya
 * resueltos/cancelados se ven en /boleto para quien tenga un boleto ahí,
 * no en el listado general). "Faltan N lugares" es la única forma de
 * comunicar el tiempo restante -- el memo de Finanzas pide explícitamente
 * NO mostrar una cuenta regresiva de días, porque la fecha límite es un
 * peor-caso, no una promesa de cuándo se juega.
 */
export async function obtenerCiclosActivos(): Promise<CicloConProducto[]> {
  const [{ data: ciclos, error: e1 }, { data: productos, error: e2 }, { data: eventos, error: e3 }] =
    await Promise.all([
      supabase.from("ciclos").select("*").in("estado", ["llenando", "lleno"]).order("creado_en", { ascending: false }),
      supabase.from("productos").select("clave, nombre, precio, gente_requerida, dias_resolucion, activo"),
      supabase.from("eventos").select("id, nombre"),
    ]);
  if (e1 || e2 || e3) throw e1 || e2 || e3;

  const mapaProductos: Record<string, Producto> = {};
  for (const p of (productos as Producto[]) ?? []) mapaProductos[p.clave] = p;
  const mapaEventos: Record<string, string> = {};
  for (const ev of (eventos as { id: string; nombre: string }[]) ?? []) mapaEventos[ev.id] = ev.nombre;

  return ((ciclos as Ciclo[]) ?? [])
    .filter((c) => mapaProductos[c.producto_clave])
    .map((c) => ({ ...c, producto: mapaProductos[c.producto_clave], evento_nombre: mapaEventos[c.evento_id] ?? c.evento_id }));
}

export async function obtenerCiclo(id: string): Promise<CicloConProducto | null> {
  const { data: ciclo, error } = await supabase.from("ciclos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!ciclo) return null;
  const [{ data: producto }, { data: evento }] = await Promise.all([
    supabase.from("productos").select("clave, nombre, precio, gente_requerida, dias_resolucion, activo").eq("clave", (ciclo as Ciclo).producto_clave).single(),
    supabase.from("eventos").select("id, nombre").eq("id", (ciclo as Ciclo).evento_id).single(),
  ]);
  return { ...(ciclo as Ciclo), producto: producto as Producto, evento_nombre: (evento as { nombre: string })?.nombre ?? (ciclo as Ciclo).evento_id };
}

/** Reemplaza cualquier insert directo del cliente a `boletos`. */
export async function comprarBoleto(cicloId: string, respuesta: "si" | "no"): Promise<Boleto> {
  const { data, error } = await supabase.rpc("comprar_boleto", { p_ciclo_id: cicloId, p_respuesta: respuesta });
  if (error) throw error;
  return data as Boleto;
}

export async function obtenerMiBoletoEnCiclo(cicloId: string, userId: string): Promise<Boleto | null> {
  const { data, error } = await supabase.from("boletos").select("*").eq("ciclo_id", cicloId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as Boleto | null;
}

export async function obtenerBoleto(id: string): Promise<Boleto | null> {
  const { data, error } = await supabase.from("boletos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Boleto | null;
}

/**
 * "Responsibility condition" (memo de Finanzas, sección 7, vía
 * Behavioral): fricción suave y OBLIGATORIA -- no opcional -- antes de
 * dejar comprar un boleto mucho más grande de lo que el usuario acostumbra.
 * El memo no da la fórmula exacta de "mucho más grande" -- se implementa
 * como 3x el ticket promedio histórico del usuario (posiciones clásicas +
 * boletos anteriores), documentado como umbral estimado. Sin historial
 * previo no hay contra qué comparar, así que no se dispara en la primera
 * compra de la cuenta.
 */
export async function calcularTicketPromedioHistorico(userId: string): Promise<number | null> {
  const [{ data: perfil }, { count: numPosiciones }, { count: numBoletos }] = await Promise.all([
    supabase.from("perfiles").select("volumen_depositado_acumulado").eq("user_id", userId).maybeSingle(),
    supabase.from("posiciones").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("boletos").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  const total = (numPosiciones ?? 0) + (numBoletos ?? 0);
  const volumen = (perfil as { volumen_depositado_acumulado: number } | null)?.volumen_depositado_acumulado ?? 0;
  if (total === 0 || volumen === 0) return null; // sin historial -- no se puede comparar
  return volumen / total;
}
