// Mesa de derivados -- estructura de payoff por nivel. Espejo en TS de
// calcular_premio_ciclo() (migración 0010) para que el humano vea el
// payoff ANTES de publicar. La fuente de verdad al liquidar sigue siendo
// la función de Postgres.
//
// PUNTO ÚNICO de la fórmula en TS: la mesa, Riesgo y la consola leen de
// aquí. En discusión con Finanzas cambiarla a premio = rendimiento del pool
// + bote (sin 1/p). Si se decide, se cambia aquí y en calcular_premio_ciclo
// (Postgres), nada más.
//
// Lectura como derivado: cada lado (sí/no) es un digital que paga
// `premio_neto` si ocurre. Su valor justo es p × premio. Lo que lo fondea es
// el rendimiento del pool menos alpha_em. Si ocurre, la diferencia entre el
// premio y ese fondeo la pone la reserva: eso es el déficit en el peor caso.

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
  premio_bruto: number;
  carry_pct: number;
  premio_neto: number;
  valor_esperado: number;
  fondeo_disponible: number;
  peor_caso: number;
  deficit_peor_caso: number;
  supuestos: string[];
}

// Acuerdos vigentes en la memoria del proyecto: r_cetes 10%, alpha_em 25%.
// Solo se usan si la base no tiene el dato, y quedan marcados.
const TASA_SUPUESTA = 10;
const ALPHA_SUPUESTO = 0.25;

export function calcularPayoff(
  p: number,
  producto: ProductoMesa,
  tramos: TramoCarry[],
  tasaCetes: { valor: number; fuente: string } | null
): PayoffNivel {
  const supuestos: string[] = [];
  const tasa = tasaCetes?.valor ?? TASA_SUPUESTA;
  if (!tasaCetes) supuestos.push(`tasa CETES ${TASA_SUPUESTA}% (supuesto, falta en parametros_pricing)`);
  else if (tasaCetes.fuente !== "parametros_pricing") supuestos.push(`tasa CETES ${tasa}% de ${tasaCetes.fuente} (parametros_pricing vacío)`);
  const alpha = producto.alpha_em ?? ALPHA_SUPUESTO;
  if (producto.alpha_em == null) supuestos.push(`alpha_em ${ALPHA_SUPUESTO * 100}% (supuesto, falta en productos)`);

  const capital = producto.gente_requerida * producto.precio;
  const rendimiento = capital * (Math.exp((tasa / 100) * (producto.dias_resolucion / 365)) - 1);
  const bruto = (rendimiento * (1 - alpha)) / p;

  const tramo = tramos
    .filter((t) => t.producto_clave === producto.clave)
    .sort((a, b) => a.orden - b.orden)
    .find((t) => t.premio_hasta == null || bruto <= t.premio_hasta);
  const carry = tramo?.carry_pct ?? 30;
  const neto = Math.round(bruto * (1 - carry / 100));
  const fondeo = rendimiento * (1 - alpha);

  return {
    nivel: producto.clave,
    nombre: producto.nombre,
    dias: producto.dias_resolucion,
    capital_pool: Math.round(capital),
    rendimiento_pool: Math.round(rendimiento),
    margen_alpha: Math.round(rendimiento * alpha),
    premio_bruto: Math.round(bruto),
    carry_pct: carry,
    premio_neto: neto,
    valor_esperado: Math.round(p * neto),
    fondeo_disponible: Math.round(fondeo),
    peor_caso: neto,
    deficit_peor_caso: Math.max(0, Math.round(neto - fondeo)),
    supuestos,
  };
}
