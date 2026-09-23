"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Analytics -- PISO Core V1. Todo sale de admin_analytics_resumen() en
// Postgres (datos de Supabase), no de PostHog -- "views" por evento vive
// en PostHog y no se replica aquí a propósito, para no mostrar un número
// que en realidad viene de otro sistema como si fuera el mismo dato.

interface EventoPart {
  id: string;
  nombre: string;
  participacion: number;
  ganadas: number;
}

interface Resumen {
  usuarios_totales: number;
  posiciones_totales: number;
  posiciones_hoy: number;
  repeat_rate: number | null;
  d1_retention: number | null;
  d7_retention: number | null;
  por_evento: EventoPart[];
}

export default function AdminAnalyticsPage() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("admin_analytics_resumen").then(({ data, error }) => {
      if (error) setError(error.message);
      else setResumen(data as Resumen);
    });
  }, []);

  if (error) return <p className="text-sm text-red-600">No se pudo cargar: {error}</p>;
  if (!resumen) return <p className="text-sm text-neutral-500">Cargando…</p>;

  const pct = (v: number | null) => (v == null ? "— (sin datos suficientes)" : `${v}%`);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Analytics</h1>
      <p className="mb-6 text-sm text-neutral-500">Calculado de datos reales de Supabase, no simulado.</p>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metrica label="Usuarios totales" valor={resumen.usuarios_totales} />
        <Metrica label="Posiciones totales" valor={resumen.posiciones_totales} />
        <Metrica label="Posiciones hoy" valor={resumen.posiciones_hoy} />
        <Metrica label="Repeat rate" valor={pct(resumen.repeat_rate)} />
        <Metrica label="D1 retention" valor={pct(resumen.d1_retention)} />
        <Metrica label="D7 retention" valor={pct(resumen.d7_retention)} />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Participación por evento</h2>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Evento</th>
              <th className="px-3 py-2 font-medium">Posiciones</th>
              <th className="px-3 py-2 font-medium">Ganadas</th>
            </tr>
          </thead>
          <tbody>
            {resumen.por_evento.map((e) => (
              <tr key={e.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-2">{e.nombre}</td>
                <td className="px-3 py-2 tabular-nums">{e.participacion}</td>
                <td className="px-3 py-2 tabular-nums">{e.ganadas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metrica({ label, valor }: { label: string; valor: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
