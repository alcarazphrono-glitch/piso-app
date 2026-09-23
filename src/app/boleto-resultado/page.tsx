"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { obtenerRacha } from "@/lib/demo";
import { obtenerBoleto, obtenerCiclo, Boleto, CicloConProducto } from "@/lib/boletos";
import { Screen, BackChevron, RachaBadge, H1, InkButton, PrimaryButton, ShieldIcon } from "@/components/ui";

// Resultado del sorteo -- tres estados posibles, no dos como en /resultado:
// (1) ganaste el sorteo, (2) acertaste pero el sorteo no te tocó, (3) no
// acertaste. En los tres, el depósito regresa al 100% -- eso es lo que
// sostiene la promesa de capital protegido en este modelo (a diferencia de
// `posiciones`, donde nunca se toca el capital porque nunca se debita).

interface Resolucion {
  resultado: "si" | "no";
  premio_pagado: number | null;
  ganador_boleto_id: string | null;
}

function BoletoResultadoContenido() {
  const router = useRouter();
  const params = useSearchParams();
  const boletoId = params.get("id");

  const [boleto, setBoleto] = useState<Boleto | null>(null);
  const [ciclo, setCiclo] = useState<CicloConProducto | null>(null);
  const [resolucion, setResolucion] = useState<Resolucion | null>(null);
  const [racha, setRacha] = useState(0);

  useEffect(() => {
    if (!boletoId) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      const b = await obtenerBoleto(boletoId);
      if (!b) return;
      setBoleto(b);
      const [c, { data: res }, r] = await Promise.all([
        obtenerCiclo(b.ciclo_id),
        supabase.from("ciclo_resoluciones").select("resultado, premio_pagado, ganador_boleto_id").eq("ciclo_id", b.ciclo_id).order("resuelto_en", { ascending: false }).limit(1).maybeSingle(),
        obtenerRacha(user.id),
      ]);
      setCiclo(c);
      setResolucion(res as Resolucion | null);
      setRacha(r);
    });
  }, [boletoId, router]);

  if (!boleto || !ciclo) return <Screen><p className="pt-8 text-ink-soft">Cargando resultado…</p></Screen>;

  const ganasteSorteo = boleto.ganador === true;
  const acertaste = boleto.acerto === true;

  // -------------------------------------------------------- GANASTE EL SORTEO
  if (ganasteSorteo) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[460px] flex-col items-center bg-ganaste-bg px-6 pb-16 pt-7 text-ganaste-ink">
        <RachaBadge n={racha} tone="light" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 text-center">
          <p className="font-display text-[42px] font-bold leading-none tracking-[-0.02em]">
            +${(resolucion?.premio_pagado ?? 0).toLocaleString("es-MX")}
            <br />
            MXN
          </p>
          <p className="max-w-[250px] text-base leading-relaxed text-ganaste-ink-soft">
            Ganaste el sorteo de {ciclo.producto.nombre}. Acertaste, y te tocó el premio.
          </p>
        </div>
        <div className="mb-4 flex w-full items-center justify-between rounded-2xl border border-ganaste-card-border bg-ganaste-card p-[18px]">
          <div>
            <p className="mb-1 text-[12.5px] text-ganaste-ink-soft">Tu depósito</p>
            <p className="font-display text-[19px] font-bold">${boleto.monto.toLocaleString("es-MX")} MXN</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-ganaste-chip px-3 py-2">
            <ShieldIcon className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="text-[13px] font-semibold">Regresó completo</span>
          </div>
        </div>
        <InkButton onClick={() => router.push("/ciclos")}>Ver otros niveles</InkButton>
      </main>
    );
  }

  // ------------------------------------------------------------------ NO GANASTE
  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <BackChevron onClick={() => router.push("/home")} />
        <RachaBadge n={racha} />
      </div>

      <H1 className="mt-[26px] max-w-[300px] text-[25px]">
        {acertaste ? "Acertaste, pero el sorteo no te tocó." : "Esta vez no acertaste."}
        <br />
        Tu depósito sigue ahí.
      </H1>

      <div className="mt-5 flex items-center justify-between rounded-2xl border border-line bg-surface p-[18px]">
        <div>
          <p className="mb-1 text-[12.5px] text-ink-soft">Tu depósito</p>
          <p className="font-display text-[19px] font-bold">${boleto.monto.toLocaleString("es-MX")} MXN</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-mint-chip px-3 py-2">
          <ShieldIcon className="h-3.5 w-3.5 text-mint" strokeWidth={2} />
          <span className="text-[13px] font-semibold text-mint">Regresó completo</span>
        </div>
      </div>

      <p className="ml-0.5 mt-3.5 text-[13px] text-ink-soft">
        {acertaste
          ? "Acertaste la predicción -- solo un boleto se lleva el sorteo cada vez. Tu racha sigue viva."
          : "Tu racha sigue viva si entras a otro nivel hoy."}
      </p>

      <PrimaryButton className="mt-8" onClick={() => router.push("/ciclos")}>
        Ver otros niveles
      </PrimaryButton>
    </Screen>
  );
}

export default function BoletoResultadoPage() {
  return (
    <Suspense fallback={null}>
      <BoletoResultadoContenido />
    </Suspense>
  );
}
