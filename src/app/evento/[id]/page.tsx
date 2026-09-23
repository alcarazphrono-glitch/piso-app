"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { trackFunnel } from "@/lib/posthog";
import { obtenerRacha } from "@/lib/demo";
import { Respuesta, Evento } from "@/types";
import { TICKET_DEMO_MXN, obtenerPremio } from "@/lib/config";
import { obtenerEvento, calcularPremioReal, confirmarPosicion } from "@/lib/eventos";
import { obtenerTicketDemo } from "@/lib/pricing";
import {
  Screen,
  BackChevron,
  RachaBadge,
  H1,
  PrimaryButton,
  CalendarIcon,
  ShieldIcon,
} from "@/components/ui";

// Pantalla Evento -- memo Behavioral, sección 2: prioridad #1 de build.
// El Dato 3 dice que aquí es donde se pierde a la gente (mediana 18-22s),
// no en el Home -- así que Evento y la vieja pantalla de Confirmar se
// fusionan en una sola (el lienzo publicado, Evento.dc.html, ya trae los
// 3 números y el botón de confirmar juntos, sin un paso aparte). El
// mockup no muestra el selector Sí/No -- el producto lo necesita para
// guardar la posición, así que se agrega aquí con el mismo lenguaje
// visual, antes de la tarjeta de números.

export default function EventoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [autenticado, setAutenticado] = useState(false);
  const [racha, setRacha] = useState(0);
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [esPrimeraPosicion, setEsPrimeraPosicion] = useState(true);
  const [evento, setEvento] = useState<Evento | null | undefined>(undefined); // undefined = cargando
  const [premio, setPremio] = useState(0);
  const [ticket, setTicket] = useState(TICKET_DEMO_MXN);

  useEffect(() => {
    obtenerTicketDemo().then(setTicket);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      setAutenticado(true);

      // Checkpoint 18-sep-2026 (hardening, migración 0008): una sola
      // posición por usuario por evento -- si ya existe una para este
      // evento, no se deja llegar al botón de confirmar dos veces.
      // confirmar_posicion() ya la rechaza del lado del servidor, pero
      // hacerlo visible aquí evita el error crudo y manda directo a donde
      // esa posición ya vive.
      if (typeof params.id === "string") {
        const { data: existente } = await supabase
          .from("posiciones")
          .select("id")
          .eq("user_id", user.id)
          .eq("evento_id", params.id)
          .maybeSingle();
        if (existente) {
          router.replace(`/posicion?id=${existente.id}`);
          return;
        }
      }

      const [r, { count }] = await Promise.all([
        obtenerRacha(user.id),
        supabase.from("posiciones").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      setRacha(r);
      setEsPrimeraPosicion((count ?? 0) === 0);
    });
  }, [router, params.id]);

  useEffect(() => {
    if (typeof params.id !== "string") return;
    obtenerEvento(params.id).then((e) => {
      setEvento(e && e.activo ? e : null);
      if (e && e.activo) {
        // Estimado instantáneo (src/lib/config.ts) primero, para no bloquear
        // el render -- calcular_premio_potencial() del lado de Postgres lo
        // reemplaza en cuanto responde. Es el mismo número que se va a
        // guardar en confirmar_posicion(), así que nunca queda un premio
        // "mostrado" distinto del "cobrado".
        setPremio(obtenerPremio(e.id));
        calcularPremioReal(e.id).then(setPremio).catch(() => {});
      }
    });
  }, [params.id]);

  async function confirmar() {
    if (!evento || !respuesta) return;
    setConfirmando(true);

    const { data: sess } = await supabase.auth.getSession();
    const user = sess.session?.user;
    if (!user) {
      router.replace("/auth");
      return;
    }

    let posicionId: string;
    try {
      const posicion = await confirmarPosicion(evento.id, respuesta);
      posicionId = posicion.id;
    } catch {
      setConfirmando(false);
      alert("No se pudo confirmar tu posición. Intenta de nuevo.");
      return;
    }

    trackFunnel(esPrimeraPosicion ? "primer_evento" : "segundo_evento", {
      evento_id: evento.id,
      respuesta,
      premio_potencial: premio,
    });

    router.push(`/posicion?id=${posicionId}`);
  }

  if (!autenticado || evento === undefined) return null;

  if (!evento) {
    return (
      <Screen>
        <div className="flex items-center gap-3.5 pt-2">
          <BackChevron onClick={() => router.push("/eventos")} />
        </div>
        <div className="mt-10">
          <H1>Este evento llega pronto</H1>
          <button onClick={() => router.push("/eventos")} className="mt-6">
            <PrimaryButton>Ver eventos activos</PrimaryButton>
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <BackChevron onClick={() => router.push("/eventos")} />
        <RachaBadge n={racha} />
      </div>

      <div className="mt-5">
        <div className="mb-2.5 flex items-center gap-1.5">
          <CalendarIcon className="h-[15px] w-[15px] text-ink-soft" />
          <span className="text-xs font-semibold uppercase tracking-[0.02em] text-ink-soft">Evento verificable</span>
        </div>
        <H1>{evento.nombre}</H1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-[oklch(90%_0.006_258)]">{evento.explicacion[0]}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{evento.explicacion[1]}</p>
      </div>

      <div className="mt-[18px] border-t border-line pt-4">
        <p className="font-display text-base font-semibold">{evento.fecha}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-soft">{evento.fechaContexto}</p>
      </div>

      <div className="mt-5">
        <p className="mb-2.5 text-sm font-medium">¿Va a ocurrir?</p>
        <div className="flex gap-3">
          <button
            onClick={() => setRespuesta("si")}
            className={`flex-1 rounded-card border py-3.5 text-sm font-semibold transition-colors ${
              respuesta === "si" ? "border-mint bg-mint-chip text-mint" : "border-line bg-surface text-ink-soft"
            }`}
          >
            Sí
          </button>
          <button
            onClick={() => setRespuesta("no")}
            className={`flex-1 rounded-card border py-3.5 text-sm font-semibold transition-colors ${
              respuesta === "no" ? "border-mint bg-mint-chip text-mint" : "border-line bg-surface text-ink-soft"
            }`}
          >
            No
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-ink-soft">Tu piso</span>
          <span className="flex items-center gap-1.5 font-display text-base font-semibold">
            ${ticket}
            <ShieldIcon className="h-3.5 w-3.5 text-mint" strokeWidth={1.9} />
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-line py-2">
          <span className="text-sm text-ink-soft">Upside potencial</span>
          <span className="font-display text-lg font-bold text-mint">+${premio.toLocaleString("es-MX")}</span>
        </div>
        <div className="flex items-center justify-between border-t border-line py-2">
          <span className="text-sm text-ink-soft">Capital en riesgo</span>
          <span className="font-display text-base font-bold">$0</span>
        </div>
        <p className="mt-3.5 text-[11.5px] leading-relaxed text-faint">
          Tu depósito está en CETES. Solo el rendimiento participa en el evento.
        </p>
      </div>

      <PrimaryButton className="mt-6" onClick={confirmar} disabled={!respuesta || confirmando}>
        {confirmando ? "Confirmando…" : "Confirmar mi entrada"}
      </PrimaryButton>
      <p className="mt-3 text-center text-xs text-faint">Toma 15 segundos. Puedes retirar cuando quieras.</p>
    </Screen>
  );
}
