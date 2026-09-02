"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { posthog } from "@/lib/posthog";
import { EVENTOS, premioPotencialDemo, Respuesta } from "@/types";
import { Screen, Badge, H1, Lede, PrimaryButton, SecondaryButton, Card, Mono, LockIcon } from "@/components/ui";

const TICKET_DEMO_MXN = 500; // ticket fijo para el loop de demo esta semana

// Pantalla 2 del loop (memo DG, Prioridad 1):
// "Evento: El evento · Probabilidad · Premio potencial · [Sí/No]"
// Prioridad 3: un solo evento activo (Banxico). Los demás quedan
// bloqueados visualmente para medir demanda sin construirlos.

export default function EventoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [autenticado, setAutenticado] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/auth");
      else setAutenticado(true);
    });
  }, [router]);

  const evento = EVENTOS.find((e) => e.id === params.id) ?? EVENTOS[0];
  const otros = EVENTOS.filter((e) => e.id !== evento.id);
  const premio = premioPotencialDemo(TICKET_DEMO_MXN, evento.probabilidad);

  function elegir(respuesta: Respuesta) {
    if (!evento.activo) return;
    const q = new URLSearchParams({ evento: evento.id, respuesta, premio: String(premio) });
    router.push(`/confirmar?${q.toString()}`);
  }

  function onEventoBloqueado(nombre: string) {
    posthog.capture("quiere_mas_eventos", { evento_deseado: nombre });
  }

  if (!autenticado) return null;

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <div className="font-display text-xl font-bold">PISO</div>
        <Badge>Capital protegido</Badge>
      </div>

      {!evento.activo ? (
        <div className="mt-10">
          <H1>Este evento llega pronto</H1>
          <Lede>Por ahora, Banxico baja tasas es el único evento activo.</Lede>
          <PrimaryButton onClick={() => router.push("/evento/banxico_baja_tasas")}>
            Ver Banxico baja tasas
          </PrimaryButton>
        </div>
      ) : (
        <div className="mt-8">
          <p className="text-sm text-ink-soft">El evento</p>
          <H1>{evento.nombre}</H1>

          <div className="grid grid-cols-2 gap-3">
            <Card>
              <p className="text-xs uppercase tracking-[0.06em] text-ink-soft">Probabilidad</p>
              <p className="mt-1 font-mono text-xl tabular-nums">{Math.round(evento.probabilidad * 100)}%</p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-[0.06em] text-ink-soft">Premio potencial</p>
              <p className="mt-1 font-mono text-xl tabular-nums">
                $<Mono>{premio.toLocaleString("es-MX")}</Mono>
              </p>
            </Card>
          </div>

          <p className="mb-3 mt-8 text-sm font-medium">¿Va a ocurrir?</p>
          <div className="flex gap-3">
            <PrimaryButton onClick={() => elegir("si")}>Sí</PrimaryButton>
            <SecondaryButton onClick={() => elegir("no")}>No</SecondaryButton>
          </div>
        </div>
      )}

      <div className="mt-10">
        <p className="mb-3 text-xs uppercase tracking-[0.06em] text-ink-soft">Más eventos</p>
        <div className="flex flex-col gap-2">
          {otros.map((e) => (
            <div
              key={e.id}
              onClick={() => onEventoBloqueado(e.nombre)}
              className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-surface/50 px-4 py-3 opacity-60"
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
