// Tasas -- ¿Banxico recorta en la próxima decisión?
import { betaBinomial } from "../estocastico";
import { serieBanxico, SERIES_BANXICO, SinDatos, URL_SIE } from "../fuentes";
import { DIA, fechaLarga, elegirNivel } from "./comun";
import type { PluginAnalista, AnalistaRow, Borrador } from "./tipos";
import type { ProductoMesa } from "../payoff";

async function proponer(a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador[]> {
  const proxima = a.config.proxima_decision as string | null | undefined;
  if (!proxima) throw new SinDatos("configura la fecha de la próxima decisión de Banxico en /consola/mesa (pestaña Analistas)");
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

  return [{
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
  }];
}


export const tasas: PluginAnalista = {
  clave: "tasas",
  riesgoLegal: { nivel: "bajo", nota: "Evento financiero con fuente oficial. El sorteo en sí sigue sujeto a SEGOB, como todo PISO." },
  proponer,
};
