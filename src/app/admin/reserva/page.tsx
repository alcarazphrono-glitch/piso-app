"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Reserva de capital + kill-switch GLOBAL (migración 0010, sección 5 del
// memo de Finanzas). Distinto del kill switch por evento de D5
// (/admin/riesgo): este opera sobre TODOS los ciclos activos de TODOS
// los niveles a la vez, contra una reserva REALMENTE fondeada por
// Tesorería -- mientras reserva_fondeada esté vacío, el kill switch
// global queda inactivo a propósito (ver comentario en la migración).

interface ReservaConfig {
  factor_premios: number;
  factor_liquidez_pct: number;
  kill_switch_umbral_pct: number;
  reserva_fondeada: number | null;
}

interface Exposicion {
  capital_en_pool: number;
  premios_en_riesgo: number;
  reserva_minima: number;
  reserva_fondeada: number | null;
  kill_switch_activo: boolean;
}

export default function AdminReservaPage() {
  const [config, setConfig] = useState<ReservaConfig | null>(null);
  const [exposicion, setExposicion] = useState<Exposicion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const [{ data: cfg, error: e1 }, { data: exp, error: e2 }] = await Promise.all([
      supabase.from("reserva_config").select("*").maybeSingle(),
      supabase.rpc("calcular_exposicion_global").maybeSingle(),
    ]);
    if (!e1) setConfig(cfg as ReservaConfig);
    if (!e2) setExposicion(exp as Exposicion);
    if (e1 || e2) setMensaje((e1 || e2)?.message ?? "Error cargando la reserva.");
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMensaje(null);
    const form = new FormData(e.currentTarget);
    const fondeadaRaw = form.get("reserva_fondeada");
    const { error } = await supabase
      .from("reserva_config")
      .update({
        factor_premios: Number(form.get("factor_premios")),
        factor_liquidez_pct: Number(form.get("factor_liquidez_pct")),
        kill_switch_umbral_pct: Number(form.get("kill_switch_umbral_pct")),
        reserva_fondeada: fondeadaRaw === "" || fondeadaRaw === null ? null : Number(fondeadaRaw),
      })
      .eq("id", true);
    setMensaje(error ? `No se pudo guardar: ${error.message}` : "Reserva actualizada.");
    if (!error) cargar();
  }

  if (cargando) return <p className="text-sm text-neutral-500">Cargando…</p>;
  if (!config) return <p className="text-sm text-red-600">No se pudo cargar reserva_config.</p>;

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Reserva global</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Kill switch GLOBAL sobre todos los niveles a la vez -- distinto del kill switch por evento de{" "}
        <a href="/admin/riesgo" className="underline">Riesgo</a>.
      </p>

      {mensaje && <div className="mb-4 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm">{mensaje}</div>}

      {exposicion && (
        <div className={`mb-6 rounded-lg border p-4 text-sm ${exposicion.kill_switch_activo ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          <p className="font-medium">
            {exposicion.kill_switch_activo
              ? "Kill switch global ACTIVO -- comprar_boleto() rechaza compras en todos los niveles."
              : exposicion.reserva_fondeada == null
                ? "Kill switch global inactivo -- reserva_fondeada todavía no está llena (pendiente de Tesorería)."
                : "Kill switch global inactivo -- exposición dentro del umbral."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metrica label="Capital en pool" valor={exposicion.capital_en_pool} />
            <Metrica label="Premios en riesgo" valor={exposicion.premios_en_riesgo} />
            <Metrica label="Reserva mínima recomendada" valor={exposicion.reserva_minima} />
            <Metrica label="Reserva fondeada (Tesorería)" valor={exposicion.reserva_fondeada} vacio="pendiente" />
          </div>
          <p className="mt-2 text-xs opacity-80">
            reserva_minima = factor_premios × premios_en_riesgo + factor_liquidez_pct% × capital_en_pool. Los
            premios_en_riesgo se calculan contra el aforo TOTAL de cada ciclo abierto (N × precio), no solo lo
            vendido hasta ahora -- es el peor caso, no el estado actual.
          </p>
        </div>
      )}

      <form onSubmit={guardar} className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-white p-5 md:grid-cols-4">
        <Campo label="Factor premios (colchón por correlación)">
          <input name="factor_premios" type="number" step="0.1" defaultValue={config.factor_premios} className={inputClass} />
        </Campo>
        <Campo label="Factor liquidez % (sobre capital en pool)">
          <input name="factor_liquidez_pct" type="number" step="0.1" defaultValue={config.factor_liquidez_pct} className={inputClass} />
        </Campo>
        <Campo label="Umbral kill switch %">
          <input name="kill_switch_umbral_pct" type="number" step="1" defaultValue={config.kill_switch_umbral_pct} className={inputClass} />
        </Campo>
        <Campo label="Reserva fondeada MXN (Tesorería, vacío = kill switch inactivo)">
          <input name="reserva_fondeada" type="number" defaultValue={config.reserva_fondeada ?? ""} placeholder="pendiente" className={inputClass} />
        </Campo>
        <div className="col-span-2 md:col-span-4">
          <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass = "w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function Metrica({ label, valor, vacio }: { label: string; valor: number | null; vacio?: string }) {
  return (
    <div className="rounded-md border border-white/60 bg-white/60 p-3">
      <p className="text-xs opacity-70">{label}</p>
      <p className="mt-0.5 font-display text-base font-semibold tabular-nums">
        {valor == null ? (vacio ?? "--") : `$${valor.toLocaleString("es-MX")}`}
      </p>
    </div>
  );
}
