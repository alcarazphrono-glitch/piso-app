"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { obtenerPerfil, obtenerBalance } from "@/lib/demo";
import { trackFunnel } from "@/lib/posthog";
import { PISOS, PisoNombre } from "@/types";
import { Screen, BackChevron, H1, Card, Mono, LockIcon } from "@/components/ui";

// Pantalla de perfil -- memo Behavioral, sección 1: DG pidió sacar los
// cinco pisos del Home a su propia pantalla, dejando el Home con un solo
// flujo (capital protegido → Ver eventos). Esta pantalla no está en el
// lienzo publicado por Behavioral (su Main.dc.html es solo el Home), así
// que se reconstruye con el mismo sistema visual, misma lógica que antes.

export default function PerfilPage() {
  const router = useRouter();
  const [piso, setPiso] = useState<PisoNombre | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      const [perfil, bal] = await Promise.all([obtenerPerfil(user.id), obtenerBalance(user.id)]);
      setPiso(perfil.piso as PisoNombre);
      setBalance(bal.demo_balance);
      setCargando(false);
    });
  }, [router]);

  function onClicPisoBloqueado(nombre: string) {
    trackFunnel("quiere_subir_piso", { piso_deseado: nombre });
  }

  if (cargando) return <Screen><p className="pt-8 text-ink-soft">Cargando tu perfil…</p></Screen>;

  return (
    <Screen>
      <div className="flex items-center gap-3.5 pt-2">
        <BackChevron onClick={() => router.push("/home")} />
        <H1 className="text-[19px]">Tu perfil</H1>
      </div>

      <div className="mt-6">
        <p className="text-sm text-ink-soft">Tu piso</p>
        <p className="mt-1 font-display text-2xl font-bold capitalize">{piso}</p>

        <Card className="mt-4">
          <p className="text-xs uppercase tracking-[0.06em] text-ink-soft">Capital protegido</p>
          <p className="mt-1 font-display text-2xl tabular-nums">
            $<Mono>{balance?.toLocaleString("es-MX")}</Mono> <span className="text-base text-ink-soft">MXN</span>
          </p>
        </Card>
      </div>

      <div className="mt-8">
        <p className="mb-3 text-xs uppercase tracking-[0.06em] text-ink-soft">Tus niveles</p>
        <div className="flex flex-col gap-2">
          {PISOS.map((p) => (
            <div
              key={p.nombre}
              onClick={() => !p.activo && onClicPisoBloqueado(p.nombre)}
              className={`flex items-center justify-between rounded-2xl border border-line px-4 py-3.5 ${
                p.activo ? "bg-surface" : "cursor-pointer bg-surface/60 opacity-60"
              }`}
            >
              <span className="text-sm font-medium capitalize">{p.nombre}</span>
              {p.activo ? (
                <span className="font-display text-xs tabular-nums text-ink-soft">${p.deposito_min}</span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-ink-soft">
                  <LockIcon /> Próximamente
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
