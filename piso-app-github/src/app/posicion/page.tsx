"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { EVENTOS, Posicion } from "@/types";
import { DIAS_HASTA_RESOLUCION } from "@/lib/config";
import { Screen, Wordmark, H1, Lede, SecondaryButton, Card, Mono } from "@/components/ui";

// Pantalla de Posición -- no está en el lienzo de Behavioral (su memo no
// la menciona en la lista de 6 pantallas ni en las secciones 1-8), así
// que se reconstruye solo con el sistema visual nuevo, misma lógica de
// antes: el botón "Simular resultado ahora" sigue siendo exclusivo de
// modo demo.

function PosicionContenido() {
  const router = useRouter();
  const params = useSearchParams();
  const posicionId = params.get("id");
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const [simulando, setSimulando] = useState(false);

  useEffect(() => {
    if (!posicionId) return;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace("/auth");
        return;
      }
      const { data: pos, error } = await supabase
        .from("posiciones")
        .select("*")
        .eq("id", posicionId)
        .single();
      if (error || !pos) return;
      setPosicion(pos as Posicion);
      if (pos.estado === "resuelta") {
        router.replace(`/resultado?id=${posicionId}`);
      }
    });
  }, [posicionId, router]);

  // PISO Core V1 (migración 0002_piso_core_v1.sql, memo de arquitectura
  // 3-sep-2026): antes esta función decidía el resultado con Math.random()
  // en el navegador y escribía posiciones/balances con dos updates
  // directos -- el cliente era la autoridad. Ahora solo pide que se
  // resuelva; simular_resultado_posicion_demo() corre en el servidor,
  // valida (con auth.uid(), no con nada que mande este código) que la
  // posición es de quien llama, y es la que decide y escribe.
  //
  // Sigue siendo simulación por posición, independiente por usuario --
  // no el Resolution Engine oficial (ver resolver_evento(), que usa un
  // operador desde PISO Core para resolver el evento una sola vez para
  // todos). Se mantiene así a propósito para no bloquear la beta de
  // Track A.
  async function simularResultadoAhora() {
    if (!posicion) return;
    setSimulando(true);

    const { data, error } = await supabase.rpc("simular_resultado_posicion_demo", {
      p_posicion_id: posicion.id,
    });

    if (error || !data || data.length === 0) {
      setSimulando(false);
      alert("No se pudo resolver la posición. Intenta de nuevo.");
      return;
    }

    router.push(`/resultado?id=${posicion.id}`);
  }

  if (!posicion) return <Screen><p className="pt-8 text-ink-soft">Cargando tu posición…</p></Screen>;

  const evento = EVENTOS.find((e) => e.id === posicion.evento_id) ?? EVENTOS[0];
  const dias = DIAS_HASTA_RESOLUCION[evento.id] ?? 42;

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <Wordmark />
        <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft">
          Posición abierta
        </span>
      </div>

      <div className="mt-8">
        <H1>{evento.nombre}</H1>
        <Lede className="mt-2 mb-6">Tu posición está activa. Esto es lo que respondiste:</Lede>

        <div className="flex flex-col gap-2.5">
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Tu respuesta</span>
            <span className="text-sm font-medium">{posicion.respuesta === "si" ? "Sí" : "No"}</span>
          </Card>
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Premio potencial</span>
            <span className="font-display text-sm tabular-nums">
              $<Mono>{posicion.premio_potencial.toLocaleString("es-MX")}</Mono> MXN
            </span>
          </Card>
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Se resuelve en</span>
            <span className="font-display text-sm tabular-nums">{dias} días</span>
          </Card>
        </div>

        <div className="mt-8 rounded-2xl border border-dashed border-line p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.06em] text-ink-soft">Solo en modo demo</p>
          <SecondaryButton onClick={simularResultadoAhora} disabled={simulando}>
            {simulando ? "Resolviendo…" : "Simular resultado ahora"}
          </SecondaryButton>
        </div>
      </div>
    </Screen>
  );
}

export default function PosicionPage() {
  return (
    <Suspense fallback={null}>
      <PosicionContenido />
    </Suspense>
  );
}
