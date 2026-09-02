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

export type EventoId = "banxico_baja_tasas";

export interface Evento {
  id: EventoId;
  nombre: string;
  probabilidad: number; // histórica, del documento de negocio §2.3
  activo: boolean; // Prioridad 3: un solo evento esta semana
}

// Solo un evento activo esta semana (Prioridad 3). Los demás quedan aquí
// listados y bloqueados a propósito -- así se mide demanda sin construirlos.
export const EVENTOS: Evento[] = [
  { id: "banxico_baja_tasas", nombre: "Banxico baja tasas", probabilidad: 0.35, activo: true },
  { id: "tortilla_sube" as EventoId, nombre: "Precio tortilla sube >5%", probabilidad: 0.25, activo: false },
  { id: "inpc_bajo" as EventoId, nombre: "Inflación INPC < 4%", probabilidad: 0.4, activo: false },
  { id: "ipc_sube" as EventoId, nombre: "IPC BMV sube >2%", probabilidad: 0.45, activo: false },
];

export type Respuesta = "si" | "no";
export type EstadoPosicion = "abierta" | "resuelta";
export type Resultado = "gano" | "no_gano";

export interface Posicion {
  id: string;
  user_id: string;
  evento_id: EventoId;
  respuesta: Respuesta;
  premio_potencial: number;
  capital_en_riesgo: 0; // siempre 0 -- es el punto central del producto
  estado: EstadoPosicion;
  resultado: Resultado | null;
  creada_en: string;
  resuelta_en: string | null;
}

export const PISO_MOMENT_OPCIONES = [
  "No puedo perder mi capital",
  "Puedo ganar si acierto",
  "Puedo elegir los eventos",
  "Puedo subir de piso",
  "Otro",
] as const;

export type PisoMomentOpcion = (typeof PISO_MOMENT_OPCIONES)[number];

export interface PisoMomentRespuesta {
  user_id: string;
  posicion_id: string;
  evento_id: EventoId;
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
