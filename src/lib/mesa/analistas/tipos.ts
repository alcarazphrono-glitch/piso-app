// Mesa de derivados -- contrato de un analista. Agregar un mercado nuevo =
// un archivo en esta carpeta que exporte un PluginAnalista, una línea en
// index.ts y una fila en mesa_analistas (clave igual). Nada más.

import type { BaseEstocastica } from "../estocastico";
import type { ProductoMesa } from "../payoff";

export interface AnalistaRow {
  clave: string;
  nombre: string;
  mercado: string;
  config: Record<string, unknown>;
}

export type NivelRiesgoLegal = "bajo" | "medio" | "alto";

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
  // Id del contrato/partido en la fuente, para no repetir propuestas.
  ref_externa?: string;
  // Si el evento viene de una fuente en inglés, Claude redacta pregunta y
  // título en español (la pregunta original queda en datos).
  traducir?: boolean;
  // Sobrescribe el riesgo legal del plugin para este evento en particular.
  riesgo_legal?: { nivel: NivelRiesgoLegal; nota: string };
}

export interface PluginAnalista {
  clave: string;
  // Riesgo legal del tipo de evento. 'alto' obliga a aceptarlo al publicar.
  riesgoLegal: { nivel: NivelRiesgoLegal; nota: string };
  // Puede regresar varios borradores (p. ej. varios partidos). Lanza
  // SinDatos si no hay de dónde leer: nunca inventa una serie.
  proponer(a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador[]>;
}
