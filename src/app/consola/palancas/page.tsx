"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cargarEscenario } from "@/lib/economia/cargar";
import { calcular, NIVELES, type Escenario, type Nivel } from "@/lib/economia/modelo";

// Palancas -- mueve cuota, días, N, reparto y crecimiento, mira en vivo
// cuánto gana PISO por usuario y si el cliente conserva el valor mínimo, y
// guarda en la base. Un solo cálculo: calcular() de src/lib/economia (PR #4).
// Al guardar: economia_parametros (con historial, 0014), productos y, si
// cambió CETES, parametros_pricing (con historial, 0003).

const NOMBRE: Record<Nivel, string> = { entrada: "Entrada", crecimiento: "Crecimiento", elite: "Elite" };

type Formato = "peso" | "peso2" | "pct" | "pct1" | "dias" | "num" | "x" | "ev";
interface Control {
  ruta: string;
  label: string;
  min: number;
  max: number;
  step: number;
  f: Formato;
  hint?: string;
}

const peso = (v: number, d = 0) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("es-MX", { maximumFractionDigits: d, minimumFractionDigits: d })}`;
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const fmt = (v: number, f: Formato) =>
  ({ peso: peso(v), peso2: peso(v, 2), pct: pct(v), pct1: pct(v, 1), dias: `${v} días`, num: Math.round(v).toLocaleString("es-MX"), x: `${v}×`, ev: `${v} al mes` })[f];

const GRUPOS: { titulo: string; tipo: string; abierto: boolean; controles: Control[] }[] = [
  {
    titulo: "Producto por nivel",
    tipo: "Esto lo decide PISO",
    abierto: true,
    controles: NIVELES.flatMap((n) => [
      { ruta: `productos.${n}.cuota_evento`, label: `${NOMBRE[n]}: cuota por evento`, min: 0, max: 150, step: 5, f: "peso" as Formato, hint: "Precio con IVA. Requiere visto bueno de Legal." },
      { ruta: `productos.${n}.dias_resolucion`, label: `${NOMBRE[n]}: días del ciclo`, min: 5, max: 35, step: 1, f: "dias" as Formato },
      {
        ruta: `productos.${n}.gente_requerida`,
        label: `${NOMBRE[n]}: lugares (N)`,
        min: n === "elite" ? 100 : 500,
        max: n === "entrada" ? 10000 : n === "crecimiento" ? 5000 : 2000,
        step: 100,
        f: "num" as Formato,
      },
    ]),
  },
  {
    titulo: "Reparto del dinero",
    tipo: "Esto lo decide PISO",
    abierto: true,
    controles: [
      { ruta: "alpha_em", label: "PISO se queda del rendimiento (alpha_em)", min: 0.1, max: 0.4, step: 0.01, f: "pct", hint: "Acordado: 25%. Aplica a los tres niveles." },
      { ruta: "palancas.alphaC1", label: "Premio por antigüedad (alpha_c1)", min: 0, max: 0.15, step: 0.01, f: "pct", hint: "Choque abierto: 0% contra 10%." },
      { ruta: "palancas.cuotaAlPremio", label: "Parte de la cuota que va al premio", min: 0, max: 1, step: 0.05, f: "pct" },
      { ruta: "palancas.saldo", label: "Dinero que se queda entre eventos", min: 0, max: 1, step: 0.05, f: "pct", hint: "Revisar con Legal." },
    ],
  },
  {
    titulo: "Crecimiento y usuarios",
    tipo: "Esto lo decide PISO",
    abierto: false,
    controles: [
      { ruta: "palancas.cac", label: "Costo por conseguir un usuario (CAC)", min: 0, max: 300, step: 5, f: "peso" },
      { ruta: "palancas.bono", label: "Bono de bienvenida", min: 0, max: 200, step: 5, f: "peso" },
      { ruta: "palancas.churn", label: "Usuarios que se van al mes", min: 0.02, max: 0.2, step: 0.005, f: "pct1" },
      { ruta: "palancas.eventosMes", label: "Eventos por usuario", min: 0.5, max: 4, step: 0.5, f: "ev", hint: "Supuesto: Behavioral debe validarlo." },
      { ruta: "palancas.usuarios", label: "Usuarios activos", min: 5000, max: 200000, step: 5000, f: "num" },
      { ruta: "palancas.mezcla.entrada", label: "Mezcla: Entrada", min: 0.2, max: 0.9, step: 0.05, f: "pct" },
      { ruta: "palancas.mezcla.crecimiento", label: "Mezcla: Crecimiento", min: 0.05, max: 0.6, step: 0.05, f: "pct", hint: "Elite es lo que resta." },
    ],
  },
  {
    titulo: "Valor mínimo para el cliente",
    tipo: "Si algo cae debajo, se marca en rojo",
    abierto: false,
    controles: [
      { ruta: "umbral.multiplo", label: "Premio mínimo, veces el boleto", min: 1, max: 20, step: 0.5, f: "x" },
      { ruta: "umbral.espera", label: "Espera máxima para llenar", min: 1, max: 30, step: 1, f: "dias" },
      { ruta: "umbral.costoMes", label: "Costo máximo para el cliente al mes", min: 20, max: 300, step: 10, f: "peso" },
      { ruta: "umbral.costoAno", label: "Costo máximo al año, % del boleto", min: 0.05, max: 0.6, step: 0.01, f: "pct" },
    ],
  },
  {
    titulo: "Lo que no se mueve",
    tipo: "No dependen de PISO: mercado, impuestos, regulación, proveedores",
    abierto: false,
    controles: [
      { ruta: "fijas.cetes", label: "CETES", min: 0.04, max: 0.12, step: 0.0025, f: "pct1", hint: "Se guarda en parametros_pricing." },
      { ruta: "fijas.spread", label: "Reporto paga menos que CETES 28", min: 0, max: 0.01, step: 0.0005, f: "pct1" },
      { ruta: "fijas.iva", label: "IVA sobre la cuota", min: 0, max: 0.16, step: 0.01, f: "pct" },
      { ruta: "fijas.isrPremio", label: "ISR a premios de sorteo", min: 0, max: 0.1, step: 0.005, f: "pct1" },
      { ruta: "fijas.aprovechamiento", label: "Pago por permiso SEGOB (sobre cuotas)", min: 0, max: 0.05, step: 0.005, f: "pct1", hint: "Supuesto, confirmar con Legal." },
      { ruta: "fijas.custodia", label: "Custodio regulado (anual)", min: 0, max: 0.005, step: 0.0005, f: "pct1" },
      { ruta: "fijas.costoPago", label: "Costo por movimiento SPEI", min: 0, max: 10, step: 0.5, f: "peso2" },
      { ruta: "fijas.infra", label: "Infra por usuario al año", min: 0, max: 30, step: 1, f: "peso" },
      { ruta: "fijas.kyc", label: "Verificación de identidad (KYC)", min: 0, max: 50, step: 1, f: "peso" },
      { ruta: "fijas.fijoMes", label: "Costos fijos al mes", min: 100000, max: 800000, step: 5000, f: "peso", hint: "Estimado del CFO." },
    ],
  },
];

// Columnas de economia_parametros (0014) para cada campo del Escenario.
const COLUMNAS: Record<string, string> = {
  "palancas.alphaC1": "alpha_c1",
  "palancas.cuotaAlPremio": "cuota_al_premio",
  "palancas.saldo": "saldo_entre_ciclos",
  "palancas.eventosMes": "eventos_por_usuario_mes",
  "palancas.cac": "cac_mxn",
  "palancas.bono": "bono_bienvenida_mxn",
  "palancas.churn": "churn_mensual",
  "palancas.usuarios": "usuarios_objetivo",
  "palancas.mezcla.entrada": "mezcla_entrada",
  "palancas.mezcla.crecimiento": "mezcla_crecimiento",
  "palancas.mezcla.elite": "mezcla_elite",
  "fijas.spread": "spread_reporto",
  "fijas.iva": "iva",
  "fijas.isrPremio": "isr_premio",
  "fijas.aprovechamiento": "aprovechamiento_segob",
  "fijas.custodia": "custodia_anual",
  "fijas.costoPago": "costo_pago_mxn",
  "fijas.infra": "infra_usuario_ano_mxn",
  "fijas.kyc": "kyc_mxn",
  "fijas.fijoMes": "costos_fijos_mes_mxn",
  "umbral.multiplo": "umbral_multiplo_premio",
  "umbral.espera": "umbral_espera_dias",
  "umbral.costoMes": "umbral_costo_mes_mxn",
  "umbral.costoAno": "umbral_costo_ano_pct",
};

const clonar = (e: Escenario): Escenario => JSON.parse(JSON.stringify(e));

function leer(e: Escenario, ruta: string): number {
  if (ruta === "alpha_em") return e.productos.entrada.alpha_em;
  return ruta.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)[k], e) as number;
}

function escribir(e: Escenario, ruta: string, v: number) {
  if (ruta === "alpha_em") {
    for (const n of NIVELES) e.productos[n].alpha_em = v;
    return;
  }
  const ks = ruta.split(".");
  const ultimo = ks.pop()!;
  (ks.reduce<unknown>((a, k) => (a as Record<string, unknown>)[k], e) as Record<string, number>)[ultimo] = v;
  if (ruta.startsWith("palancas.mezcla.") && ultimo !== "elite") {
    const m = e.palancas.mezcla;
    const otro = ultimo === "entrada" ? "crecimiento" : "entrada";
    m[ultimo as Nivel] = Math.min(v, 0.95 - m[otro]);
    m.elite = +(1 - m.entrada - m.crecimiento).toFixed(2);
  }
}

export default function PalancasPage() {
  const [original, setOriginal] = useState<Escenario | null>(null);
  const [esc, setEsc] = useState<Escenario | null>(null);
  const [supuestos, setSupuestos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    try {
      const { escenario, supuestos } = await cargarEscenario(supabase);
      setOriginal(clonar(escenario));
      setEsc(clonar(escenario));
      setSupuestos(supuestos);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const r = useMemo(() => (esc ? calcular(esc) : null), [esc]);
  const rOriginal = useMemo(() => (original ? calcular(original) : null), [original]);

  const cambios = useMemo(() => {
    if (!esc || !original) return [] as string[];
    return GRUPOS.flatMap((g) => g.controles.map((c) => c.ruta)).filter((ruta) => leer(esc, ruta) !== leer(original, ruta));
  }, [esc, original]);

  if (error) return <p className="text-sm text-red-600">No se pudo cargar el modelo: {error}. ¿Ya corriste la migración 0014?</p>;
  if (!esc || !r || !original) return <p className="text-sm text-neutral-500">Cargando…</p>;

  function mover(ruta: string, v: number) {
    setEsc((prev) => {
      const e = clonar(prev!);
      escribir(e, ruta, v);
      return e;
    });
  }

  async function guardar() {
    if (!esc || !original) return;
    setGuardando(true);
    setMensaje(null);
    const errores: string[] = [];

    const eco: Record<string, number> = {};
    for (const [ruta, col] of Object.entries(COLUMNAS)) if (leer(esc, ruta) !== leer(original, ruta)) eco[col] = leer(esc, ruta);
    if (Object.keys(eco).length) {
      const { error } = await supabase.from("economia_parametros").update(eco).eq("id", true);
      if (error) errores.push(`palancas: ${error.message}`);
    }

    for (const n of NIVELES) {
      const a = original.productos[n];
      const b = esc.productos[n];
      const upd: Record<string, number> = {};
      for (const k of ["cuota_evento", "dias_resolucion", "gente_requerida", "alpha_em"] as const) if (a[k] !== b[k]) upd[k] = b[k];
      if (Object.keys(upd).length) {
        const { error } = await supabase.from("productos").update(upd).eq("clave", n);
        if (error) errores.push(`${NOMBRE[n]}: ${error.message}`);
      }
    }

    if (esc.fijas.cetes !== original.fijas.cetes) {
      const { error } = await supabase.from("parametros_pricing").update({ tasa_cetes_anual: +(esc.fijas.cetes * 100).toFixed(4) }).eq("id", true);
      if (error) errores.push(`CETES: ${error.message}`);
    }

    setGuardando(false);
    setMensaje(errores.length ? { tipo: "error", texto: errores.join(" · ") } : { tipo: "ok", texto: "Guardado. La app, la Mesa y el Resumen ya usan estos números." });
    await cargar();
  }

  const fallan = NIVELES.filter((n) => !r.niveles[n].ok).map((n) => NOMBRE[n]);
  const esNegocio = r.contrib > 0 && r.ltvCac >= 3;
  const estado =
    r.contrib <= 0
      ? "Cada usuario cuesta más de lo que deja."
      : r.ltvCac < 3
        ? `Gana por usuario, pero recuperar lo que cuesta conseguirlo es lento (LTV/CAC ${r.ltvCac.toFixed(1)}, se busca 3 o más).`
        : `Es negocio: cada usuario deja ${r.ltvCac.toFixed(1)} veces lo que cuesta conseguirlo.`;
  const tocaAbiertos = cambios.some((c) => /gente_requerida|cuota_evento|alpha_em|cuotaAlPremio|alphaC1|fijas\.cetes|fijas\.spread/.test(c));

  // Sensibilidad: una palanca a la vez desde donde estás.
  const pruebas: [string, (e: Escenario) => void][] = [
    ["Cuota Entrada +$5", (e) => (e.productos.entrada.cuota_evento += 5)],
    ["Cuota Crecimiento +$10", (e) => (e.productos.crecimiento.cuota_evento += 10)],
    ["Cuota Elite +$10", (e) => (e.productos.elite.cuota_evento += 10)],
    ["10 puntos de Entrada a Crecimiento", (e) => ((e.palancas.mezcla.entrada -= 0.1), (e.palancas.mezcla.crecimiento += 0.1))],
    ["25 puntos más de dinero que se queda", (e) => (e.palancas.saldo = Math.min(1, e.palancas.saldo + 0.25))],
    ["25 puntos más de cuota al premio", (e) => (e.palancas.cuotaAlPremio = Math.min(1, e.palancas.cuotaAlPremio + 0.25))],
    ["Todos los ciclos a 28 días", (e) => NIVELES.forEach((n) => (e.productos[n].dias_resolucion = 28))],
    ["CETES −1 punto", (e) => (e.fijas.cetes -= 0.01)],
  ];
  const sens = pruebas
    .map(([l, fn]) => {
      const e = clonar(esc);
      fn(e);
      const rr = calcular(e);
      return { l, d: rr.contrib - r.contrib, rompe: r.ok && !rr.ok };
    })
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  const filas: [string, (n: Nivel) => string, ((n: Nivel) => boolean)?][] = [
    ["Boleto", (n) => peso(esc.productos[n].precio)],
    ["Cuota por evento", (n) => peso(esc.productos[n].cuota_evento)],
    ["Premio que le llega", (n) => peso(r.niveles[n].premioEnMano)],
    ["Veces su boleto", (n) => `${r.niveles[n].multiplo.toFixed(1)}×`, (n) => r.niveles[n].pasa.multiplo],
    ["Probabilidad de ganar", (n) => `1 en ${esc.productos[n].gente_requerida.toLocaleString("es-MX")}`],
    ["Espera para llenar", (n) => `${r.niveles[n].espera.toFixed(1)} días`, (n) => r.niveles[n].pasa.espera],
    ["Le cuesta jugar, al mes", (n) => peso(r.niveles[n].costoNetoMes), (n) => r.niveles[n].pasa.costo],
    ["Ganancia PISO por usuario/año", (n) => peso(r.niveles[n].contrib)],
  ];

  const maxPos = Math.max(1, ...NIVELES.map((n) => { const x = r.niveles[n]; return x.ingRend + x.ingCarry + Math.max(0, x.ingCuota) + x.ingSaldo; }));
  const maxNeg = Math.max(1, ...NIVELES.map((n) => r.niveles[n].costoVar + Math.max(0, -r.niveles[n].ingCuota)));
  const span = maxPos + maxNeg;
  const cero = (maxNeg / span) * 100;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Palancas</h1>
          <p className="text-sm text-neutral-500">Mueve las palancas y mira cuánto gana PISO por usuario sin que el cliente pierda lo que lo hace jugar.</p>
        </div>
        <div className="flex items-center gap-2">
          {cambios.length > 0 && (
            <button onClick={() => setEsc(clonar(original))} className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm">
              Deshacer
            </button>
          )}
          <button
            onClick={guardar}
            disabled={cambios.length === 0 || guardando}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {guardando ? "Guardando…" : cambios.length ? `Guardar ${cambios.length} cambio(s)` : "Sin cambios"}
          </button>
        </div>
      </div>

      {mensaje && (
        <div className={`mb-4 rounded-md border px-4 py-2.5 text-sm ${mensaje.tipo === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {mensaje.texto}
        </div>
      )}
      {tocaAbiertos && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Ojo: este cambio también mueve el premio de los ciclos que ya están abiertos, porque el premio se calcula en vivo con estos parámetros.
        </div>
      )}
      {supuestos.length > 0 && <p className="mb-4 text-xs text-amber-700">Supuestos: {supuestos.join(" · ")}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3">
          {GRUPOS.map((g) => (
            <details key={g.titulo} open={g.abierto} className="rounded-lg border border-neutral-200 bg-white px-4 py-2">
              <summary className="cursor-pointer text-sm font-semibold">{g.titulo}</summary>
              <p className="mb-1 mt-1 text-[10px] uppercase tracking-wider text-neutral-400">{g.tipo}</p>
              {g.controles.map((c) => {
                const v = leer(esc, c.ruta);
                const cambiado = v !== leer(original, c.ruta);
                return (
                  <div key={c.ruta} className="border-t border-neutral-100 py-2 first-of-type:border-0">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <label htmlFor={c.ruta}>{c.label}</label>
                      <span className={`font-mono tabular-nums ${cambiado ? "font-semibold text-emerald-700" : ""}`}>{fmt(v, c.f)}</span>
                    </div>
                    <input
                      id={c.ruta}
                      type="range"
                      min={c.min}
                      max={c.max}
                      step={c.step}
                      value={v}
                      onChange={(e) => mover(c.ruta, parseFloat(e.target.value))}
                      className="w-full accent-emerald-700"
                    />
                    {c.hint && <p className="text-[11px] text-neutral-400">{c.hint}</p>}
                  </div>
                );
              })}
            </details>
          ))}
          <p className="text-[11px] text-neutral-400">El carry por tramo se edita en Niveles.</p>
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm font-medium">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!esNegocio ? "bg-red-600" : fallan.length ? "bg-amber-500" : "bg-emerald-600"}`} />
            <span>
              {estado} {fallan.length ? `El valor para el cliente no pasa en ${fallan.join(", ")}.` : "El cliente conserva el valor mínimo en los tres niveles."}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 md:grid-cols-4">
            {[
              ["Ganancia por usuario al año", peso(r.contrib), rOriginal ? `antes ${peso(rOriginal.contrib)}` : "", r.contrib < 0],
              ["LTV", peso(r.ltv), `${(1 / esc.palancas.churn).toFixed(0)} meses de vida`, r.ltv < 0],
              ["Costo de conseguirlo", peso(r.adquisicion), "CAC + bono + KYC", false],
              ["LTV / CAC", isFinite(r.ltvCac) ? `${r.ltvCac.toFixed(1)}×` : "—", "3× o más es sano", r.ltvCac < 3],
              ["Recupera el CAC en", isFinite(r.payback) && r.payback < 600 ? `${r.payback.toFixed(1)} meses` : "nunca", "", r.payback > 12],
              ["Usuarios para no perder", isFinite(r.breakeven) && r.breakeven < 5e6 ? Math.round(r.breakeven).toLocaleString("es-MX") : "no alcanza", "cubre costos fijos", r.breakeven > esc.palancas.usuarios],
              [`Utilidad al mes con ${esc.palancas.usuarios.toLocaleString("es-MX")}`, peso(r.utilidadMes), "ya repone a los que se van", r.utilidadMes < 0],
              ["Ingreso por usuario al año", peso(r.ingreso), `costos ${peso(r.costoVar)}`, false],
            ].map(([l, v, n, mal]) => (
              <div key={l as string} className="bg-white px-4 py-3">
                <p className="text-xs text-neutral-500">{l}</p>
                <p className={`font-mono text-lg font-semibold tabular-nums ${mal ? "text-red-600" : ""}`}>{v}</p>
                {n && <p className="text-[11px] text-neutral-400">{n}</p>}
              </div>
            ))}
          </div>

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Lo que ve el cliente</h2>
            <p className="mb-2 text-xs text-neutral-500">Premio después de carry e ISR, probabilidad, espera y cuánto le cuesta jugar contra dejar el dinero en CETES. En rojo lo que rompe el valor mínimo.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm tabular-nums">
                <thead className="text-xs text-neutral-400">
                  <tr className="text-right">
                    <th />
                    {NIVELES.map((n) => (
                      <th key={n} className="px-2 py-1 font-normal">
                        {NOMBRE[n]}{" "}
                        <span className={`ml-1 rounded-full px-1.5 text-[10px] ${r.niveles[n].ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                          {r.niveles[n].ok ? "pasa" : "no pasa"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map(([l, f, ok]) => (
                    <tr key={l} className="border-t border-neutral-100 text-right">
                      <td className="py-1.5 text-left font-medium">{l}</td>
                      {NIVELES.map((n) => (
                        <td key={n} className={`px-2 font-mono ${ok && !ok(n) ? "font-semibold text-red-600" : ""}`}>
                          {f(n)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold">A dónde va cada peso, por usuario al año</h2>
            <p className="mb-3 text-xs text-neutral-500">Ingreso por fuente a la derecha del cero, costos variables a la izquierda. El número es lo que queda.</p>
            <div className="flex flex-col gap-2">
              {NIVELES.map((n) => {
                const x = r.niveles[n];
                let izq = cero;
                const segs = [
                  [x.ingRend, "bg-emerald-700"],
                  [x.ingCarry, "bg-emerald-400"],
                  [Math.max(0, x.ingCuota), "bg-blue-700"],
                  [x.ingSaldo, "bg-blue-300"],
                ].map(([v, c], i) => {
                  const w = ((v as number) / span) * 100;
                  const el = <div key={i} className={`absolute inset-y-0 ${c}`} style={{ left: `${izq}%`, width: `${w}%` }} />;
                  izq += w;
                  return el;
                });
                const wc = (x.costoVar / span) * 100;
                return (
                  <div key={n} className="grid grid-cols-[90px_minmax(0,1fr)_84px] items-center gap-2 text-sm">
                    <span className="font-medium">{NOMBRE[n]}</span>
                    <div className="relative h-5 overflow-hidden rounded bg-neutral-100">
                      {segs}
                      <div className="absolute inset-y-0 bg-red-500" style={{ left: `${cero - wc}%`, width: `${wc}%` }} />
                      <div className="absolute -inset-y-1 w-px bg-neutral-900" style={{ left: `${cero}%` }} />
                    </div>
                    <span className={`text-right font-mono tabular-nums ${x.contrib < 0 ? "text-red-600" : ""}`}>{peso(x.contrib)}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-neutral-500">
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-700" />Rendimiento (alpha_em)</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />Carry</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-700" />Cuota</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-300" />Saldo entre ciclos</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />Pagos, custodia, infra</span>
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Qué mueve más la aguja</h2>
            <p className="mb-2 text-xs text-neutral-500">Ganancia por usuario al año si mueves una sola palanca desde donde estás.</p>
            <ul className="flex flex-col gap-1 text-sm">
              {sens.map((s) => (
                <li key={s.l}>
                  {s.l}:{" "}
                  <b className={`font-mono ${s.d < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {s.d >= 0 ? "+" : ""}
                    {peso(s.d)}
                  </b>
                  {s.rompe && <span className="ml-2 rounded-full bg-red-100 px-1.5 text-[10px] text-red-700">rompe valor</span>}
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
