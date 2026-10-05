// Arma el Escenario de economía desde la base. Úsalo con el cliente admin
// (consola) o con el de usuario (app): sin permiso de operador,
// economia_parametros no se lee y se usa parametros_premio_publicos(), que
// solo trae lo necesario para el premio; el resto queda en defaults marcados.
import type { SupabaseClient } from "@supabase/supabase-js";
import { NIVELES, type Escenario, type Nivel, type ProductoEco, type TramoCarry } from "./modelo";

// Acuerdos vigentes si la base no tiene el dato (memoria del proyecto).
const CETES_SUPUESTO = 0.10;
const ALPHA_EM_SUPUESTO = 0.25;

export interface EscenarioCargado { escenario: Escenario; supuestos: string[] }

export async function cargarEscenario(db: SupabaseClient): Promise<EscenarioCargado> {
  const supuestos: string[] = [];
  const [{ data: productos, error: e1 }, { data: tramos, error: e2 }, { data: pricing }, { data: eco }] = await Promise.all([
    db.from("productos").select("clave, nombre, precio, gente_requerida, dias_resolucion, alpha_em, cuota_evento"),
    db.from("producto_carry_tramos").select("producto_clave, orden, premio_hasta, carry_pct"),
    db.from("parametros_pricing").select("tasa_cetes_anual").maybeSingle(),
    db.from("economia_parametros").select("*").maybeSingle(),
  ]);
  if (e1 || e2) throw e1 || e2;

  let publicos: Record<string, number> | null = null;
  if (!eco) {
    const { data } = await db.rpc("parametros_premio_publicos");
    publicos = (Array.isArray(data) ? data[0] : data) ?? null;
    supuestos.push("sin permiso de operador: CAC, churn y costos con valores por defecto");
  }
  const v = (k: string, d: number) => Number((eco as Record<string, unknown> | null)?.[k] ?? publicos?.[k] ?? d);

  const tasa = (pricing as { tasa_cetes_anual: number | null } | null)?.tasa_cetes_anual;
  if (tasa == null) supuestos.push(`CETES ${CETES_SUPUESTO * 100}% (supuesto, falta en parametros_pricing)`);

  const mapa = {} as Record<Nivel, ProductoEco>;
  for (const n of NIVELES) {
    const p = (productos ?? []).find((x: { clave: string }) => x.clave === n) as (Omit<ProductoEco, "alpha_em" | "cuota_evento"> & { alpha_em: number | null; cuota_evento: number | null }) | undefined;
    if (!p) throw new Error(`falta el producto ${n}`);
    if (p.alpha_em == null) supuestos.push(`${n}: alpha_em ${ALPHA_EM_SUPUESTO * 100}% (supuesto)`);
    mapa[n] = { ...p, alpha_em: Number(p.alpha_em ?? ALPHA_EM_SUPUESTO), cuota_evento: Number(p.cuota_evento ?? 0),
      precio: Number(p.precio), gente_requerida: Number(p.gente_requerida), dias_resolucion: Number(p.dias_resolucion) };
  }

  return {
    supuestos,
    escenario: {
      productos: mapa,
      tramos: (tramos ?? []) as TramoCarry[],
      fijas: {
        cetes: tasa != null ? Number(tasa) / 100 : CETES_SUPUESTO,
        spread: v("spread_reporto", 0), iva: v("iva", 0.16), isrPremio: v("isr_premio", 0.07),
        aprovechamiento: v("aprovechamiento_segob", 0.01), custodia: v("custodia_anual", 0.0015),
        costoPago: v("costo_pago_mxn", 4), infra: v("infra_usuario_ano_mxn", 6), kyc: v("kyc_mxn", 12),
        fijoMes: v("costos_fijos_mes_mxn", 265000),
      },
      palancas: {
        alphaC1: v("alpha_c1", 0), cuotaAlPremio: v("cuota_al_premio", 0), saldo: v("saldo_entre_ciclos", 0),
        eventosMes: v("eventos_por_usuario_mes", 1), cac: v("cac_mxn", 50), bono: v("bono_bienvenida_mxn", 0),
        churn: v("churn_mensual", 0.06), usuarios: v("usuarios_objetivo", 50000),
        mezcla: { entrada: v("mezcla_entrada", 0.65), crecimiento: v("mezcla_crecimiento", 0.25), elite: v("mezcla_elite", 0.1) },
      },
      umbral: {
        multiplo: v("umbral_multiplo_premio", 4), espera: v("umbral_espera_dias", 7),
        costoMes: v("umbral_costo_mes_mxn", 100), costoAno: v("umbral_costo_ano_pct", 0.25),
      },
    },
  };
}
