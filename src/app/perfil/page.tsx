"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { obtenerPerfil, obtenerBalance } from "@/lib/demo";
import { trackFunnel } from "@/lib/posthog";
import { mensajeParaUsuario } from "@/lib/errores";
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
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);

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

  // Requisito del App Store (5.1.1(v)): borrar la cuenta desde la app.
  // eliminar_mi_cuenta() anonimiza (migración 0011) -- la historia
  // financiera se conserva sin datos personales, como pide Legal.
  async function eliminarCuenta() {
    setBorrando(true);
    setErrorBorrado(null);
    const { error } = await supabase.rpc("eliminar_mi_cuenta");
    if (error) {
      setBorrando(false);
      setErrorBorrado(mensajeParaUsuario(error, "No se pudo eliminar tu cuenta. Intenta de nuevo."));
      return;
    }
    await supabase.auth.signOut();
    router.replace("/");
  }

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

      <div className="mt-12 border-t border-line pt-6">
        {!confirmandoBorrado ? (
          <button onClick={() => setConfirmandoBorrado(true)} className="text-sm text-ink-soft underline underline-offset-2">
            Eliminar mi cuenta
          </button>
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-sm font-medium">¿Eliminar tu cuenta?</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
              Borramos tu correo y tus datos personales y ya no podrás entrar. Por ley guardamos el historial de
              movimientos sin tu nombre. Esto no se puede deshacer.
            </p>
            {errorBorrado && <p className="mt-3 text-sm text-red-500">{errorBorrado}</p>}
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setConfirmandoBorrado(false)}
                disabled={borrando}
                className="flex-1 rounded-card border border-line py-3 text-sm font-semibold text-ink-soft"
              >
                Cancelar
              </button>
              <button
                onClick={eliminarCuenta}
                disabled={borrando}
                className="flex-1 rounded-card bg-red-500/90 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {borrando ? "Eliminando…" : "Sí, eliminar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
