// Tipos compartidos del loop. Reflejan 1:1 el esquema de supabase/schema.sql
// -- si cambia una tabla, este archivo cambia con ella.

export type PisoNombre = "tierra" | "plata" | "oro" | "platino" | "obsidiana";

export interface Piso {
  nombre: PisoNombre;
  deposito_min: number;
  activo: boolean; // Prioridad 4: solo tierra/plata/oro activos esta semana
}

export const PISOS: Piso[] = [
  { nombre: "tierra", deposito_min: 200, activo: true },
  { nombre: "plata", deposito_min: 500, activo: true },
  { nombre: "oro", deposito_min: 1000, activo: true },
  { nombre: "platino", deposito_min: 2000, activo: false },
  { nombre: "obsidiana", deposito_min: 5000, activo: false },
];

// PISO Core, checkpoint 3-sep-2026: el arreglo EVENTOS hardcodeado que vivía
// aquí desapareció. La tabla `eventos` de Supabase es ahora la única fuente
// de verdad -- ver src/lib/eventos.ts para los fetchers y el mapeo. Este
// tipo se queda porque las pantallas siguen usando esta forma en memoria;
// lo que cambió es de dónde sale el dato, no la forma.
export interface Evento {
  id: string;
  nombre: string;
  probabilidad: number; // histórica, del documento de negocio §2.3
  activo: boolean; // derivado de eventos.estado === 'abierto', no de un flag suelto
  // Del memo Behavioral (2-sep-2026), sección 2: lenguaje llano + fecha con
  // contexto, agregados por el Dato 1 (comprensión baja de Banxico/INPC).
  explicacion: [string, string];
  fecha: string;
  fechaContexto: string;
}

export type Respuesta = "si" | "no";
export type EstadoPosicion = "abierta" | "resuelta";
export type Resultado = "gano" | "no_gano";

export interface Posicion {
  id: string;
  user_id: string;
  evento_id: string;
  respuesta: Respuesta;
  premio_potencial: number;
  capital_en_riesgo: 0; // siempre 0 -- es el punto central del producto
  estado: EstadoPosicion;
  resultado: Resultado | null;
  creada_en: string;
  resuelta_en: string | null;
}

// Copy exacto del lienzo publicado por Behavioral (NoGanaste.dc.html,
// 2-sep-2026) -- reemplaza las 5 opciones (con "Otro" libre) del memo
// original de DG por estas 4 fijas, en este orden. Ya no hay campo de
// texto libre: el memo pide que el botón avance solo al elegir, sin un
// paso de "Enviar" aparte.
export const PISO_MOMENT_OPCIONES = [
  "Mi dinero nunca estuvo en riesgo",
  "Puedo ganar si tengo razón",
  "Me gusta predecir lo que va a pasar",
  "Quiero subir de nivel",
] as const;

export type PisoMomentOpcion = (typeof PISO_MOMENT_OPCIONES)[number];

export interface PisoMomentRespuesta {
  user_id: string;
  posicion_id: string;
  evento_id: string;
  resultado: Resultado;
  opcion: PisoMomentOpcion;
  opcion_otro_texto: string | null;
}

// Fórmula de premio potencial en modo demo -- simplificada a propósito.
// NO es el motor de precios real (float 25% / carry 12% sobre CETES, ver
// piso_fase0/pricing_engine.py). Ese motor entra cuando exista dinero real;
// esta semana el objetivo es el loop conductual, no el pricing (memo DG,
// "Lo que no construyen esta semana").
export function premioPotencialDemo(deposito: number, probabilidad: number): number {
  const MULTIPLICADOR_DEMO = 0.55; // calibrado solo para que el premio se sienta
  // proporcional al riesgo narrativo del evento -- no es una cifra de negocio.
  return Math.round((deposito * MULTIPLICADOR_DEMO) / probabilidad);
}
