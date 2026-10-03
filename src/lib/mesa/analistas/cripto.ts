// Cripto -- ¿Bitcoin/Ether cierra arriba de K al final del nivel? Base:
// volatilidad implícita de opciones Deribit (el derivado real).
import { brownianoImplicito } from "../estocastico";
import { deribitCripto, SinDatos, URL_DERIBIT } from "../fuentes";
import { DIA, DIAS_REVISION, elegirNivel, fechaLarga } from "./comun";
import type { PluginAnalista, AnalistaRow, Borrador } from "./tipos";
import type { ProductoMesa } from "../payoff";

const NOMBRE: Record<string, string> = { BTC: "Bitcoin", ETH: "Ether" };
// Escalón del strike: números redondos que se leen bien en redes.
const PASO: Record<string, number> = { BTC: 5000, ETH: 250 };

async function proponer(a: AnalistaRow, productos: ProductoMesa[]): Promise<Borrador[]> {
  const monedas = ((a.config.monedas as string[]) ?? ["BTC", "ETH"]).filter((m): m is "BTC" | "ETH" => m === "BTC" || m === "ETH");
  const nivel = productos.find((p) => p.clave === ((a.config.nivel as string) || "crecimiento")) ?? productos[0];
  if (!nivel) throw new SinDatos("no hay niveles activos");

  // Cierre: precio índice de Deribit a las 08:00 UTC (hora de vencimiento de
  // sus opciones), fin del nivel + días de revisión.
  const fecha = new Date(Date.now() + (nivel.dias_resolucion + DIAS_REVISION) * DIA);
  fecha.setUTCHours(8, 0, 0, 0);
  const dias = (fecha.getTime() - Date.now()) / DIA;
  const dia = fechaLarga(fecha);

  return Promise.all(
    monedas.map(async (m) => {
      const d = await deribitCripto(m);
      const strike = Math.ceil(d.spot / PASO[m]) * PASO[m];
      const base = brownianoImplicito(d.spot, strike, dias, d.volImplicita, d.volHistorica);
      const strikeTxt = strike.toLocaleString("en-US");
      return {
        titulo: `${NOMBRE[m]} arriba de $${strikeTxt} USD (${dia})`,
        pregunta: `¿${NOMBRE[m]} cierra arriba de $${strikeTxt} dólares el ${dia}?`,
        categoria: "cripto",
        fuente_resolucion: `Deribit -- índice ${m}/USD a las 08:00 UTC`,
        fecha_resolucion: fecha,
        fecha_texto: `Se resuelve el ${dia}`,
        base,
        datos: { fuente: URL_DERIBIT, moneda: m, spot: d.spot, vol_implicita_dvol: d.volImplicita, vol_historica: d.volHistorica },
        producto_sugerido: elegirNivel(fecha, productos),
        ref_externa: `${m}-${strike}-${fecha.toISOString().slice(0, 10)}`,
      } satisfies Borrador;
    })
  );
}

export const cripto: PluginAnalista = {
  clave: "cripto",
  riesgoLegal: {
    nivel: "medio",
    nota: "Referencia a criptoactivos: CNBV/Banxico restringen ofrecerlos al público. Aquí solo se usa el precio como evento, no se opera cripto. Validar redacción con Legal.",
  },
  proponer,
};
