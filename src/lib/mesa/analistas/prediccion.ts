// Tendencias -- eventos de todo tipo (cultura, tecnología, economía global,
// deportes) que ya tienen un contrato Sí/No líquido en un mercado de
// predicción. El precio del Sí es la base: el mercado ya puso probabilidad.
// Prioriza lo que más se está operando (volumen 24h = lo que la gente
// está siguiendo hoy), que es lo más compartible.
import { precioPrediccion } from "../estocastico";
import { mercadosPrediccion, SinDatos, URL_POLYMARKET } from "../fuentes";
import { elegirNivel, fechaLarga } from "./comun";
import type { PluginAnalista, AnalistaRow, Borrador, NivelRiesgoLegal } from "./tipos";
import type { ProductoMesa } from "../payoff";

const DEPORTIVO = ["sports", "soccer", "nba", "nfl", "mlb", "nhl", "ufc", "tennis", "f1", "esports", "boxing"];

async function proponer(a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador[]> {
  const liquidezMin = Number(a.config.liquidez_min_usd ?? 50000);
  const max = Number(a.config.max_propuestas ?? 3);
  const excluir = ((a.config.excluir as string[]) ?? ["politics", "elections"]).map((x) => x.toLowerCase());

  const mercados = await mercadosPrediccion();
  const candidatos = mercados
    .filter((m) => m.liquidez >= liquidezMin)
    // Muy seguro o muy improbable no engancha: nadie opina distinto.
    .filter((m) => m.pSi >= 0.15 && m.pSi <= 0.85)
    .filter((m) => !m.etiquetas.some((t) => excluir.some((x) => t.includes(x))))
    .map((m) => ({ m, nivel: elegirNivel(m.fin, productos) }))
    .filter((c) => c.nivel !== null)
    .sort((x, y) => y.m.volumen24h - x.m.volumen24h)
    .slice(0, max);

  if (candidatos.length === 0) throw new SinDatos("ningún mercado líquido cae en la ventana de algún nivel");

  return candidatos.map(({ m, nivel }) => {
    const deportivo = m.etiquetas.some((t) => DEPORTIVO.includes(t));
    const riesgo: { nivel: NivelRiesgoLegal; nota: string } = deportivo
      ? { nivel: "alto", nota: "Evento deportivo: SEGOB puede tratarlo como apuesta deportiva. No publicar sin visto bueno de Legal." }
      : { nivel: "medio", nota: "Evento tomado de un mercado de predicción extranjero. Confirmar con Legal la fuente de resolución y el tema." };
    return {
      titulo: m.pregunta,
      pregunta: m.pregunta,
      categoria: deportivo ? "deportes" : "tendencias",
      fuente_resolucion: "Resultado oficial del evento (referencia: Polymarket)",
      fecha_resolucion: m.fin,
      fecha_texto: `Se resuelve el ${fechaLarga(m.fin)}`,
      base: precioPrediccion(m.pSi, m.bid, m.ask),
      datos: {
        fuente: `${URL_POLYMARKET}?slug=${m.slug}`,
        pregunta_original: m.pregunta,
        evento: m.evento,
        liquidez_usd: Math.round(m.liquidez),
        volumen_24h_usd: Math.round(m.volumen24h),
        etiquetas: m.etiquetas,
      },
      producto_sugerido: nivel,
      ref_externa: `polymarket-${m.id}`,
      traducir: true,
      riesgo_legal: riesgo,
    } satisfies Borrador;
  });
}

export const prediccion: PluginAnalista = {
  clave: "prediccion",
  riesgoLegal: { nivel: "medio", nota: "Evento tomado de un mercado de predicción extranjero." },
  proponer,
};
