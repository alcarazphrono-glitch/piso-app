"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { obtenerBoleto, obtenerCiclo, Boleto, CicloConProducto } from "@/lib/boletos";
import { Screen, Wordmark, H1, Lede, PrimaryButton, Card, Mono } from "@/components/ui";

// Pantalla de "tu boleto está adentro" -- a diferencia de /posicion, aquí
// no hay un botón de "Simular resultado ahora": resolver_ciclo() es
// exclusivo de un operador (D2-adjacent: el resultado real lo confirma un
// humano, con fuente y evidencia), y además depende de que el NIVEL
// COMPLETO se llene, no solo de este boleto. Mientras tanto, esta pantalla
// es de espera -- se refresca sola para reflejar el avance del aforo.

function BoletoContenido() {
  const router = useRouter();
  const params = useSearchParams();
  const boletoId = params.get("id");
  const [boleto, setBoleto] = useState<Boleto | null>(null);
  const [ciclo, setCiclo] = useState<CicloConProducto | null>(null);

  async function cargar() {
    if (!boletoId) return;
    const b = await obtenerBoleto(boletoId);
    if (!b) return;
    setBoleto(b);
    setCiclo(await obtenerCiclo(b.ciclo_id));
  }

  useEffect(() => {
    if (!boletoId) return;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace("/auth");
        return;
      }
      await cargar();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boletoId, router]);

  useEffect(() => {
    if (!boleto) return;
    if (boleto.acerto !== null) {
      router.replace(`/boleto-resultado?id=${boleto.id}`);
      return;
    }
    const intervalo = setInterval(cargar, 15000); // refresco pasivo de avance de aforo
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boleto?.acerto]);

  if (!boleto || !ciclo) return <Screen><p className="pt-8 text-ink-soft">Cargando tu boleto…</p></Screen>;

  const faltan = Math.max(0, ciclo.producto.gente_requerida - ciclo.lugares_ocupados);
  const pct = Math.min(100, (ciclo.lugares_ocupados / ciclo.producto.gente_requerida) * 100);

  if (ciclo.estado === "cancelado") {
    return (
      <Screen>
        <div className="flex items-center justify-between pt-2">
          <Wordmark />
        </div>
        <H1 className="mt-8">Este nivel no se llenó a tiempo</H1>
        <Lede className="mt-2 mb-6">Se canceló y tu depósito ya regresó completo a tu piso.</Lede>
        <PrimaryButton onClick={() => router.push("/ciclos")}>Ver otros niveles</PrimaryButton>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <Wordmark />
        <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft">
          Boleto activo
        </span>
      </div>

      <div className="mt-8">
        <H1>{ciclo.producto.nombre}</H1>
        <Lede className="mt-2 mb-6">
          {ciclo.estado === "lleno"
            ? "El nivel ya se llenó -- en espera de que se confirme el resultado real."
            : "Tu boleto está adentro. Esto es lo que respondiste:"}
        </Lede>

        <div className="flex flex-col gap-2.5">
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Tu respuesta</span>
            <span className="text-sm font-medium">{boleto.respuesta === "si" ? "Sí" : "No"}</span>
          </Card>
          <Card className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">Tu depósito</span>
            <span className="font-display text-sm tabular-nums">
              $<Mono>{boleto.monto.toLocaleString("es-MX")}</Mono> MXN -- regresa completo
            </span>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-soft">Avance del nivel</span>
              <span className="text-sm font-medium">{ciclo.estado === "lleno" ? "Lleno" : `Faltan ${faltan.toLocaleString("es-MX")}`}</span>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-mint" style={{ width: `${pct}%` }} />
            </div>
          </Card>
        </div>

        <p className="mt-6 text-xs text-ink-soft">
          Cuando el nivel se llena, un operador confirma el resultado real y se sortea el premio entre quienes
          acertaron. Tu depósito regresa completo de cualquier forma.
        </p>
      </div>
    </Screen>
  );
}

export default function BoletoPage() {
  return (
    <Suspense fallback={null}>
      <BoletoContenido />
    </Suspense>
  );
}
