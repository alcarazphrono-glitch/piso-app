// Mesa de derivados -- la lectura del analista. Claude recibe los números
// ya calculados y redacta tesis, riesgos y una frase para el usuario. No
// cambia la probabilidad ni el payoff. Sin ANTHROPIC_API_KEY, o si la
// llamada falla, cae a un texto plantilla con los mismos números.

import Anthropic from "@anthropic-ai/sdk";
import type { Borrador } from "./analistas/tipos";

export interface Narrativa {
  tesis: string;
  riesgos: string;
  descripcion_usuario: string;
  gancho_redes: string;
  pregunta?: string;
  titulo?: string;
  motor: "claude" | "plantilla";
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function plantilla(b: Borrador): Narrativa {
  return {
    tesis: `Modelo ${b.base.modelo}: probabilidad ${pct(b.base.probabilidad)} (intervalo ${pct(b.base.prob_baja)}–${pct(b.base.prob_alta)}).`,
    riesgos: "Sin lectura cualitativa (falta ANTHROPIC_API_KEY o falló la llamada). Revisar los datos a mano.",
    descripcion_usuario: b.pregunta,
    gancho_redes: `${b.pregunta} El mercado dice ${pct(b.base.probabilidad)}. ¿Tú qué dices?`,
    motor: "plantilla",
  };
}

const SISTEMA = `Eres analista en la mesa de derivados de PISO, una app mexicana donde el capital del usuario está protegido y solo el rendimiento se pone en juego en eventos sí/no.
Recibes un evento propuesto con su base estocástica ya calculada por código. No cambies ni recalcules la probabilidad: tu trabajo es explicar.
Escribe en español de México, directo y sin jerga.
- tesis: 2 o 3 frases. Qué dicen los datos y por qué el modelo da esa probabilidad.
- riesgos: 1 o 2 frases. Qué podría hacer que el modelo se equivoque (supuestos, eventos próximos, datos viejos).
- descripcion_usuario: 1 frase corta que vería un usuario de 18 a 24 años para entender el evento.
- gancho_redes: 1 línea para TikTok/Instagram/X que haga que alguien de 18 a 24 quiera opinar y compartir. Puede usar el dato de la probabilidad del mercado. Máximo 140 caracteres, sin hashtags.
- Si te piden pregunta y titulo: traduce el evento al español de México. pregunta = una pregunta de sí/no clara con la fecha; titulo = 4 a 8 palabras.
En ningún campo uses las palabras apuesta, apuéstale, jugada ni cuotas, y nunca prometas ganancias.`;

export async function redactar(nombreAnalista: string, b: Borrador): Promise<Narrativa> {
  if (!process.env.ANTHROPIC_API_KEY) return plantilla(b);
  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              tesis: { type: "string" },
              riesgos: { type: "string" },
              descripcion_usuario: { type: "string" },
              gancho_redes: { type: "string" },
              ...(b.traducir ? { pregunta: { type: "string" }, titulo: { type: "string" } } : {}),
            },
            required: ["tesis", "riesgos", "descripcion_usuario", "gancho_redes", ...(b.traducir ? ["pregunta", "titulo"] : [])],
            additionalProperties: false,
          },
        },
      },
      system: SISTEMA,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            analista: nombreAnalista,
            pregunta: b.pregunta,
            titulo: b.titulo,
            traducir_pregunta_y_titulo: !!b.traducir,
            fecha_resolucion: b.fecha_texto,
            fuente_resolucion: b.fuente_resolucion,
            modelo: b.base.modelo,
            probabilidad: b.base.probabilidad,
            intervalo_90: [b.base.prob_baja, b.base.prob_alta],
            parametros: b.base.parametros,
            datos: b.datos,
          }),
        },
      ],
    });
    if (res.stop_reason === "refusal") return plantilla(b);
    const texto = res.content.find((c) => c.type === "text");
    if (!texto || texto.type !== "text") return plantilla(b);
    const out = JSON.parse(texto.text) as Omit<Narrativa, "motor">;
    return { ...out, motor: "claude" };
  } catch (e) {
    console.error("[mesa] narrativa con Claude falló, uso plantilla:", e);
    return plantilla(b);
  }
}
