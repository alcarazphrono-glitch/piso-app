// Deportes -- ¿gana el local? Ligas globales configurables (Liga MX,
// Champions, Premier, NBA, NFL...). El derivado de referencia son los momios
// 1X2 del mercado (varias casas). Propone los partidos que caben en algún
// nivel, prefiriendo los más parejos (p cerca de 50%), que son los que más
// enganchan y los que menos déficit dejan en el peor caso.

import { implicitaMercado } from "../estocastico";
import { momiosLiga, SinDatos, URL_ODDS } from "../fuentes";
import { elegirNivel, fechaLarga } from "./comun";
import type { PluginAnalista, AnalistaRow, Borrador } from "./tipos";
import type { ProductoMesa } from "../payoff";

const NOMBRE_LIGA: Record<string, string> = {
  soccer_mexico_ligamx: "Liga MX",
  soccer_uefa_champs_league: "Champions League",
  soccer_epl: "Premier League",
  basketball_nba: "NBA",
  americanfootball_nfl: "NFL",
};

async function proponer(a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador[]> {
  const ligas = (a.config.ligas as string[] | undefined) ?? ["soccer_mexico_ligamx"];
  const max = Number(a.config.max_propuestas ?? 2);

  if (!process.env.ODDS_API_KEY) throw new SinDatos("falta ODDS_API_KEY");
  // Una liga caída no tumba a las demás.
  const partidos = (await Promise.allSettled(ligas.map(momiosLiga))).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const candidatos = partidos
    .filter((p) => p.pLocalPorCasa.length >= 3)
    .map((p) => {
      // El partido termina ~2h después de empezar; se resuelve con el
      // resultado oficial, 3h después del silbatazo inicial.
      const fin = new Date(p.inicio.getTime() + 3 * 3_600_000);
      return { p, fin, nivel: elegirNivel(fin, productos), base: implicitaMercado(p.pLocalPorCasa.map((c) => c.p)) };
    })
    .filter((c) => c.nivel !== null)
    .sort((x, y) => Math.abs(x.base.probabilidad - 0.5) - Math.abs(y.base.probabilidad - 0.5))
    .slice(0, max);

  if (candidatos.length === 0) throw new SinDatos("ningún partido con momios cae en la ventana de algún nivel");

  return candidatos.map(({ p, fin, nivel, base }) => {
    const liga = NOMBRE_LIGA[p.liga] ?? p.liga;
    const dia = fechaLarga(p.inicio);
    return {
      titulo: `${p.local} le gana a ${p.visitante} (${dia})`,
      pregunta: `¿${p.local} le gana a ${p.visitante} el ${dia}?`,
      categoria: "deportes",
      fuente_resolucion: `${liga} -- resultado oficial del partido`,
      fecha_resolucion: fin,
      fecha_texto: `Se resuelve el ${dia}`,
      base,
      datos: {
        fuente: URL_ODDS,
        liga,
        partido_id: p.id,
        inicio: p.inicio.toISOString(),
        p_local_por_casa: p.pLocalPorCasa.map((c) => ({ casa: c.casa, p: +c.p.toFixed(3) })),
        nota: "Empate cuenta como NO.",
      },
      producto_sugerido: nivel,
      ref_externa: `odds-${p.id}`,
    } satisfies Borrador;
  });
}

export const deportes: PluginAnalista = {
  clave: "deportes",
  riesgoLegal: {
    nivel: "alto",
    nota: "Evento deportivo: SEGOB puede tratarlo como apuesta deportiva (Ley Federal de Juegos y Sorteos). No publicar a usuarios reales sin visto bueno de Legal.",
  },
  proponer,
};
