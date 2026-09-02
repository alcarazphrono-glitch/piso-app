"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { trackFunnel } from "@/lib/posthog";
import { EVENTOS, EventoId, Respuesta } from "@/types";
import { obtenerPerfil } from "@/lib/demo";
import { Screen, Badge, H1, Lede, PrimaryButton, Card, Mono } from "@/components/ui";

// Pantalla 3 del loop (memo DG, Prioridad 1):
// "Confirmación: Piso · Upside · Capital en riesgo $0 · [Confirmar]"

function ConfirmarContenido() {
  const router = useRouter();
  const params = useSearchParams();
  const [piso, setPiso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [esPrimeraPosicion, setEsPrimeraPosicion] = useState(true);

  const eventoId = (params.get("evento") ?? "banxico_baja_tasas") as EventoId;
  const respuesta = (params.get("respuesta") ?? "si") as Respuesta;
  const premio = Number(params.get("premio") ?? 0);
  const evento = EVENTOS.find((e) => e.id === eventoId) ?? EVENTOS[0];

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      const perfil = await obtenerPerfil(user.id);
      setPiso(perfil.piso);

      const { count } = await supabase
        .from("posiciones")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      setEsPrimeraPosicion((count ?? 0) === 0);
    });
  }, [router]);

  async function confirmar() {
    setEnviando(true);
    const { data: sess } = await supabase.auth.getSession();
    const user = sess.session?.user;
    if (!user) {
      router.replace("/auth");
      return;
    }

    const { data, error } = await supabase
      .from("posiciones")
      .insert({
        user_id: user.id,
        evento_id: evento.id,
        respuesta,
        premio_potencial: premio,
        capital_en_riesgo: 0,
        estado: "abierta",
      })
      .select("id")
      .single();

    if (error || !data) {
      setEnviando(false);
      alert("No se pudo confirmar tu posición. Intenta de nuevo.");
      return;
    }

    trackFunnel(esPrimeraPosicion ? "primer_evento" : "segundo_evento", {
      evento_id: evento.id,
      respuesta,
      premio_potencial: premio,
    });

    router.push(`/posicion?id=${data.id}`);
  }

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <div className="font-display text-xl font-bold">PISO</div>
        <Badge>Confirmación</Badge>
      </div>

      <div className="mt-8">
        <H1>Revisa tu posición</H1>
        <Lede>
          {evento.nombre} — respondiste <strong className="text-ink">{respuesta === "si" ? "Sí" : "No"}</strong>.
        </Lede>

        <div className="flex flex-col gap-2">
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Piso</span>
            <span className="text-sm font-medium capitalize">{piso ?? "…"}</span>
          </Card>
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Upside</span>
            <span className="font-mono text-sm tabular-nums">
              $<Mono>{premio.toLocaleString("es-MX")}</Mono> MXN
            </span>
          </Card>
          <Card className="flex items-center justify-between border-teal/40">
            <span className="text-sm text-ink-soft">Capital en riesgo</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-teal">$0</span>
          </Card>
        </div>

        <PrimaryButton className="mt-6" onClick={confirmar} disabled={enviando}>
          {enviando ? "Confirmando…" : "Confirmar"}
        </PrimaryButton>
      </div>
    </Screen>
  );
}

export default function ConfirmarPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmarContenido />
    </Suspense>
  );
}
