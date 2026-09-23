"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Experimentos -- servicio de asignación de tratamiento, D9/D10 (memo
// Behavioral Forest 17-sep-2026). Pesos editables sin deploy (antes eran
// 25/25/25/25 en el memo original, ahora 30/10/40/20). propensity_score se
// registra en cada asignación desde el día uno -- ver
// asignaciones_tratamiento (migración 0007) -- aunque hoy la asignación
// sea "leer un peso y sortear", eso es justo lo que D9 pide para que un
// causal forest futuro pueda usar estos datos sin tener que re-instrumentar
// nada retroactivamente.

interface Tratamiento {
  clave: string;
  nombre: string;
  peso: number;
  activo: boolean;
}

interface ConteoAsignacion {
  tratamiento: string;
  n: number;
  propensity_promedio: number;
}

export default function AdminExperimentosPage() {
  const [tratamientos, setTratamientos] = useState<Tratamiento[]>([]);
  const [conteos, setConteos] = useState<ConteoAsignacion[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [{ data: t }, { data: asigs }] = await Promise.all([
      supabase.from("tratamientos").select("clave, nombre, peso, activo").order("clave"),
      supabase.from("asignaciones_tratamiento").select("tratamiento, propensity_score"),
    ]);
    setTratamientos((t as Tratamiento[]) ?? []);

    const acc: Record<string, { n: number; suma: number }> = {};
    for (const a of asigs ?? []) {
      const key = (a as { tratamiento: string; propensity_score: number }).tratamiento;
      if (!acc[key]) acc[key] = { n: 0, suma: 0 };
      acc[key].n += 1;
      acc[key].suma += Number((a as { tratamiento: string; propensity_score: number }).propensity_score);
    }
    setConteos(
      Object.entries(acc).map(([tratamiento, v]) => ({
        tratamiento,
        n: v.n,
        propensity_promedio: v.n > 0 ? v.suma / v.n : 0,
      }))
    );
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardarPeso(e: FormEvent<HTMLFormElement>, clave: string) {
    e.preventDefault();
    setGuardando(true);
    setMensaje(null);
    const form = new FormData(e.currentTarget);
    const pesoPct = Number(form.get("peso"));
    const { error } = await supabase
      .from("tratamientos")
      .update({ peso: pesoPct / 100, actualizado_en: new Date().toISOString() })
      .eq("clave", clave);
    setGuardando(false);
    setMensaje(
      error
        ? `No se pudo guardar (revisa que los pesos activos sumen 100%): ${error.message}`
        : `Peso de ${clave} actualizado.`
    );
    if (!error) cargar();
  }

  const sumaPesos = tratamientos.filter((t) => t.activo).reduce((acc, t) => acc + Number(t.peso), 0);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Experimentos</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Servicio de asignación T1-T4 (D9). Pesos editables sin deploy -- deben sumar 100% entre los tratamientos
        activos o Postgres rechaza el guardado.
      </p>

      <div className={`mb-4 max-w-lg rounded-md px-3 py-2 text-xs font-medium ${Math.abs(sumaPesos - 1) < 0.001 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
        Suma de pesos activos: {Math.round(sumaPesos * 100)}% {Math.abs(sumaPesos - 1) < 0.001 ? "-- correcto" : "-- debe ser 100%"}
      </div>

      {mensaje && <div className="mb-4 max-w-lg rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm">{mensaje}</div>}

      <div className="mb-8 flex max-w-lg flex-col gap-2">
        {tratamientos.map((t) => {
          const conteo = conteos.find((c) => c.tratamiento === t.clave);
          return (
            <form key={t.clave} onSubmit={(e) => guardarPeso(e, t.clave)} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
              <span className="w-10 shrink-0 font-mono text-xs font-semibold">{t.clave}</span>
              <span className="flex-1 truncate text-xs text-neutral-600">{t.nombre}</span>
              <input
                name="peso"
                type="number"
                step="0.01"
                defaultValue={Math.round(t.peso * 100 * 100) / 100}
                disabled={guardando}
                className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-xs"
              />
              <span className="text-xs text-neutral-400">%</span>
              <button type="submit" className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium">
                Guardar
              </button>
              <span className="w-24 shrink-0 text-right text-xs text-neutral-400">{conteo ? `${conteo.n} usuarios` : "0 usuarios"}</span>
            </form>
          );
        })}
      </div>

      <div className="mb-8 max-w-lg rounded-lg border border-neutral-200 bg-white p-4 text-xs text-neutral-600">
        <p className="font-medium text-neutral-700">T2 -- copy versionado (D10)</p>
        <p className="mt-1">
          El título de T2 cambió de "Apuesta a Banxico…" a "Tu predicción sobre Banxico…" -- vive en
          contenido_versionado bajo la clave <code className="rounded bg-neutral-100 px-1">tratamiento:t2:copy</code>,
          editable desde /admin/contenido, no hardcodeado en una pantalla. Su presupuesto de prueba bajó de 25% a 10%
          por el riesgo de framing que señaló el panel ENCODAT 2025 -- sigue activo, no eliminado.
        </p>
      </div>

      <p className="max-w-lg text-xs text-neutral-400">
        propensity_score se registra en cada fila de asignaciones_tratamiento desde el día uno -- es el peso vigente
        en el momento de asignar. No se muestra aquí una tabla usuario-por-usuario a propósito (mismo criterio de
        privacidad que Referidos): los conteos de arriba son agregados.
      </p>
    </div>
  );
}
