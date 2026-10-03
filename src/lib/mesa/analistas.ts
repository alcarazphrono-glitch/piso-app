// Mesa de derivados -- los analistas. Cada uno baja datos oficiales, corre
// su modelo (estocastico.ts) y arma el borrador del evento. Si le faltan
// datos lanza SinDatos y no propone nada.

import { betaBinomial, browniano, caminataNormal, BaseEstocastica } from "./estocastico";
import { inpcMensual, serieBanxico, SERIES_BANXICO, SinDatos, URL_SIE } from "./fuentes";
import type { ProductoMesa } from "./payoff";

export interface AnalistaRow {
  clave: string;
  nombre: string;
  mercado: string;
  config: Record<string, unknown>;
}

export interface Borrador {
  titulo: string;
  pregunta: string;
  categoria: string;
  fuente_resolucion: string;
  fecha_resolucion: Date;
  fecha_texto: string;
  base: BaseEstocastica;
  datos: Record<string, unknown>;
  producto_sugerido: string | null;
}

const DIA = 86_400_000;
// Margen para que el humano y Riesgo revisen antes de publicar.
const DIAS_REVISION = 3;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fechaLarga(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "America/Mexico_City" }).format(d);
}

// El nivel más largo cuya venta cierra antes del evento y que no retiene el
// capital más de 7 días después de terminar (misma regla que mesa_publicar).
export function elegirNivel(fechaEvento: Date, productos: ProductoMesa[], ahora = new Date()): string | null {
  const dias = (fechaEvento.getTime() - ahora.getTime()) / DIA - DIAS_REVISION;
  const cabe = productos
    .filter((p) => dias >= p.dias_resolucion && dias - p.dias_resolucion <= 7 - DIAS_REVISION)
    .sort((a, b) => b.dias_resolucion - a.dias_resolucion);
  return cabe[0]?.clave ?? null;
}

// ---------------------------------------------------------------------
// Tasas -- ¿Banxico recorta en la próxima decisión?
// ---------------------------------------------------------------------
async function analistaTasas(a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador> {
  const proxima = a.config.proxima_decision as string | null | undefined;
  if (!proxima) throw new SinDatos("configura la fecha de la próxima decisión de Banxico en /admin/mesa");
  // Banxico anuncia a las 13:00 hora CDMX.
  const fecha = new Date(`${proxima}T13:00:00-06:00`);
  if (fecha.getTime() < Date.now() + DIA) throw new SinDatos("la próxima decisión configurada ya pasó; actualízala");

  const serie = await serieBanxico(SERIES_BANXICO.tasaObjetivo, new Date(Date.now() - 400 * DIA));
  const haceUnAno = Date.now() - 365 * DIA;
  const movimientos: { fecha: string; de: number; a: number }[] = [];
  for (let i = 1; i < serie.length; i++) {
    if (serie[i].valor !== serie[i - 1].valor && serie[i].fecha.getTime() >= haceUnAno) {
      movimientos.push({ fecha: serie[i].fecha.toISOString().slice(0, 10), de: serie[i - 1].valor, a: serie[i].valor });
    }
  }
  const recortes = movimientos.filter((m) => m.a < m.de).length;
  const base = betaBinomial(recortes, 8);
  const actual = serie[serie.length - 1].valor;
  const dia = fechaLarga(fecha);

  return {
    titulo: `Banxico baja la tasa (${dia})`,
    pregunta: `¿Banxico baja la tasa el ${dia}?`,
    categoria: "macro",
    fuente_resolucion: "Banxico -- comunicado oficial de política monetaria",
    fecha_resolucion: fecha,
    fecha_texto: `Se resuelve el ${dia}`,
    base,
    datos: {
      serie: SERIES_BANXICO.tasaObjetivo,
      url: `${URL_SIE}/${SERIES_BANXICO.tasaObjetivo}`,
      tasa_actual: actual,
      movimientos_12m: movimientos,
      supuesto: "8 decisiones programadas por año",
    },
    producto_sugerido: elegirNivel(fecha, productos),
  };
}

// ---------------------------------------------------------------------
// Inflación -- ¿la inflación anual del siguiente mes queda bajo el umbral?
// ---------------------------------------------------------------------
async function analistaInflacion(_a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador> {
  const inpc = await inpcMensual();
  if (inpc.length < 40) throw new SinDatos("INPC con menos de 40 meses de historia");
  const anual = inpc.slice(12).map((p, i) => ({ fecha: p.fecha, valor: (p.valor / inpc[i].valor - 1) * 100 }));
  const ultimos = anual.slice(-25);
  const cambios = ultimos.slice(1).map((p, i) => p.valor - ultimos[i].valor);
  const actual = anual[anual.length - 1];

  let umbral = Math.round(actual.valor * 4) / 4;
  if (umbral === actual.valor) umbral += 0.25;
  const base = caminataNormal(actual.valor, cambios, umbral);

  // Mes objetivo = siguiente al último publicado. INEGI lo publica ~día 9
  // del mes posterior, 06:00 CDMX.
  const objetivo = new Date(Date.UTC(actual.fecha.getUTCFullYear(), actual.fecha.getUTCMonth() + 1, 1));
  const publicacion = new Date(Date.UTC(objetivo.getUTCFullYear(), objetivo.getUTCMonth() + 1, 9, 12));
  if (publicacion.getTime() < Date.now() + DIA) throw new SinDatos("la siguiente publicación del INPC ya está encima; espera el dato nuevo");
  const mes = MESES[objetivo.getUTCMonth()];
  const umbralTxt = umbral.toFixed(2).replace(/\.?0+$/, "");

  return {
    titulo: `Inflación de ${mes} bajo ${umbralTxt}%`,
    pregunta: `¿La inflación de ${mes} cierra bajo ${umbralTxt}%?`,
    categoria: "macro",
    fuente_resolucion: "INEGI -- publicación oficial del INPC",
    fecha_resolucion: publicacion,
    fecha_texto: `Se resuelve el ${fechaLarga(publicacion)}`,
    base,
    datos: {
      indicador: process.env.INEGI_INPC_ID || "628194",
      inflacion_actual: +actual.valor.toFixed(2),
      mes_actual: `${MESES[actual.fecha.getUTCMonth()]} ${actual.fecha.getUTCFullYear()}`,
      ultimos_12: anual.slice(-12).map((p) => +p.valor.toFixed(2)),
    },
    producto_sugerido: elegirNivel(publicacion, productos),
  };
}

// ---------------------------------------------------------------------
// Tipo de cambio -- ¿el FIX cierra arriba del strike al final del nivel?
// ---------------------------------------------------------------------
async function analistaFx(a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador> {
  const nivel = productos.find((p) => p.clave === ((a.config.nivel as string) || "entrada")) ?? productos[0];
  if (!nivel) throw new SinDatos("no hay niveles activos");

  const serie = await serieBanxico(SERIES_BANXICO.fix, new Date(Date.now() - 400 * DIA));
  if (serie.length < 120) throw new SinDatos("FIX con menos de 120 observaciones");
  const tramo = serie.slice(-251);
  const rendimientos = tramo.slice(1).map((p, i) => Math.log(p.valor / tramo[i].valor));
  const spot = tramo[tramo.length - 1].valor;
  const strike = Math.ceil(spot * 4) / 4;

  // Fecha del evento: fin del nivel + días de revisión, movida a día hábil.
  // El FIX se publica a las 12:00 CDMX.
  const fecha = new Date(Date.now() + (nivel.dias_resolucion + DIAS_REVISION) * DIA);
  while ([0, 6].includes(fecha.getUTCDay())) fecha.setTime(fecha.getTime() + DIA);
  fecha.setUTCHours(18, 0, 0, 0);
  let habiles = 0;
  for (let t = Date.now() + DIA; t <= fecha.getTime(); t += DIA) if (![0, 6].includes(new Date(t).getUTCDay())) habiles++;

  const base = browniano(spot, rendimientos, strike, habiles);
  const dia = fechaLarga(fecha);
  const strikeTxt = strike.toFixed(2);

  return {
    titulo: `Dólar arriba de $${strikeTxt} (${dia})`,
    pregunta: `¿El dólar cierra arriba de $${strikeTxt} el ${dia}?`,
    categoria: "mercados",
    fuente_resolucion: "Banxico -- tipo de cambio FIX publicado en el DOF",
    fecha_resolucion: fecha,
    fecha_texto: `Se resuelve el ${dia}`,
    base,
    datos: {
      serie: SERIES_BANXICO.fix,
      url: `${URL_SIE}/${SERIES_BANXICO.fix}`,
      spot,
      fecha_spot: tramo[tramo.length - 1].fecha.toISOString().slice(0, 10),
      observaciones: tramo.length,
    },
    producto_sugerido: elegirNivel(fecha, productos),
  };
}

export const ANALISTAS: Record<string, (a: AnalistaRow, productos: ProductoMesa[]) => Promise<Borrador>> = {
  tasas: analistaTasas,
  inflacion: analistaInflacion,
  fx: analistaFx,
};

export async function tasaCetesBanxico(): Promise<number | null> {
  try {
    const s = await serieBanxico(SERIES_BANXICO.cetes28, new Date(Date.now() - 60 * DIA));
    return s[s.length - 1].valor;
  } catch {
    return null;
  }
}
