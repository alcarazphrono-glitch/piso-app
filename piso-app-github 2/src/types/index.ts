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

export type EventoId = "banxico_baja_tasas" | "inpc_bajo" | "tortilla_sube" | "ipc_sube";

export interface Evento {
  id: EventoId;
  nombre: string;
  probabilidad: number; // histórica, del documento de negocio §2.3
  activo: boolean; // Prioridad 3: un solo evento esta semana
  // Del memo Behavioral (2-sep-2026), sección 2: lenguaje llano + fecha con
  // contexto, agregados por el Dato 1 (comprensión baja de Banxico/INPC).
  explicacion: [string, string];
  fecha: string;
  fechaContexto: string;
}

// Sección 8 del memo Behavioral (2-sep-2026): segundo evento activo esta
// semana (INPC), misma plantilla que Banxico. Los otros dos quedan
// bloqueados a propósito -- así se mide demanda sin construirlos.
export const EVENTOS: Evento[] = [
  {
    id: "banxico_baja_tasas",
    nombre: "Banxico baja tasas",
    probabilidad: 0.35,
    activo: true,
    explicacion: [
      "Banxico decide si baja la tasa de interés del país.",
      "Si baja, pedir dinero prestado se vuelve más barato para todos.",
    ],
    fecha: "Se resuelve el 18 de septiembre",
    fechaContexto: "Decisión de política monetaria de Banxico",
  },
  {
    id: "inpc_bajo",
    nombre: "¿La inflación de agosto cerrará bajo 4%?",
    probabilidad: 0.4,
    activo: true,
    explicacion: [
      "El INPC mide qué tan rápido suben los precios en México.",
      "Si cierra bajo 4%, tu dinero pierde menos poder de compra.",
    ],
    fecha: "Se resuelve el 9 de septiembre",
    fechaContexto: "Publicación del INPC",
  },
  {
    id: "tortilla_sube",
    nombre: "Precio tortilla sube >5%",
    probabilidad: 0.25,
    activo: false,
    explicacion: ["", ""],
    fecha: "",
    fechaContexto: "",
  },
  {
    id: "ipc_sube",
    nombre: "IPC BMV sube >2%",
    probabilidad: 0.45,
    activo: false,
    explicacion: ["", ""],
    fecha: "",
    fechaContexto: "",
  },
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
