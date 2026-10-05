// Tipo de cambio -- ¿el FIX cierra arriba del strike al final del nivel?
import { browniano } from "../estocastico";
import { serieBanxico, SERIES_BANXICO, SinDatos, URL_SIE } from "../fuentes";
import { DIA, fechaLarga, elegirNivel, DIAS_REVISION } from "./comun";
import type { PluginAnalista, AnalistaRow, Borrador } from "./tipos";
import type { ProductoMesa } from "../payoff";

async function proponer(a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador[]> {
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

  return [{
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
  }];
}


export const fx: PluginAnalista = {
  clave: "fx",
  riesgoLegal: { nivel: "bajo", nota: "Evento financiero con fuente oficial. El sorteo en sí sigue sujeto a SEGOB, como todo PISO." },
  proponer,
};
