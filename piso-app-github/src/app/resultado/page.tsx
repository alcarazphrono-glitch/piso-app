"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { trackFunnel, posthog } from "@/lib/posthog";
import { EVENTOS, PISO_MOMENT_OPCIONES, Posicion, PisoMomentOpcion } from "@/types";
import { Screen, Badge, H1, Lede, PrimaryButton, SecondaryButton, Card } from "@/components/ui";

// Pantalla 5 del loop (memo DG, Prioridad 1):
// "Resultado: Ganaste/No ganaste · Tu piso intacto · [Siguiente evento]"
//
// Prioridad 7 -- el PISO Moment. "Es el dato más importante que vamos a
// recolectar esta semana": aparece aquí mismo, después del primer
// resultado, antes de dejar ir al usuario a "Siguiente evento".

function ResultadoContenido() {
  const router = useRouter();
  const params = useSearchParams();
  const posicionId = params.get("id");

  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const [yaRespondioMoment, setYaRespondioMoment] = useState(false);
  const [opcion, setOpcion] = useState<PisoMomentOpcion | null>(null);
  const [otroTexto, setOtroTexto] = useState("");
  const [enviandoMoment, setEnviandoMoment] = useState(false);

  useEffect(() => {
    if (!posicionId) return;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace("/auth");
        return;
      }
      const { data: pos } = await supabase.from("posiciones").select("*").eq("id", posicionId).single();
      if (pos) setPosicion(pos as Posicion);

      const { data: moment } = await supabase
        .from("piso_moment_respuestas")
        .select("id")
        .eq("posicion_id", posicionId)
        .maybeSingle();
      setYaRespondioMoment(Boolean(moment));
    });
  }, [posicionId, router]);

  async function enviarPisoMoment() {
    if (!posicion || !opcion) return;
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
      opcion_otro_texto: opcion === "Otro" ? otroTexto || null : null,
    });

    if (!error) {
      // Además de la tabla en Supabase (fuente de verdad), lo mandamos a
      // PostHog para poder cruzarlo con el resto del funnel sin un JOIN.
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
    router.push("/evento/banxico_baja_tasas");
  }

  if (!posicion) return <Screen><p className="pt-8 text-ink-soft">Cargando resultado…</p></Screen>;

  const evento = EVENTOS.find((e) => e.id === posicion.evento_id) ?? EVENTOS[0];
  const gano = posicion.resultado === "gano";

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <div className="font-display text-xl font-bold">PISO</div>
        <Badge tone={gano ? "gold" : "teal"}>{gano ? "Ganaste" : "No ganaste"}</Badge>
      </div>

      <div className="mt-8">
        <H1>{gano ? `Ganaste $${posicion.premio_potencial.toLocaleString("es-MX")} MXN` : "Esta vez no ganaste"}</H1>
        <Lede>{evento.nombre} — tu piso sigue intacto, ganes o pierdas.</Lede>

        <Card className="flex items-center justify-between border-teal/40">
          <span className="text-sm text-ink-soft">Tu piso</span>
          <span className="text-sm font-semibold text-teal">Intacto</span>
        </Card>

        {!yaRespondioMoment ? (
          <div className="mt-8">
            <p className="mb-1 font-display text-lg font-semibold">
              ¿Qué fue lo que más te llamó la atención de PISO?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {PISO_MOMENT_OPCIONES.map((op) => (
                <label
                  key={op}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                    opcion === op ? "border-gold bg-surface" : "border-line bg-surface/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="piso-moment"
                    value={op}
                    checked={opcion === op}
                    onChange={() => setOpcion(op)}
                    className="accent-current"
                  />
                  {op}
                </label>
              ))}
            </div>
            {opcion === "Otro" && (
              <input
                type="text"
                placeholder="Cuéntanos qué fue"
                value={otroTexto}
                onChange={(e) => setOtroTexto(e.target.value)}
                className="mt-3 w-full rounded-card border border-line bg-surface px-4 py-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-gold"
              />
            )}
            <PrimaryButton className="mt-4" onClick={enviarPisoMoment} disabled={!opcion || enviandoMoment}>
              {enviandoMoment ? "Guardando…" : "Enviar"}
            </PrimaryButton>
          </div>
        ) : (
          <PrimaryButton className="mt-8" onClick={siguienteEvento}>
            Siguiente evento
          </PrimaryButton>
        )}

        {yaRespondioMoment && (
          <SecondaryButton
            className="mt-3"
            onClick={() => {
              trackFunnel("quiere_modo_real", { desde: "resultado_cta_real" });
              alert(
                "El modo real llega pronto. Ya guardamos que te interesa — te avisamos en cuanto esté listo."
              );
            }}
          >
            Pasar a modo real
          </SecondaryButton>
        )}
      </div>
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
