"use client";

// PISO Core V1 -- Configuración (parámetros del modelo). Segunda pantalla
// del panel de administración, junto a Event Manager -- ver migración
// 0004_parametros_pricing.sql. Antes de esto, "cambiar el multiplicador
// del premio demo" era editar config.ts y esperar un deploy; ahora es
// este formulario.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { obtenerParametrosPricing, actualizarParametrosPricing, ParametrosPricing } from "@/lib/parametros";
import { mensajeError } from "@/lib/errores";

export default function AdminConfiguracionPage() {
  const router = useRouter();
  const [autenticado, setAutenticado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [parametros, setParametros] = useState<ParametrosPricing | null>(null);

  async function cargar() {
    setCargando(true);
    try {
      const p = await obtenerParametrosPricing();
      setParametros(p);
      setError(null);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/auth");
        return;
      }
      setAutenticado(true);
      cargar();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!parametros) return;
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      await actualizarParametrosPricing({
        ticket_demo_mxn: parametros.ticket_demo_mxn,
        multiplicador_demo: parametros.multiplicador_demo,
        float_pct: parametros.float_pct,
        carry_pct: parametros.carry_pct,
        cetes_rate_anual: parametros.cetes_rate_anual,
      });
      await cargar();
      setOk(true);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  }

  if (!autenticado) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-sm">
      <h1 className="text-xl font-bold">PISO Core -- Configuración</h1>
      <p className="mt-1 text-ink-soft">
        Variables que alimentan el modelo de pricing. Cambiar esto no requiere código ni deploy --
        calcular_premio_potencial() las lee en cada evento sin premio fijado a mano.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>
      )}
      {ok && !error && (
        <div className="mt-4 rounded-lg border border-mint bg-mint-chip p-3 text-mint">Guardado.</div>
      )}

      {cargando || !parametros ? (
        <p className="mt-6 text-ink-soft">Cargando…</p>
      ) : (
        <form onSubmit={guardar} className="mt-6 flex flex-col gap-5">
          <section className="rounded-2xl border border-line p-5">
            <h2 className="font-semibold">Demo (vigente hoy)</h2>
            <p className="mt-1 text-xs text-ink-soft">
              Usadas por cualquier evento sin un premio fijado a mano en Event Manager.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="col-span-1 flex flex-col gap-1">
                <span className="text-xs text-ink-soft">Ticket demo (MXN)</span>
                <input
                  type="number"
                  className="rounded-lg border border-line px-3 py-2"
                  value={parametros.ticket_demo_mxn}
                  onChange={(e) => setParametros({ ...parametros, ticket_demo_mxn: Number(e.target.value) })}
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1">
                <span className="text-xs text-ink-soft">Multiplicador demo</span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded-lg border border-line px-3 py-2"
                  value={parametros.multiplicador_demo}
                  onChange={(e) => setParametros({ ...parametros, multiplicador_demo: Number(e.target.value) })}
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-dashed border-line p-5">
            <h2 className="font-semibold">Motor real (pendiente de Finanzas)</h2>
            <p className="mt-1 text-xs text-ink-soft">
              Campos para piso_fase0/pricing_engine.py (float % / carry % sobre CETES) -- todavía sin
              conectar a ningún cálculo. Ya existen para que, cuando Finanzas confirme cifras, sea
              llenar esto y no una migración nueva.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <label className="col-span-1 flex flex-col gap-1">
                <span className="text-xs text-ink-soft">Float %</span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded-lg border border-line px-3 py-2"
                  value={parametros.float_pct ?? ""}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      float_pct: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1">
                <span className="text-xs text-ink-soft">Carry %</span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded-lg border border-line px-3 py-2"
                  value={parametros.carry_pct ?? ""}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      carry_pct: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1">
                <span className="text-xs text-ink-soft">CETES anual %</span>
                <input
                  type="number"
                  step="0.01"
                  className="rounded-lg border border-line px-3 py-2"
                  value={parametros.cetes_rate_anual ?? ""}
                  onChange={(e) =>
                    setParametros({
                      ...parametros,
                      cetes_rate_anual: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          </section>

          <p className="text-xs text-ink-soft">
            Última actualización: {new Date(parametros.actualizado_en).toLocaleString("es-MX")}
          </p>

          <button
            type="submit"
            disabled={guardando}
            className="rounded-lg bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </form>
      )}
    </main>
  );
}
