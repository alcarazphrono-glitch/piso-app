"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { obtenerBalance, obtenerPerfil } from "@/lib/demo";
import { trackFunnel } from "@/lib/posthog";
import { PISOS, PisoNombre } from "@/types";
import { Screen, Badge, PrimaryButton, Card, Mono, LockIcon } from "@/components/ui";

// Pantalla 1 del loop (memo DG, Prioridad 1):
// "Home: Tu piso · Capital protegido · [Ver eventos]"

export default function HomePage() {
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

  if (cargando) return <Screen><p className="pt-8 text-ink-soft">Cargando tu piso…</p></Screen>;

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <div className="font-display text-xl font-bold">PISO</div>
        <Badge>Modo demo</Badge>
      </div>

      <div className="mt-8">
        <p className="text-sm text-ink-soft">Tu piso</p>
        <p className="mt-1 font-display text-3xl font-bold capitalize">{piso}</p>

        <Card className="mt-5">
          <p className="text-xs uppercase tracking-[0.06em] text-ink-soft">Capital protegido</p>
          <p className="mt-1 font-mono text-2xl tabular-nums">
            $<Mono>{balance?.toLocaleString("es-MX")}</Mono> <span className="text-base text-ink-soft">MXN</span>
          </p>
        </Card>

        <Link href="/evento/banxico_baja_tasas">
          <PrimaryButton className="mt-6">Ver eventos</PrimaryButton>
        </Link>
      </div>

      <div className="mt-10">
        <p className="mb-3 text-xs uppercase tracking-[0.06em] text-ink-soft">Tus niveles</p>
        <div className="flex flex-col gap-2">
          {PISOS.map((p) => (
            <div
              key={p.nombre}
              onClick={() => !p.activo && onClicPisoBloqueado(p.nombre)}
              className={`flex items-center justify-between rounded-lg border border-line px-4 py-3 ${
                p.activo ? "bg-surface" : "cursor-pointer bg-surface/50 opacity-60"
              }`}
            >
              <span className="text-sm font-medium capitalize">{p.nombre}</span>
              {p.activo ? (
                <span className="font-mono text-xs tabular-nums text-ink-soft">${p.deposito_min}</span>
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
