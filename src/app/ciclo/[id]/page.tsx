"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { posthog } from "@/lib/posthog";
import { obtenerRacha } from "@/lib/demo";
import { obtenerCiclo, comprarBoleto, obtenerMiBoletoEnCiclo, calcularTicketPromedioHistorico, CicloConProducto } from "@/lib/boletos";
import { Respuesta } from "@/types";
import { Screen, BackChevron, RachaBadge, H1, PrimaryButton, ShieldIcon, CalendarIcon } from "@/components/ui";

// Pantalla de un ciclo -- responder sí/no y comprar un boleto. Mismo
// lenguaje visual que /evento/[id], pero el modelo es distinto: aquí SÍ se
// debita el depósito (comprar_boleto lo regresa completo al resolver, no
// lo evita tocar). Incluye la "responsibility condition" de la sección 7
// del memo de Finanzas (vía Behavioral): fricción suave y OBLIGATORIA
// antes de comprar un boleto mucho más grande de lo que el usuario
// acostumbra -- no es opcional, así que el botón de confirmar se queda
// deshabilitado hasta que se marca la casilla.

export default function CicloPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [racha, setRacha] = useState(0);
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [comprando, setComprando] = useState(false);
  const [ciclo, setCiclo] = useState<CicloConProducto | null | undefined>(undefined);
  const [ticketPromedio, setTicketPromedio] = useState<number | null>(null);
  const [confirmaMontoMayor, setConfirmaMontoMayor] = useState(false);
  const [errorCompra, setErrorCompra] = useState<string | null>(null);

  useEffect(() => {
    if (typeof params.id !== "string") return;
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/auth");
        return;
      }
      setUserId(user.id);

      // Si ya tiene un boleto en este ciclo, no lo dejamos volver a
      // intentar comprar -- comprar_boleto() ya lo rechaza server-side
      // (unique ciclo_id/user_id), pero mandarlo directo a su boleto evita
      // el error crudo, mismo criterio que /evento/[id].
      const existente = await obtenerMiBoletoEnCiclo(params.id as string, user.id);
      if (existente) {
        router.replace(`/boleto?id=${existente.id}`);
        return;
      }

      const [c, r, promedio] = await Promise.all([
        obtenerCiclo(params.id as string),
        obtenerRacha(user.id),
        calcularTicketPromedioHistorico(user.id),
      ]);
      setCiclo(c);
      setRacha(r);
      setTicketPromedio(promedio);
    });
  }, [params.id, router]);

  async function confirmar() {
    if (!ciclo || !respuesta || !userId) return;
    if (requiereConfirmacionExtra && !confirmaMontoMayor) return;
    setComprando(true);
    setErrorCompra(null);

    try {
      const boleto = await comprarBoleto(ciclo.id, respuesta);
      // No es uno de los pasos del funnel de DG (src/lib/posthog.ts) --
      // se captura aparte, sin forzar este evento nuevo dentro de ese
      // enum cerrado.
      posthog.capture("boleto_comprado", {
        ciclo_id: ciclo.id,
        producto: ciclo.producto_clave,
        respuesta,
        monto: ciclo.producto.precio,
        timestamp: new Date().toISOString(),
      });
      router.push(`/boleto?id=${boleto.id}`);
    } catch (e) {
      setComprando(false);
      setErrorCompra(e instanceof Error ? e.message : "No se pudo comprar el boleto. Intenta de nuevo.");
    }
  }

  if (userId === null || ciclo === undefined) return null;

  if (!ciclo) {
    return (
      <Screen>
        <div className="flex items-center gap-3.5 pt-2">
          <BackChevron onClick={() => router.push("/ciclos")} />
        </div>
        <div className="mt-10">
          <H1>Este nivel ya no está disponible</H1>
          <button onClick={() => router.push("/ciclos")} className="mt-6">
            <PrimaryButton>Ver otros niveles</PrimaryButton>
          </button>
        </div>
      </Screen>
    );
  }

  const requiereConfirmacionExtra = ticketPromedio != null && ciclo.producto.precio > ticketPromedio * 3;
  const faltan = Math.max(0, ciclo.producto.gente_requerida - ciclo.lugares_ocupados);
  const puedeConfirmar = Boolean(respuesta) && !comprando && ciclo.estado === "llenando" && (!requiereConfirmacionExtra || confirmaMontoMayor);

  return (
    <Screen>
      <div className="flex items-center justify-between pt-2">
        <BackChevron onClick={() => router.push("/ciclos")} />
        <RachaBadge n={racha} />
      </div>

      <div className="mt-5">
        <div className="mb-2.5 flex items-center gap-1.5">
          <CalendarIcon className="h-[15px] w-[15px] text-ink-soft" />
          <span className="text-xs font-semibold uppercase tracking-[0.02em] text-ink-soft">{ciclo.producto.nombre}</span>
        </div>
        <H1>{ciclo.evento_nombre}</H1>
        <p className="mt-3 text-[13px] text-ink-soft">Faltan {faltan.toLocaleString("es-MX")} lugares para que este nivel se juegue.</p>
      </div>

      <div className="mt-5">
        <p className="mb-2.5 text-sm font-medium">¿Va a ocurrir?</p>
        <div className="flex gap-3">
          <button
            onClick={() => setRespuesta("si")}
            className={`flex-1 rounded-card border py-3.5 text-sm font-semibold transition-colors ${
              respuesta === "si" ? "border-mint bg-mint-chip text-mint" : "border-line bg-surface text-ink-soft"
            }`}
          >
            Sí
          </button>
          <button
            onClick={() => setRespuesta("no")}
            className={`flex-1 rounded-card border py-3.5 text-sm font-semibold transition-colors ${
              respuesta === "no" ? "border-mint bg-mint-chip text-mint" : "border-line bg-surface text-ink-soft"
            }`}
          >
            No
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-ink-soft">Depósito de este boleto</span>
          <span className="flex items-center gap-1.5 font-display text-base font-semibold">
            ${ciclo.producto.precio.toLocaleString("es-MX")}
            <ShieldIcon className="h-3.5 w-3.5 text-mint" strokeWidth={1.9} />
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-line py-2">
          <span className="text-sm text-ink-soft">Si el nivel se llena</span>
          <span className="text-sm font-medium">Se sortea un premio entre los aciertos</span>
        </div>
        <div className="flex items-center justify-between border-t border-line py-2">
          <span className="text-sm text-ink-soft">Tu depósito</span>
          <span className="font-display text-base font-bold">Regresa completo, ganes o no</span>
        </div>
      </div>

      {requiereConfirmacionExtra && (
        <label className="mt-4 flex items-start gap-2.5 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-800">
          <input
            type="checkbox"
            checked={confirmaMontoMayor}
            onChange={(e) => setConfirmaMontoMayor(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Este boleto (${ciclo.producto.precio.toLocaleString("es-MX")}) es bastante más grande de lo que sueles
            depositar. Entiendo el monto y quiero continuar.
          </span>
        </label>
      )}

      {errorCompra && <p className="mt-3 text-sm text-red-500">{errorCompra}</p>}

      <PrimaryButton className="mt-6" onClick={confirmar} disabled={!puedeConfirmar}>
        {comprando ? "Comprando…" : "Comprar boleto"}
      </PrimaryButton>
      <p className="mt-3 text-center text-xs text-faint">Puedes retirar tu depósito completo cuando se resuelva el nivel.</p>
    </Screen>
  );
}
