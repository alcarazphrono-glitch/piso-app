"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { posthog } from "@/lib/posthog";
import { EVENTOS } from "@/types";
import { Screen, BackChevron, H1, LockIcon } from "@/components/ui";

// Lista de eventos activos. No estaba en el lienzo de Behavioral porque su
// mockup de Evento asume que ya sabes a qué evento entraste -- pero ahora
// hay dos eventos activos (Banxico + INPC, memo Behavioral sección 8), así
// que "Ver eventos" en el Home necesita aterrizar en algo antes de la
// pantalla de un evento específico.

export default function EventosPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/auth");
    });
  }, [router]);

  function onEventoBloqueado(nombre: string) {
    posthog.capture("quiere_mas_eventos", { evento_deseado: nombre });
  }

  const activos = EVENTOS.filter((e) => e.activo);
  const bloqueados = EVENTOS.filter((e) => !e.activo);

  return (
    <Screen>
      <div className="flex items-center gap-3.5 pt-2">
        <BackChevron onClick={() => router.push("/home")} />
        <H1 className="text-[19px]">Eventos</H1>
      </div>

      <div className="mt-7 flex flex-col gap-2.5">
        {activos.map((e) => (
          <Link
            key={e.id}
            href={`/evento/${e.id}`}
            className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-4"
          >
            <div>
              <p className="text-[15px] font-medium">{e.nombre}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{e.fecha}</p>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-ink-soft">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ))}
      </div>

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
    </Screen>
  );
}
