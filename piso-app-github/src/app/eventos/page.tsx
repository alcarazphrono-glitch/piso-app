"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { posthog } from "@/lib/posthog";
import { EventoCore, listarEventosCore } from "@/lib/core";
import { mensajeError } from "@/lib/errores";
import { Screen, BackChevron, H1, LockIcon } from "@/components/ui";

// Lista de eventos activos. Hasta el checkpoint del 3-sep-2026 esto leía
// del arreglo EVENTOS hardcodeado en src/types/index.ts -- lo cual dejaba
// a Event Manager sin efecto real: un operador podía crear y publicar un
// evento en /admin/eventos y ningún usuario lo iba a ver nunca (memo de
// Dirección, "Retroalimentación al checkpoint post-arquitectura", Falla
// 1). Ahora lee directo de la tabla `eventos` -- de lectura pública desde
// el schema.sql original, así que no hace falta ninguna función RPC ni
// política nueva para esto.

export default function EventosPage() {
  const router = useRouter();
  const [eventos, setEventos] = useState<EventoCore[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace("/auth");
        return;
      }
      try {
        setEventos(await listarEventosCore());
      } catch (e) {
        setError(mensajeError(e));
      } finally {
        setCargando(false);
      }
    });
  }, [router]);

  function onEventoBloqueado(nombre: string) {
    posthog.capture("quiere_mas_eventos", { evento_deseado: nombre });
  }

  // "abierto" = publicado por un operador, visible y apostable.
  // "borrador" = existe en Event Manager pero no se ha publicado --
  // se muestra como "Próximamente" en vez de no mostrarse, para que el
  // trabajo de un operador en Event Manager tenga efecto visible aunque
  // todavía no abra apuestas.
  const activos = eventos.filter((e) => e.estado === "abierto");
  const bloqueados = eventos.filter((e) => e.estado === "borrador");

  return (
    <Screen>
      <div className="flex items-center gap-3.5 pt-2">
        <BackChevron onClick={() => router.push("/home")} />
        <H1 className="text-[19px]">Eventos</H1>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">{error}</p>
      )}

      {cargando ? (
        <p className="mt-7 text-sm text-ink-soft">Cargando…</p>
      ) : (
        <>
          <div className="mt-7 flex flex-col gap-2.5">
            {activos.map((e) => (
              <Link
                key={e.id}
                href={`/evento/${e.id}`}
                className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-4"
              >
                <div>
                  <p className="text-[15px] font-medium">{e.nombre}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{e.fecha_display}</p>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-ink-soft">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            ))}
            {activos.length === 0 && (
              <p className="text-sm text-ink-soft">No hay eventos activos todavía.</p>
            )}
          </div>

          {bloqueados.length > 0 && (
            <div className="mt-9">
              <p className="mb-3 text-xs uppercase tracking-[0.06em] text-ink-soft">Más eventos</p>
              <div className="flex flex-col gap-2">
                {bloqueados.map((e) => (
                  <div
                    key={e.id}
                    onClick={() => onEventoBloqueado(e.nombre)}
                    className="flex cursor-pointer items-center justify-between rounded-2xl border border-line bg-surface/50 px-4 py-3.5 opacity-60"
                  >
                    <span className="text-sm font-medium">{e.nombre}</span>
                    <span className="flex items-center gap-1 text-xs text-ink-soft">
                      <LockIcon /> Próximamente
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
