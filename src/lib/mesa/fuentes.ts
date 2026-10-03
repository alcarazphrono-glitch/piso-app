// Mesa de derivados -- fuentes de datos oficiales. Solo servidor.
//   Banxico SIE: token gratis en https://www.banxico.org.mx/SieAPIRest/service/v1/token
//   INEGI BIE:   token gratis en https://www.inegi.org.mx/app/api/indicadores/interna_v1_1/tokenVerify.aspx
// Sin token, el analista correspondiente reporta "sin datos" y no propone
// nada: nunca se inventa una serie.

export interface Punto {
  fecha: Date;
  valor: number;
}

export class SinDatos extends Error {}

export const SERIES_BANXICO = {
  tasaObjetivo: "SF61745",
  fix: "SF43718",
  cetes28: "SF43936",
} as const;

export const URL_SIE = "https://www.banxico.org.mx/SieAPIRest/service/v1/series";
export const URL_INEGI = "https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function serieBanxico(idSerie: string, desde: Date, hasta = new Date()): Promise<Punto[]> {
  const token = process.env.BANXICO_TOKEN;
  if (!token) throw new SinDatos("falta BANXICO_TOKEN");
  const res = await fetch(`${URL_SIE}/${idSerie}/datos/${iso(desde)}/${iso(hasta)}`, {
    headers: { "Bmx-Token": token, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Banxico SIE ${idSerie}: HTTP ${res.status}`);
  const json = await res.json();
  const datos: { fecha: string; dato: string }[] = json?.bmx?.series?.[0]?.datos ?? [];
  const puntos = datos
    .map((d) => {
      const [dd, mm, yyyy] = d.fecha.split("/").map(Number);
      return { fecha: new Date(Date.UTC(yyyy, mm - 1, dd)), valor: Number(d.dato.replace(/,/g, "")) };
    })
    .filter((p) => Number.isFinite(p.valor));
  if (puntos.length === 0) throw new SinDatos(`Banxico ${idSerie} sin observaciones`);
  return puntos;
}

// INPC general (índice). Devuelve observaciones mensuales en orden.
export async function inpcMensual(): Promise<Punto[]> {
  const token = process.env.INEGI_TOKEN;
  if (!token) throw new SinDatos("falta INEGI_TOKEN");
  const indicador = process.env.INEGI_INPC_ID || "628194";
  let ultimoError = "";
  for (const fuente of ["BIE-BISE", "BIE"]) {
    const res = await fetch(`${URL_INEGI}/${indicador}/es/0700/false/${fuente}/2.0/${token}?type=json`, { cache: "no-store" });
    if (!res.ok) {
      ultimoError = `INEGI ${fuente}: HTTP ${res.status}`;
      continue;
    }
    const json = await res.json();
    const obs: { TIME_PERIOD: string; OBS_VALUE: string }[] = json?.Series?.[0]?.OBSERVATIONS ?? [];
    const puntos = obs
      .map((o) => {
        const [y, m] = o.TIME_PERIOD.split("/").map(Number);
        return { fecha: new Date(Date.UTC(y, m - 1, 1)), valor: Number(o.OBS_VALUE) };
      })
      .filter((p) => Number.isFinite(p.valor))
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    if (puntos.length > 0) return puntos;
    ultimoError = `INEGI ${fuente}: sin observaciones`;
  }
  throw new Error(ultimoError);
}

// Momios de mercado (The Odds API, plan gratis 500 llamadas/mes):
// https://the-odds-api.com -- ODDS_API_KEY. Es el "derivado de referencia"
// para eventos deportivos: el mercado ya pone precio a la probabilidad.
export const URL_ODDS = "https://api.the-odds-api.com/v4/sports";

export interface PartidoMomios {
  id: string;
  liga: string;
  inicio: Date;
  local: string;
  visitante: string;
  // Probabilidad implícita sin margen de que gane el local, una por casa.
  pLocalPorCasa: { casa: string; p: number }[];
}

export async function momiosLiga(liga: string): Promise<PartidoMomios[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new SinDatos("falta ODDS_API_KEY");
  const res = await fetch(`${URL_ODDS}/${liga}/odds?apiKey=${key}&regions=us,eu,uk&markets=h2h&oddsFormat=decimal`, { cache: "no-store" });
  if (!res.ok) throw new Error(`The Odds API ${liga}: HTTP ${res.status}`);
  const juegos: {
    id: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: { title: string; markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
  }[] = await res.json();
  return juegos.map((j) => ({
    id: j.id,
    liga,
    inicio: new Date(j.commence_time),
    local: j.home_team,
    visitante: j.away_team,
    pLocalPorCasa: j.bookmakers
      .map((b) => {
        const h2h = b.markets.find((m) => m.key === "h2h");
        if (!h2h) return null;
        const implicitas = h2h.outcomes.map((o) => ({ name: o.name, q: 1 / o.price }));
        const total = implicitas.reduce((acc, o) => acc + o.q, 0);
        const local = implicitas.find((o) => o.name === j.home_team);
        return local && total > 0 ? { casa: b.title, p: local.q / total } : null;
      })
      .filter((x): x is { casa: string; p: number } => x !== null),
  }));
}
