"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Configuración -- PISO Core, checkpoint 17-sep-2026. float_pct / carry_pct
// / tasa_cetes_anual ya no son "pendiente de Finanzas, solo lectura" -- son
// el espacio real donde se llenan en cuanto se tenga el número. Tecnología
// no adivina el valor; sí construyó la fórmula que los usa
// (calcular_premio_potencial(), supabase/migrations/0003) para que en
// cuanto se guarden los tres, el Pricing Engine real se active solo, sin
// deploy. Cada guardado queda en parametros_pricing_historial.

interface Parametros {
  ticket_demo_mxn: number;
  multiplicador_demo: number;
  float_pct: number | null;
  carry_pct: number | null;
  tasa_cetes_anual: number | null;
  alpha_emisor: number | null;
  alpha_c2: number | null;
  alpha_c1: number | null;
  actualizado_en: string;
}

interface HistorialFila {
  id: string;
  float_pct: number | null;
  carry_pct: number | null;
  tasa_cetes_anual: number | null;
  ticket_demo_mxn: number | null;
  multiplicador_demo: number | null;
  alpha_emisor: number | null;
  alpha_c2: number | null;
  alpha_c1: number | null;
  cambiado_en: string;
}

export default function AdminConfiguracionPage() {
  const [params, setParams] = useState<Parametros | null>(null);
  const [historial, setHistorial] = useState<HistorialFila[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    const [{ data: p }, { data: h }] = await Promise.all([
      supabase.from("parametros_pricing").select("*").maybeSingle(),
      supabase.from("parametros_pricing_historial").select("*").order("cambiado_en", { ascending: false }).limit(10),
    ]);
    setParams(p as Parametros);
    setHistorial((h as HistorialFila[]) ?? []);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGuardando(true);
    setMensaje(null);
    const form = new FormData(e.currentTarget);

    const leer = (nombre: string) => {
      const v = form.get(nombre);
      return v === "" || v === null ? null : Number(v);
    };
    // Los tres alphas (D4) se capturan en % (ej. 25) pero se guardan como
    // fracción (0.25) -- parametros_pricing_alphas_suman_100 valida contra
    // 1.0, no contra 100, para que la suma sea directa sin errores de
    // redondeo por el factor de 100.
    const leerFraccion = (nombre: string) => {
      const v = leer(nombre);
      return v === null ? null : v / 100;
    };

    const { error } = await supabase
      .from("parametros_pricing")
      .update({
        ticket_demo_mxn: leer("ticket_demo_mxn"),
        multiplicador_demo: leer("multiplicador_demo"),
        float_pct: leer("float_pct"),
        carry_pct: leer("carry_pct"),
        tasa_cetes_anual: leer("tasa_cetes_anual"),
        alpha_emisor: leerFraccion("alpha_emisor"),
        alpha_c2: leerFraccion("alpha_c2"),
        alpha_c1: leerFraccion("alpha_c1"),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", true);

    setGuardando(false);
    setMensaje(error ? `No se pudo guardar: ${error.message}` : "Guardado -- queda en el historial de abajo.");
    if (!error) cargar();
  }

  if (!params) return <p className="text-sm text-neutral-500">Cargando…</p>;

  const motorReal = params.float_pct != null && params.carry_pct != null && params.tasa_cetes_anual != null;

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Configuración</h1>
      <p className="mb-6 text-sm text-neutral-500">Parámetros del modelo de pricing. Editar esto no requiere deploy.</p>

      <div className={`mb-4 max-w-md rounded-md px-3 py-2 text-xs font-medium ${motorReal ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>
        {motorReal
          ? "Motor real activo -- calcular_premio_potencial() está usando float/carry/CETES para los eventos sin premio fijo."
          : "Motor real inactivo -- falta al menos uno de los tres campos de abajo. Mientras tanto, se usa la fórmula placeholder."}
      </div>

      <form onSubmit={guardar} className="mb-6 grid max-w-md grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Ticket demo (MXN)</span>
          <input name="ticket_demo_mxn" type="number" defaultValue={params.ticket_demo_mxn} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Multiplicador placeholder (solo mientras no haya motor real)</span>
          <input name="multiplicador_demo" type="number" step="0.01" defaultValue={params.multiplicador_demo} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>

        <div className="mt-2 border-t border-neutral-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Motor real -- llenar solo con cifra confirmada por Finanzas</p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Float % (ej. 25 = 25% del rendimiento financia el pool)</span>
          <input name="float_pct" type="number" step="0.01" defaultValue={params.float_pct ?? ""} placeholder="sin definir" className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Carry % (ej. 12 = PISO retiene 12% del premio pagado)</span>
          <input name="carry_pct" type="number" step="0.01" defaultValue={params.carry_pct ?? ""} placeholder="sin definir" className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Tasa CETES anual % (ej. 10.5 = 10.5% anual)</span>
          <input name="tasa_cetes_anual" type="number" step="0.01" defaultValue={params.tasa_cetes_anual ?? ""} placeholder="sin definir" className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>

        <div className="mt-2 border-t border-neutral-100 pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Tres alphas (D4, memo Behavioral 17-sep) -- deben sumar 100%</p>
          <p className="mb-2 text-xs text-neutral-500">
            OJO: esto es una descomposición DISTINTA del rendimiento de CETES que float/carry de arriba -- Finanzas y
            Behavioral todavía no confirman cuál de las dos manda. La fórmula que activa premios en vivo sigue siendo
            float/carry/CETES; estos tres campos se guardan reales y versionados, pero no sustituyen nada todavía.
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Alpha emisor % (comisión PISO -- esperado 25)</span>
          <input name="alpha_emisor" type="number" step="0.01" defaultValue={params.alpha_emisor != null ? params.alpha_emisor * 100 : ""} placeholder="sin definir" className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Alpha C2 % (pool de premios -- esperado 65)</span>
          <input name="alpha_c2" type="number" step="0.01" defaultValue={params.alpha_c2 != null ? params.alpha_c2 * 100 : ""} placeholder="sin definir" className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Alpha C1 % (reserva de riesgo -- esperado 10, fondea el kill switch D5)</span>
          <input name="alpha_c1" type="number" step="0.01" defaultValue={params.alpha_c1 != null ? params.alpha_c1 * 100 : ""} placeholder="sin definir" className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>

        <button type="submit" disabled={guardando} className="mt-2 w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {mensaje && <p className="text-xs text-neutral-600">{mensaje}</p>}
      </form>

      <div className="mb-6 max-w-md rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-xs text-amber-800">
        <p className="font-medium">Racha -- regla de reset (D6): sin construir, a propósito.</p>
        <p className="mt-1">
          perfiles.racha_actual (migración 0005) ya es un contador real y atómico -- sube en cada posición que se
          abre, gane o pierda. Lo que NO existe es un job que la resetee tras 7 días sin actividad: el memo de
          Behavioral marca esa regla como "propuesta, no consenso todavía". No se hardcodea aquí hasta que
          Behavioral/Producto la confirmen -- mismo criterio que VaR/CVaR en Riesgo.
        </p>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Historial de cambios</h2>
      <div className="max-w-md overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {historial.length === 0 ? (
          <p className="p-4 text-sm text-neutral-400">Sin cambios registrados todavía -- esto se llena la primera vez que alguien guarde.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Cuándo</th>
                <th className="px-3 py-2 font-medium">Float</th>
                <th className="px-3 py-2 font-medium">Carry</th>
                <th className="px-3 py-2 font-medium">CETES</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-3 py-2">{new Date(h.cambiado_en).toLocaleString("es-MX")}</td>
                  <td className="px-3 py-2">{h.float_pct ?? "—"}</td>
                  <td className="px-3 py-2">{h.carry_pct ?? "—"}</td>
                  <td className="px-3 py-2">{h.tasa_cetes_anual ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t border-neutral-100 p-3 text-xs text-neutral-400">
          Cada fila es el valor que tenía justo ANTES de un cambio -- así se puede ver qué se modificó y cuándo, no
          solo el valor actual.
        </p>
      </div>
    </div>
  );
}
