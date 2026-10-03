// Mesa de derivados -- estructura de payoff por nivel.
//
// PUNTO ÚNICO de la fórmula en TS: la mesa, Riesgo y la consola leen de
// aquí. Decisión de Beto (2026-10-03): premio = lo que generó el pool + el
// bote acumulado, SIN dividir entre la probabilidad. PISO nunca pone de su
// bolsa: el premio sale del rendimiento real, y PISO gana alpha_em sobre
// ese rendimiento más el carry sobre el premio base.
//
//   rendimiento = N × boleto × (e^(tasa × días/365) − 1)
//   premio_base = rendimiento × (1 − alpha_em) × (1 − carry)
//   premio      = premio_base + bote
//   ingreso PISO = rendimiento × alpha_em + carry
//
// En Postgres la fórmula vive en calcular_premio_ciclo() (migración 0011 del
// hilo El Reto, que también suma el bote). Las dos deben decir lo mismo.

export interface ProductoMesa {
  clave: string;
  nombre: string;
  precio: number;
  gente_requerida: number;
  dias_resolucion: number;
  alpha_em: number | null;
}

export interface TramoCarry {
  producto_clave: string;
  orden: number;
  premio_hasta: number | null;
  carry_pct: number;
}

export interface PayoffNivel {
  nivel: string;
  nombre: string;
  dias: number;
  capital_pool: number;
  rendimiento_pool: number;
  margen_alpha: number;
  carry_pct: number;
  carry_mxn: number;
  premio_base: number;
  bote: number;
  premio: number;
  ingreso_piso: number;
  ingreso_por_usuario: number;
  // Lo que PISO pondría de su bolsa si el evento ocurre. Con esta fórmula
  // siempre es 0; se deja explícito para que Riesgo lo vea.
  aporte_piso: number;
  supuestos: string[];
}

// Acuerdos vigentes en la memoria del proyecto: r_cetes 10%, alpha_em 25%.
// Solo se usan si la base no tiene el dato, y quedan marcados.
const TASA_SUPUESTA = 10;
const ALPHA_SUPUESTO = 0.25;

export type TasaCetes = { valor: number; fuente: string } | null;

export function calcularPayoff(
  producto: ProductoMesa,
  tramos: TramoCarry[],
  tasaCetes: TasaCetes,
  bote = 0
): PayoffNivel {
  const supuestos: string[] = [];
  const tasa = tasaCetes?.valor ?? TASA_SUPUESTA;
  if (!tasaCetes) supuestos.push(`tasa CETES ${TASA_SUPUESTA}% (supuesto, falta en parametros_pricing)`);
  else if (tasaCetes.fuente !== "parametros_pricing") supuestos.push(`tasa CETES ${tasa}% de ${tasaCetes.fuente} (parametros_pricing vacío)`);
  const alpha = producto.alpha_em ?? ALPHA_SUPUESTO;
  if (producto.alpha_em == null) supuestos.push(`alpha_em ${ALPHA_SUPUESTO * 100}% (supuesto, falta en productos)`);

  const capital = producto.gente_requerida * producto.precio;
  const rendimiento = capital * (Math.exp((tasa / 100) * (producto.dias_resolucion / 365)) - 1);
  const despuesAlpha = rendimiento * (1 - alpha);

  const tramo = tramos
    .filter((t) => t.producto_clave === producto.clave)
    .sort((a, b) => a.orden - b.orden)
    .find((t) => t.premio_hasta == null || despuesAlpha <= t.premio_hasta);
  const carry = tramo?.carry_pct ?? 30;
  const premioBase = Math.round(despuesAlpha * (1 - carry / 100));
  const carryMxn = despuesAlpha - premioBase;
  const ingreso = rendimiento * alpha + carryMxn;

  return {
    nivel: producto.clave,
    nombre: producto.nombre,
    dias: producto.dias_resolucion,
    capital_pool: Math.round(capital),
    rendimiento_pool: Math.round(rendimiento),
    margen_alpha: Math.round(rendimiento * alpha),
    carry_pct: carry,
    carry_mxn: Math.round(carryMxn),
    premio_base: premioBase,
    bote: Math.round(bote),
    premio: premioBase + Math.round(bote),
    ingreso_piso: Math.round(ingreso),
    ingreso_por_usuario: +(ingreso / producto.gente_requerida).toFixed(2),
    aporte_piso: 0,
    supuestos,
  };
}

// Cuánto gana PISO por usuario: por boleto y al año si el usuario mantiene
// su dinero en el nivel todo el año (un ciclo tras otro).
export interface EconomiaUsuario {
  nivel: string;
  nombre: string;
  boleto: number;
  por_ciclo: number;
  ciclos_por_ano: number;
  por_ano: number;
  pct_del_deposito_anual: number;
}

export function economiaPorUsuario(producto: ProductoMesa, tramos: TramoCarry[], tasaCetes: TasaCetes): EconomiaUsuario {
  const p = calcularPayoff(producto, tramos, tasaCetes);
  const ciclos = 365 / producto.dias_resolucion;
  const porAno = p.ingreso_por_usuario * ciclos;
  return {
    nivel: producto.clave,
    nombre: producto.nombre,
    boleto: producto.precio,
    por_ciclo: p.ingreso_por_usuario,
    ciclos_por_ano: +ciclos.toFixed(1),
    por_ano: Math.round(porAno),
    pct_del_deposito_anual: +((porAno / producto.precio) * 100).toFixed(2),
  };
}
