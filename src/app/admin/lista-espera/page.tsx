"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Lista de espera -- registros de la landing /unete. Todo sale de
// admin_lista_espera_resumen() (0013_lista_espera.sql). Las visitas y la
// tasa de conversión viven en PostHog (evento lista_espera_vista vs.
// lista_espera_registro); aquí solo se muestra lo que está en Supabase.

interface PorFuente {
  fuente: string;
  campana: string;
  registros: number;
  nicho_18_24: number;
}

interface Resumen {
  total: number;
  hoy: number;
  ultimos_7_dias: number;
  por_invitacion: number;
  nicho_18_24: number;
  con_edad: number;
  por_fuente: PorFuente[];
  por_dia: { dia: string; registros: number }[];
  por_edad: { rango: string; registros: number }[];
}

export default function AdminListaEsperaPage() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("admin_lista_espera_resumen").then(({ data, error }) => {
      if (error) setError(error.message);
      else setResumen(data as Resumen);
    });
  }, []);

  if (error) return <p className="text-sm text-red-600">No se pudo cargar: {error}</p>;
  if (!resumen) return <p className="text-sm text-neutral-500">Cargando…</p>;

  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`);
  const maxDia = Math.max(1, ...resumen.por_dia.map((d) => d.registros));

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Lista de espera</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Registros de <code className="rounded bg-neutral-100 px-1">/unete</code>. Visitas y conversión por campaña: PostHog.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metrica label="Registros totales" valor={resumen.total} />
        <Metrica label="Hoy" valor={resumen.hoy} />
        <Metrica label="Últimos 7 días" valor={resumen.ultimos_7_dias} />
        <Metrica label="Llegaron por invitación" valor={`${resumen.por_invitacion} (${pct(resumen.por_invitacion, resumen.total)})`} />
        <Metrica label="Nicho 18–24 (de quien dio edad)" valor={`${resumen.nicho_18_24} (${pct(resumen.nicho_18_24, resumen.con_edad)})`} />
        <Metrica label="Dieron su edad" valor={`${resumen.con_edad} (${pct(resumen.con_edad, resumen.total)})`} />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Registros por día (30 días)</h2>
      <div className="mb-8 rounded-lg border border-neutral-200 bg-white p-4">
        {resumen.por_dia.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin registros todavía.</p>
        ) : (
          <div className="flex h-32 items-end gap-1">
            {resumen.por_dia.map((d) => (
              <div key={d.dia} className="flex flex-1 flex-col items-center justify-end" title={`${d.dia}: ${d.registros}`}>
                <div className="w-full rounded-t bg-neutral-800" style={{ height: `${(100 * d.registros) / maxDia}%` }} />
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Por fuente y campaña (UTM)</h2>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Fuente</th>
              <th className="px-3 py-2 font-medium">Campaña</th>
              <th className="px-3 py-2 font-medium">Registros</th>
              <th className="px-3 py-2 font-medium">18–24</th>
            </tr>
          </thead>
          <tbody>
            {resumen.por_fuente.map((f) => (
              <tr key={`${f.fuente}-${f.campana}`} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-2">{f.fuente}</td>
                <td className="px-3 py-2">{f.campana}</td>
                <td className="px-3 py-2 tabular-nums">{f.registros}</td>
                <td className="px-3 py-2 tabular-nums">{f.nicho_18_24}</td>
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
      <p className="mt-1 text-xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
