"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { EVENTOS, Posicion, Resultado } from "@/types";
import { Screen, Badge, H1, Lede, PrimaryButton, SecondaryButton, Card, Mono } from "@/components/ui";

// Pantalla 4 del loop (memo DG, Prioridad 1):
// "Posición: Tu respuesta · Premio potencial · Contador de días"
//
// Banxico decide tasas cada 42 días (documento de negocio §2.3) -- eso es
// lo que muestra el contador real. Pero el MVP tiene que poder probarse
// esta semana, no en 42 días: el botón "Simular resultado ahora" es
// exclusivo de modo demo y resuelve la posición al instante, ponderado por
// la probabilidad histórica del evento. En modo real este botón no existe
// -- ahí se espera al resultado real de Banxico.
const DIAS_CICLO_BANXICO = 42;

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

  async function simularResultadoAhora() {
    if (!posicion) return;
    setSimulando(true);

    const evento = EVENTOS.find((e) => e.id === posicion.evento_id) ?? EVENTOS[0];
    const ocurrio = Math.random() < evento.probabilidad;
    // "Ganaste" si acertaste si el evento ocurre o no, no solo si dijiste "sí".
    const acerto = (posicion.respuesta === "si") === ocurrio;
    const resultado: Resultado = acerto ? "gano" : "no_gano";

    const { error: updError } = await supabase
      .from("posiciones")
      .update({ estado: "resuelta", resultado, resuelta_en: new Date().toISOString() })
      .eq("id", posicion.id);
    if (updError) {
      setSimulando(false);
      alert("No se pudo resolver la posición. Intenta de nuevo.");
      return;
    }

    if (resultado === "gano") {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (user) {
        const { data: bal } = await supabase
          .from("balances")
          .select("demo_balance")
          .eq("user_id", user.id)
          .single();
        const nuevoBalance = (bal?.demo_balance ?? 0) + posicion.premio_potencial;
        await supabase.from("balances").update({ demo_balance: nuevoBalance }).eq("user_id", user.id);
      }
    }

    router.push(`/resultado?id=${posicion.id}`);
  }

  if (!posicion) return <Screen><p className="pt-8 text-ink-soft">Cargando tu posición…</p></Screen>;

  const evento = EVENTOS.find((e) => e.id === posicion.evento_id) ?? EVENTOS[0];

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <div className="font-display text-xl font-bold">PISO</div>
        <Badge>Posición abierta</Badge>
      </div>

      <div className="mt-8">
        <H1>{evento.nombre}</H1>
        <Lede>Tu posición está activa. Esto es lo que respondiste:</Lede>

        <div className="flex flex-col gap-2">
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Tu respuesta</span>
            <span className="text-sm font-medium">{posicion.respuesta === "si" ? "Sí" : "No"}</span>
          </Card>
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Premio potencial</span>
            <span className="font-mono text-sm tabular-nums">
              $<Mono>{posicion.premio_potencial.toLocaleString("es-MX")}</Mono> MXN
            </span>
          </Card>
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Se resuelve en</span>
            <span className="font-mono text-sm tabular-nums">{DIAS_CICLO_BANXICO} días</span>
          </Card>
        </div>

        <div className="mt-8 rounded-lg border border-dashed border-line p-4">
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
