"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Screen, Eyebrow, H1, Lede, PrimaryButton, Badge } from "@/components/ui";

// Prioridad 6 del memo de DG: el tagline cambia. Antes: "la tanda donde
// nunca pierdes tu turno" (ver piso_fase1/experiment_config.py, T1 -- ese
// era el copy del experimento de Meta Ads de Fase 1, un track distinto).
// Este es el copy del producto en sí, no de un anuncio.
export default function EntradaPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/home");
    });
  }, [router]);

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <div className="font-display text-xl font-bold">PISO</div>
        <Badge>Capital protegido</Badge>
      </div>

      <div className="mt-10">
        <Eyebrow>Protege tu piso. Ve por más.</Eyebrow>
        <H1>Tu dinero está protegido. Tú decides qué hacer con su potencial.</H1>
        <Lede>
          Depositas, tu capital nunca se arriesga, y decides si le entras a un
          evento económico real. Ganes o no, tu piso sigue intacto.
        </Lede>
        <Link href="/auth">
          <PrimaryButton>Probar PISO</PrimaryButton>
        </Link>
      </div>
    </Screen>
  );
}
