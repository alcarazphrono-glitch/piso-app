"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { obtenerBalance } from "@/lib/demo";
import { Screen, Wordmark, PracticeBar, PrimaryButton, SecondaryButton, ShieldCheckIcon } from "@/components/ui";

// Pantalla Home -- memo Behavioral, sección 1 ("Home — sin cambios de
// fondo"): el Dato 3 confirma que el drop-off NO está aquí, así que se
// implementa la especificación de DG tal cual (Main.dc.html), sin agregar
// ni quitar nada de fondo. Un solo flujo: capital protegido → Ver eventos.
// Los cinco pisos se movieron a /perfil, tal como pidió DG.

export default function HomePage() {
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      const bal = await obtenerBalance(user.id);
      setBalance(bal.demo_balance);
      setCargando(false);
    });
  }, [router]);

  if (cargando) return <Screen><p className="pt-8 text-ink-soft">Cargando tu piso…</p></Screen>;

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <Wordmark />
        {/* Acceso a /perfil (los 5 niveles) -- el lienzo de Behavioral no
            muestra este punto de entrada porque su mockup no incluye
            navegación, pero el memo de DG sí pide que los pisos vivan en
            su propia pantalla, así que necesita cómo llegar ahí. */}
        <Link
          href="/perfil"
          aria-label="Tu perfil"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-soft"
        >
          <ShieldCheckIcon className="h-4 w-4" />
        </Link>
      </div>

      <p className="mt-[22px] max-w-[280px] font-display text-[22px] font-semibold leading-[1.28] tracking-[-0.01em]">
        Tu dinero protegido. Tu criterio, tu ganancia.
      </p>
      <PracticeBar />

      <div className="mt-5 flex min-h-[46vh] flex-col justify-center">
        <div className="flex flex-col items-start gap-3.5 rounded-2xl border border-line bg-surface p-6 pt-7">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-mint-chip">
            <ShieldCheckIcon className="h-[22px] w-[22px] text-mint" />
          </div>
          <div>
            <p className="mb-1.5 font-display text-[19px] font-semibold tracking-[-0.005em]">
              Tu capital está protegido
            </p>
            <p className="text-sm leading-relaxed text-ink-soft">
              Depositas, participas en eventos reales, y recuperas tu dinero
              completo — ganes o no.
              {balance !== null && (
                <span className="mt-1 block font-display text-ink">
                  ${balance.toLocaleString("es-MX")} MXN protegidos ahora mismo.
                </span>
              )}
            </p>
          </div>
          <Link href="/eventos" className="mt-1.5 w-full">
            <PrimaryButton>Ver eventos</PrimaryButton>
          </Link>
          {/* Sistema de boletos por nivel (spec de Finanzas, 23-sep-2026) --
              se agrega como una segunda entrada, sin quitar "Ver eventos":
              decidir cuál es el CTA principal de Home es una decisión de
              producto/IA más grande que no le corresponde inventar a
              Tecnología sola -- queda pendiente de que Dirección General
              confirme si esto reemplaza el CTA principal (ver README). */}
          <Link href="/ciclos" className="w-full">
            <SecondaryButton>Boletos por nivel (Entrada/Crecimiento/Elite)</SecondaryButton>
          </Link>
        </div>

        <div className="mt-[18px] flex justify-center">
          <Link href="/trust-center" className="inline-flex items-center gap-1 text-[13px] font-medium text-mint">
            ¿Cómo funciona PISO?
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px]">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </div>
    </Screen>
  );
}
