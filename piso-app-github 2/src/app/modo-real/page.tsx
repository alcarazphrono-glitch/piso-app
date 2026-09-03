"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { registrarInteresModoReal } from "@/lib/demo";
import { trackFunnel } from "@/lib/posthog";
import { Screen, ShieldIcon, MailIcon } from "@/components/ui";

// Pantalla Modo real -- memo Behavioral, sección 5. DG pedía un modal;
// Behavioral lo cambió a pantalla completa porque el Dato 5 (interés
// orgánico <1.8%) dice que no hay demanda existente de la que apalancarse
// -- el copy tiene que generar la conversión solo, y un modal se cierra
// sin pensarlo. Se agregó el badge de "acceso anticipado limitado" para
// dar urgencia sin inventar cifras de demanda que no se tienen.

function ModoRealContenido() {
  const router = useRouter();
  const params = useSearchParams();
  const premio = params.get("premio");

  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      await registrarInteresModoReal(user.id, email);
      trackFunnel("quiere_modo_real", { desde: "modo_real_form", email });
      setEnviado(true);
    } catch {
      setError("No se pudo guardar tu correo. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Screen>
      <div className="flex items-center gap-1.5 self-start rounded-full bg-mint-chip px-3 py-1.5">
        <ShieldIcon className="h-[13px] w-[13px] text-mint" strokeWidth={2} />
        <span className="text-xs font-semibold text-mint">Acceso anticipado limitado</span>
      </div>

      <div className="flex min-h-[60vh] flex-col justify-center gap-4">
        <h1 className="font-display text-[28px] font-bold leading-[1.2] tracking-[-0.01em]">
          ¿Listo para el modo real?
        </h1>
        <p className="max-w-[310px] text-[15px] leading-relaxed text-ink-soft">
          En PISO real, {premio ? <>esos <strong className="font-semibold text-ink">${Number(premio).toLocaleString("es-MX")}</strong></> : "ese premio"} hubieran sido tuyos. Déjanos tu correo — te avisamos primero.
        </p>
      </div>

      {enviado ? (
        <div className="rounded-2xl border border-line bg-surface p-5 text-sm text-ink-soft">
          Listo — ya guardamos que te interesa. Te avisamos en cuanto esté listo.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex h-[54px] items-center gap-2.5 rounded-card border border-line bg-surface px-4">
            <MailIcon className="h-[18px] w-[18px] text-faint" />
            <input
              type="email"
              required
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
            />
          </div>
          {error && <p className="text-sm text-[oklch(72%_0.17_25)]">{error}</p>}
          <button
            type="submit"
            disabled={enviando}
            className="h-[56px] w-full rounded-card bg-mint font-body text-[16.5px] font-bold text-mint-ink disabled:opacity-40"
          >
            {enviando ? "Guardando…" : "Quiero ser el primero"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/eventos")}
            className="mt-0.5 text-center text-[13px] text-ink-soft"
          >
            Seguir explorando en modo práctica →
          </button>
        </form>
      )}
    </Screen>
  );
}

export default function ModoRealPage() {
  return (
    <Suspense fallback={null}>
      <ModoRealContenido />
    </Suspense>
  );
}
