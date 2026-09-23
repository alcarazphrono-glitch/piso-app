"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { trackFunnel, posthog } from "@/lib/posthog";
import { obtenerRacha } from "@/lib/demo";
import { TICKET_DEMO_MXN } from "@/lib/config";
import { obtenerEvento } from "@/lib/eventos";
import { obtenerTicketDemo } from "@/lib/pricing";
import { Evento, PISO_MOMENT_OPCIONES, Posicion, PisoMomentOpcion } from "@/types";
import {
  Screen,
  BackChevron,
  RachaBadge,
  H1,
  InkButton,
  PrimaryButton,
  ShieldIcon,
  ShieldCheckIcon,
  ArrowLightningIcon,
  TargetIcon,
  TrophyIcon,
} from "@/components/ui";

// Pantalla Resultado -- memo Behavioral, secciones 3 y 4. Se divide en dos
// diseños muy distintos, tal como el lienzo publicado (NoGanaste.dc.html /
// Ganaste.dc.html): "No ganaste" se queda en el sistema oscuro con la
// racha y el PISO Moment; "Ganaste" es la única pantalla con fondo claro
// a propósito (memo DG: "el rediseño más profundo").
//
// El PISO Moment ahora tiene 4 chips fijos (ya no 5 con "Otro" libre) y
// avanza solo al elegir uno -- sin un botón "Enviar" aparte (memo
// Behavioral, sección 3). Y solo aparece en "No ganaste": el mockup de
// Ganaste no lo incluye -- es, a propósito, un momento sin distracciones.
//
// Nota de implementación: ni el memo ni el lienzo dicen desde dónde se
// llega a la pantalla de Modo real ahora que dejó de ser un modal. La
// dejamos como un link secundario debajo del botón principal en ambas
// ramas de Resultado -- mismo punto de entrada que tenía antes, solo que
// ahora aterriza en una pantalla real en vez de un alert().

const ICONO_OPCION: Record<PisoMomentOpcion, typeof ShieldIcon> = {
  "Mi dinero nunca estuvo en riesgo": ShieldIcon,
  "Puedo ganar si tengo razón": ArrowLightningIcon,
  "Me gusta predecir lo que va a pasar": TargetIcon,
  "Quiero subir de nivel": TrophyIcon,
};

function copyGanaste(eventoId: string): string {
  if (eventoId === "banxico_baja_tasas") return "Banxico bajó la tasa. Tenías razón.";
  if (eventoId === "inpc_bajo") return "La inflación cerró como dijiste. Tenías razón.";
  return "Tenías razón.";
}

function ResultadoContenido() {
  const router = useRouter();
  const params = useSearchParams();
  const posicionId = params.get("id");

  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const [evento, setEvento] = useState<Evento | null>(null);
  const [racha, setRacha] = useState(0);
  const [yaRespondioMoment, setYaRespondioMoment] = useState(false);
  const [enviandoMoment, setEnviandoMoment] = useState(false);
  const [ticket, setTicket] = useState(TICKET_DEMO_MXN);

  useEffect(() => {
    obtenerTicketDemo().then(setTicket);
  }, []);

  useEffect(() => {
    if (!posicionId) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      const [{ data: pos }, { data: moment }, r] = await Promise.all([
        supabase.from("posiciones").select("*").eq("id", posicionId).single(),
        supabase.from("piso_moment_respuestas").select("id").eq("posicion_id", posicionId).maybeSingle(),
        obtenerRacha(user.id),
      ]);
      if (pos) {
        setPosicion(pos as Posicion);
        setEvento(await obtenerEvento((pos as Posicion).evento_id));
      }
      setYaRespondioMoment(Boolean(moment));
      setRacha(r);
    });
  }, [posicionId, router]);

  async function elegirOpcion(opcion: PisoMomentOpcion) {
    if (!posicion || enviandoMoment) return;
    setEnviandoMoment(true);

    const { data: sess } = await supabase.auth.getSession();
    const user = sess.session?.user;
    if (!user) return;

    const { error } = await supabase.from("piso_moment_respuestas").insert({
      user_id: user.id,
      posicion_id: posicion.id,
      evento_id: posicion.evento_id,
      resultado: posicion.resultado,
      opcion,
      opcion_otro_texto: null,
    });

    if (!error) {
      posthog.capture("piso_moment_respondido", {
        opcion,
        evento_id: posicion.evento_id,
        resultado: posicion.resultado,
      });
      setYaRespondioMoment(true);
    }
    setEnviandoMoment(false);
  }

  function siguienteEvento() {
    router.push("/eventos");
  }

  function pasarAModoReal() {
    trackFunnel("quiere_modo_real", { desde: "resultado_cta_real" });
    router.push(`/modo-real${posicion ? `?premio=${posicion.premio_potencial}` : ""}`);
  }

  if (!posicion || !evento) return <Screen><p className="pt-8 text-ink-soft">Cargando resultado…</p></Screen>;

  const gano = posicion.resultado === "gano";

  // ---------------------------------------------------------------- GANASTE
  if (gano) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[460px] flex-col items-center bg-ganaste-bg px-6 pb-16 pt-7 text-ganaste-ink">
        <RachaBadge n={racha} tone="light" />

        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 text-center">
          <p className="font-display text-[42px] font-bold leading-none tracking-[-0.02em]">
            +${posicion.premio_potencial.toLocaleString("es-MX")}
            <br />
            MXN
          </p>
          <p className="max-w-[250px] text-base leading-relaxed text-ganaste-ink-soft">{copyGanaste(evento.id)}</p>
        </div>

        <div className="mb-4 flex w-full items-center justify-between rounded-2xl border border-ganaste-card-border bg-ganaste-card p-[18px]">
          <div>
            <p className="mb-1 text-[12.5px] text-ganaste-ink-soft">Tu piso</p>
            <p className="font-display text-[19px] font-bold">${ticket} MXN</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-ganaste-chip px-3 py-2">
            <ShieldIcon className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="text-[13px] font-semibold">Intacto</span>
          </div>
        </div>

        <InkButton onClick={siguienteEvento}>Ver siguiente evento</InkButton>
        <button onClick={pasarAModoReal} className="mt-3 text-center text-[13px] font-medium text-ganaste-ink-soft underline underline-offset-2">
          Pasar a modo real
        </button>
      </main>
    );
  }

  // -------------------------------------------------------------- NO GANASTE
  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <BackChevron onClick={() => router.push("/home")} />
        <RachaBadge n={racha} />
      </div>

      <H1 className="mt-[26px] max-w-[300px] text-[25px]">
        Esta vez no.
        <br />
        Tu piso sigue ahí.
      </H1>

      <div className="mt-5 flex items-center justify-between rounded-2xl border border-line bg-surface p-[18px]">
        <div>
          <p className="mb-1 text-[12.5px] text-ink-soft">Tu piso</p>
          <p className="font-display text-[19px] font-bold">${ticket} MXN</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-mint-chip px-3 py-2">
          <ShieldIcon className="h-3.5 w-3.5 text-mint" strokeWidth={2} />
          <span className="text-[13px] font-semibold text-mint">Intacto</span>
        </div>
      </div>

      <p className="ml-0.5 mt-3.5 text-[13px] text-ink-soft">Tu racha sigue viva si entras a otro evento hoy.</p>

      {!yaRespondioMoment ? (
        <div className="mt-[22px] flex flex-col gap-2.5">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-[0.02em] text-faint">¿Qué te dejó este evento?</p>
          {PISO_MOMENT_OPCIONES.map((op) => {
            const Icono = ICONO_OPCION[op];
            const seleccionada = false;
            return (
              <button
                key={op}
                disabled={enviandoMoment}
                onClick={() => elegirOpcion(op)}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors disabled:opacity-60 ${
                  seleccionada ? "border-mint bg-mint-chip" : "border-line bg-surface"
                }`}
              >
                <Icono className="h-5 w-5 flex-shrink-0 text-ink-soft" strokeWidth={1.8} />
                <span className="text-[14.5px] font-medium">{op}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <PrimaryButton className="mt-8" onClick={siguienteEvento}>
            Ver siguiente evento
          </PrimaryButton>
          <button onClick={pasarAModoReal} className="mt-3 w-full text-center text-[13px] font-medium text-ink-soft underline underline-offset-2">
            Pasar a modo real
          </button>
        </>
      )}
    </Screen>
  );
}

export default function ResultadoPage() {
  return (
    <Suspense fallback={null}>
      <ResultadoContenido />
    </Suspense>
  );
}
