// Mesa de derivados -- payoff por nivel para cada propuesta.
//
// No tiene fórmula propia: usa premioCiclo() de src/lib/economia/modelo.ts,
// el punto único del cálculo (Finanzas, PR #4). Aquí solo se adapta el
// resultado a lo que muestran la Mesa y Riesgo.
//
//   premio = rendimiento × (1 − alpha_em − alpha_c1) + cuota al premio,
//            menos carry del tramo, + bote. PISO nunca pone de su bolsa.

import { premioCiclo, type Escenario, type Nivel } from "@/lib/economia/modelo";

// Lo mínimo que necesitan los analistas para elegir nivel.
export interface ProductoMesa {
  clave: string;
  nombre: string;
  precio: number;
  gente_requerida: number;
  dias_resolucion: number;
  alpha_em: number | null;
}

export interface PayoffNivel {
  nivel: string;
  nombre: string;
  dias: number;
  capital_pool: number;
  rendimiento_pool: number;
  carry_pct: number;
  carry_mxn: number;
  premio_base: number;
  bote: number;
  premio: number;
  premio_en_mano: number;
  ingreso_piso: number;
  ingreso_por_usuario: number;
  // Lo que PISO pondría de su bolsa si el evento ocurre: siempre 0 con esta
  // fórmula; se deja explícito para que Riesgo lo vea.
  aporte_piso: number;
  supuestos: string[];
}

export function calcularPayoff(e: Escenario, nivel: Nivel, bote = 0, supuestos: string[] = []): PayoffNivel {
  const p = e.productos[nivel];
  const c = premioCiclo(e, nivel, undefined, undefined, bote);
  return {
    nivel,
    nombre: p.nombre,
    dias: p.dias_resolucion,
    capital_pool: Math.round(p.gente_requerida * p.precio),
    rendimiento_pool: Math.round(c.rendimiento),
    carry_pct: Math.round(c.carry * 100),
    carry_mxn: Math.round(c.carryMxn),
    premio_base: c.premio - Math.round(bote),
    bote: Math.round(bote),
    premio: c.premio,
    premio_en_mano: Math.round(c.premioEnMano),
    ingreso_piso: Math.round(c.ingresoPiso),
    ingreso_por_usuario: +(c.ingresoPiso / p.gente_requerida).toFixed(2),
    aporte_piso: 0,
    supuestos,
  };
}
