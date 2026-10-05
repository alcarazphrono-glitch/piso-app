import { serieBanxico, SERIES_BANXICO } from "../fuentes";
import { DIA } from "./comun";

export async function tasaCetesBanxico(): Promise<number | null> {
  try {
    const s = await serieBanxico(SERIES_BANXICO.cetes28, new Date(Date.now() - 60 * DIA));
    return s[s.length - 1].valor;
  } catch {
    return null;
  }
}
