// Inflación -- ¿la inflación anual del siguiente mes queda bajo el umbral?
import { caminataNormal } from "../estocastico";
import { inpcMensual, SinDatos } from "../fuentes";
import { DIA, fechaLarga, elegirNivel, MESES } from "./comun";
import type { PluginAnalista, AnalistaRow, Borrador } from "./tipos";
import type { ProductoMesa } from "../payoff";

async function proponer(_a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador[]> {
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

  return [{
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
  }];
}


export const inflacion: PluginAnalista = {
  clave: "inflacion",
  riesgoLegal: { nivel: "bajo", nota: "Evento financiero con fuente oficial. El sorteo en sí sigue sujeto a SEGOB, como todo PISO." },
  proponer,
};
