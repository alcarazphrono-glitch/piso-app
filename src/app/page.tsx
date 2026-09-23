"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Screen, Wordmark, H1, Lede, PrimaryButton } from "@/components/ui";

// Pantalla pública de entrada. No está en el lienzo de Behavioral (su
// Main.dc.html es la pantalla Home, ya autenticada) -- se reconstruye con
// el mismo sistema visual nuevo por consistencia de marca, conservando su
// propio copy porque el memo no la tocó.
export default function EntradaPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/home");
    });
  }, [router]);

  return (
    <Screen>
      <div className="pt-2">
        <Wordmark />
      </div>

      <div className="mt-10">
        <H1 className="max-w-[300px] text-[28px]">
          Tu dinero protegido. Tu criterio, tu ganancia.
        </H1>
        <Lede className="mt-4 max-w-[320px]">
          Depositas, tu capital nunca se arriesga, y decides si le entras a un
          evento económico real. Ganes o no, tu piso sigue intacto.
        </Lede>
        <Link href="/auth">
          <PrimaryButton className="mt-6">Probar PISO</PrimaryButton>
        </Link>
      </div>
    </Screen>
  );
}
