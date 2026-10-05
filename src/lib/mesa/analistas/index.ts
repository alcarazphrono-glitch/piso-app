// Registro de analistas. Para agregar un mercado: crea su archivo con un
// PluginAnalista, agrégalo aquí y siembra su fila en mesa_analistas.
import type { PluginAnalista } from "./tipos";
import { tasas } from "./tasas";
import { inflacion } from "./inflacion";
import { fx } from "./fx";
import { deportes } from "./deportes";
import { cripto } from "./cripto";
import { prediccion } from "./prediccion";

export const PLUGINS: Record<string, PluginAnalista> = Object.fromEntries(
  [tasas, inflacion, fx, deportes, cripto, prediccion].map((p) => [p.clave, p])
);

export { tasaCetesBanxico } from "./cetes";
export type { AnalistaRow, Borrador, PluginAnalista } from "./tipos";
