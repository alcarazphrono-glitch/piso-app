// Unit economics de PISO -- PUNTO ÚNICO del cálculo (Finanzas, 4-oct-2026).
//
// La app (premio que ve el usuario), la consola de la Mesa (payoff, Riesgo)
// y la herramienta "Palancas PISO" usan estas funciones. Los números salen
// de la base (economia_parametros, productos, producto_carry_tramos,
// parametros_pricing) vía cargar.ts; aquí no hay fetch, solo matemáticas,
// para que corra igual en el servidor, en el cliente y en pruebas.
//
//   rendimiento = N × boleto × (e^(tasa × días/365) − 1)
//   bruto       = rendimiento × (1 − alpha_em − alpha_c1) + N × cuota_sin_iva × cuota_al_premio
//   premio      = bruto × (1 − carry del tramo) + bote
//   ingreso PISO = rendimiento × alpha_em + carry + cuota_sin_iva × (1 − cuota_al_premio)
//
// Con cuota 0 y alpha_c1 0 es exactamente la fórmula de calcular_premio_ciclo
// (migración 0011) y de src/lib/mesa/payoff.ts. PISO nunca pone de su bolsa.

export const NIVELES = ["entrada", "crecimiento", "elite"] as const;
export type Nivel = (typeof NIVELES)[number];

export interface ProductoEco {
  clave: Nivel;
  nombre: string;
  precio: number;          // boleto, MXN
  gente_requerida: number; // N
  dias_resolucion: number;
  alpha_em: number;        // fracción
  cuota_evento: number;    // MXN con IVA
}

export interface TramoCarry {
  producto_clave: string;
  orden: number;
  premio_hasta: number | null;
  carry_pct: number; // en %
}

export interface Fijas {
  cetes: number;           // fracción anual (0.10)
  spread: number;
  iva: number;
  isrPremio: number;
  aprovechamiento: number;
  custodia: number;
  costoPago: number;
  infra: number;
  kyc: number;
  fijoMes: number;
}

export interface Palancas {
  alphaC1: number;
  cuotaAlPremio: number;
  saldo: number;
  eventosMes: number;
  cac: number;
  bono: number;
  churn: number;
  usuarios: number;
  mezcla: Record<Nivel, number>;
}

export interface Umbral { multiplo: number; espera: number; costoMes: number; costoAno: number }

export interface Escenario {
  fijas: Fijas;
  palancas: Palancas;
  umbral: Umbral;
  productos: Record<Nivel, ProductoEco>;
  tramos: TramoCarry[];
}

// Igual que payoff.ts: primer tramo cuyo tope cubre el premio antes de carry; sin tramos, 30%.
export function carryDeTramos(tramos: TramoCarry[], clave: string, bruto: number): number {
  const t = tramos
    .filter((x) => x.producto_clave === clave)
    .sort((a, b) => a.orden - b.orden)
    .find((x) => x.premio_hasta == null || bruto <= x.premio_hasta);
  return (t?.carry_pct ?? 30) / 100;
}

export interface PremioCiclo {
  rendimiento: number;
  bruto: number;
  carry: number;      // fracción aplicada
  carryMxn: number;
  premio: number;     // lo que se anuncia (antes de ISR)
  premioEnMano: number; // después de la retención de ISR
  ingresoPiso: number;
}

/** Premio de un ciclo con `ocupados` boletos. Lo usan la app y la Mesa. */
export function premioCiclo(e: Escenario, nivel: Nivel, ocupados?: number, dias?: number, bote = 0): PremioCiclo {
  const p = e.productos[nivel], f = e.fijas, k = e.palancas;
  const n = ocupados ?? p.gente_requerida;
  const d = dias ?? p.dias_resolucion;
  const tasa = Math.max(0, f.cetes - f.spread);
  const rendimiento = n * p.precio * (Math.exp((tasa * d) / 365) - 1);
  const cuotaNeta = p.cuota_evento / (1 + f.iva);
  const bruto = rendimiento * Math.max(0, 1 - p.alpha_em - k.alphaC1) + n * cuotaNeta * k.cuotaAlPremio;
  const carry = carryDeTramos(e.tramos, nivel, bruto);
  const base = Math.round(bruto * (1 - carry));
  const premio = base + Math.round(bote);
  const ingresoPiso = rendimiento * p.alpha_em + (bruto - base) + n * (cuotaNeta * (1 - k.cuotaAlPremio) - p.cuota_evento * f.aprovechamiento);
  return { rendimiento, bruto, carry, carryMxn: bruto - base, premio, premioEnMano: premio * (1 - f.isrPremio), ingresoPiso };
}

export interface ResultadoNivel {
  nivel: Nivel;
  espera: number; ciclos: number; util: number;
  premioEnMano: number; multiplo: number; prob: number;
  ingreso: number; ingRend: number; ingCarry: number; ingCuota: number; ingSaldo: number;
  costoVar: number; contrib: number;
  costoNetoMes: number; costoNetoAno: number;
  pasa: { multiplo: boolean; espera: boolean; costo: boolean };
  ok: boolean;
}

/** Economía por usuario de un nivel, al año. */
export function calcularNivel(e: Escenario, nivel: Nivel): ResultadoNivel {
  const p = e.productos[nivel], f = e.fijas, k = e.palancas, N = p.gente_requerida;
  const tasa = Math.max(0, f.cetes - f.spread);
  const boletosDia = (k.usuarios * k.mezcla[nivel] * k.eventosMes) / 30;
  const espera = boletosDia > 0 ? N / boletosDia : Infinity;
  const diasInv = espera / 2 + p.dias_resolucion; // quien compra a mitad del llenado
  const ciclos = Math.min(k.eventosMes * 12, 365 / diasInv);
  const util = Math.min(1, (ciclos * diasInv) / 365);
  const c = premioCiclo(e, nivel, N, diasInv);
  const porUsuario = 1 / N;
  const ingRend = ciclos * c.rendimiento * p.alpha_em * porUsuario;
  const ingCarry = ciclos * c.carryMxn * porUsuario;
  const cuotaNeta = p.cuota_evento / (1 + f.iva);
  const ingCuota = ciclos * (cuotaNeta * (1 - k.cuotaAlPremio) - p.cuota_evento * f.aprovechamiento);
  const rendSaldo = p.precio * tasa * (1 - util) * k.saldo;
  const ingSaldo = rendSaldo * p.alpha_em;
  const ingreso = ingRend + ingCarry + ingCuota + ingSaldo;
  const invertido = p.precio * (util + (1 - util) * k.saldo);
  const costoVar = ciclos * f.costoPago * (2 - k.saldo) + f.custodia * invertido + f.infra;
  const contrib = ingreso - costoVar;
  const rendCicloUsuario = c.rendimiento * porUsuario;
  const recibe = ciclos * c.premioEnMano * porUsuario + rendSaldo * (1 - p.alpha_em) + ciclos * rendCicloUsuario * k.alphaC1;
  const costoNetoAno = ciclos * p.cuota_evento + p.precio * f.cetes - recibe; // contra dejarlo en CETES
  const costoNetoMes = costoNetoAno / 12;
  const multiplo = c.premioEnMano / p.precio;
  const u = e.umbral;
  const pasa = {
    multiplo: multiplo >= u.multiplo,
    espera: espera <= u.espera,
    costo: costoNetoMes <= u.costoMes && costoNetoAno <= u.costoAno * p.precio,
  };
  return { nivel, espera, ciclos, util, premioEnMano: c.premioEnMano, multiplo, prob: 1 / N, ingreso, ingRend, ingCarry,
    ingCuota, ingSaldo, costoVar, contrib, costoNetoMes, costoNetoAno, pasa, ok: pasa.multiplo && pasa.espera && pasa.costo };
}

export interface Resultado {
  niveles: Record<Nivel, ResultadoNivel>;
  contrib: number; ingreso: number; costoVar: number;
  adquisicion: number; ltv: number; ltvCac: number; payback: number; breakeven: number; utilidadMes: number;
  ok: boolean;
}

/** Ganancia por usuario contra lo que cuesta conseguirlo, con la mezcla de niveles. */
export function calcular(e: Escenario): Resultado {
  const k = e.palancas, f = e.fijas;
  const niveles = {} as Record<Nivel, ResultadoNivel>;
  let contrib = 0, ingreso = 0, costoVar = 0;
  for (const n of NIVELES) {
    const r = calcularNivel(e, n); niveles[n] = r;
    contrib += k.mezcla[n] * r.contrib; ingreso += k.mezcla[n] * r.ingreso; costoVar += k.mezcla[n] * r.costoVar;
  }
  const adquisicion = k.cac + k.bono + f.kyc;
  const ltv = (contrib / 12) / k.churn;
  return {
    niveles, contrib, ingreso, costoVar, adquisicion, ltv,
    ltvCac: ltv / adquisicion,
    payback: contrib > 0 ? adquisicion / (contrib / 12) : Infinity,
    breakeven: contrib > 0 ? (f.fijoMes * 12) / contrib : Infinity,
    utilidadMes: (k.usuarios * contrib) / 12 - f.fijoMes - k.usuarios * k.churn * adquisicion,
    ok: NIVELES.every((n) => niveles[n].ok),
  };
}
