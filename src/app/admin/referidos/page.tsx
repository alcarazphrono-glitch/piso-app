"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Referidos -- Behavioral Forest D8 (memo 17-sep-2026). Cuatro reglas del
// memo, todas en backend (migración 0006_behavioral_referidos_compliance.sql):
// single-level (referido_por no se propaga), recompensa solo al PRIMER
// evento del referido (no en signup), monto fijo (nunca %), cap mensual
// por referidor. A PROPÓSITO esta pantalla no tiene ranking de "top
// referidores" -- el memo lo prohíbe explícitamente. Lo que se ve aquí es
// una bitácora plana, no una tabla de posiciones.

interface Config {
  monto_recompensa: number;
  cap_mensual_por_referidor: number;
}

interface Recompensa {
  id: string;
  referidor_id: string;
  referido_id: string;
  monto: number;
  creado_en: string;
}

export default function AdminReferidosPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [recompensas, setRecompensas] = useState<Recompensa[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("referidos_config").select("*").maybeSingle(),
      supabase.from("referidos_recompensas").select("*").order("creado_en", { ascending: false }).limit(25),
    ]);
    setConfig(c as Config);
    setRecompensas((r as Recompensa[]) ?? []);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGuardando(true);
    const form = new FormData(e.currentTarget);
    const { error } = await supabase
      .from("referidos_config")
      .update({
        monto_recompensa: Number(form.get("monto_recompensa")),
        cap_mensual_por_referidor: Number(form.get("cap_mensual_por_referidor")),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", true);
    setGuardando(false);
    setMensaje(error ? `No se pudo guardar: ${error.message}` : "Guardado.");
    if (!error) cargar();
  }

  if (!config) return <p className="text-sm text-neutral-500">Cargando…</p>;

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Referidos</h1>
      <p className="mb-6 text-sm text-neutral-500">
        D8: single-level, recompensa al primer evento (no al signup), monto fijo, cap mensual. Sin ranking de
        referidores -- a propósito, ver comentario en el código.
      </p>

      <form onSubmit={guardar} className="mb-8 grid max-w-md grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Recompensa fija (MXN) -- nunca % ni rango</span>
          <input name="monto_recompensa" type="number" defaultValue={config.monto_recompensa} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Cap mensual de recompensas por referidor</span>
          <input name="cap_mensual_por_referidor" type="number" defaultValue={config.cap_mensual_por_referidor} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
        </label>
        <button type="submit" disabled={guardando} className="mt-1 w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {mensaje && <p className="text-xs text-neutral-600">{mensaje}</p>}
      </form>

      <div className="mb-8 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-xs text-amber-800">
        <p className="font-medium">Pendiente, no de Tecnología: captura del código de referido en el onboarding.</p>
        <p className="mt-1">
          vincular_referido() (migración 0006) ya existe y funciona -- lo que falta es la pantalla de Consumer donde
          un usuario nuevo entra con un link/código y esa función se llama. Es una decisión de Producto/Behavioral
          (¿link con query param? ¿código que se escribe a mano?), no se inventa aquí.
        </p>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Bitácora de recompensas pagadas</h2>
      <div className="flex flex-col gap-2">
        {recompensas.length === 0 && <p className="text-sm text-neutral-400">Sin recompensas pagadas todavía.</p>}
        {recompensas.map((r) => (
          <div key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
            <p className="text-xs text-neutral-400">{new Date(r.creado_en).toLocaleString("es-MX")}</p>
            <p className="mt-1">
              Referidor <span className="font-mono text-xs">{r.referidor_id}</span> recibió ${r.monto.toLocaleString("es-MX")} por
              el primer evento de <span className="font-mono text-xs">{r.referido_id}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
