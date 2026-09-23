"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { obtenerCiclosActivos, CicloConProducto } from "@/lib/boletos";
import { Screen, BackChevron, H1, ShieldIcon } from "@/components/ui";

// Lista de ciclos activos del sistema de boletos por nivel (spec de
// Finanzas, 23-sep-2026). Agrupados por nivel -- Entrada/Crecimiento/Elite
// -- con "faltan N lugares" como única señal de avance. A propósito NO se
// muestra una cuenta regresiva de días: el memo de Finanzas es explícito
// en que la fecha de resolución es un peor-caso (si se llena antes, se
// juega antes), no una promesa de cuándo -- mostrar días quedaría
// contradiciendo esa mecánica.

const NIVEL_ORDEN: Record<string, number> = { entrada: 0, crecimiento: 1, elite: 2 };

export default function CiclosPage() {
  const router = useRouter();
  const [ciclos, setCiclos] = useState<CicloConProducto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace("/auth");
        return;
      }
      try {
        setCiclos(await obtenerCiclosActivos());
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudieron cargar los ciclos.");
      } finally {
        setCargando(false);
      }
    });
  }, [router]);

  if (cargando) return <Screen><p className="pt-8 text-ink-soft">Cargando niveles…</p></Screen>;
  if (error) return <Screen><p className="pt-8 text-sm text-red-500">{error}</p></Screen>;

  const ordenados = [...ciclos].sort((a, b) => NIVEL_ORDEN[a.producto_clave] - NIVEL_ORDEN[b.producto_clave]);

  return (
    <Screen>
      <div className="flex items-center gap-3.5 pt-2">
        <BackChevron onClick={() => router.push("/home")} />
        <H1 className="text-[19px]">Boletos por nivel</H1>
      </div>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
        Elige un nivel, responde sí o no a un evento real. Cuando el nivel se llena, se sortea un premio entre
        quienes acertaron -- y tu depósito regresa completo, ganes o no.
      </p>

      <div className="mt-7 flex flex-col gap-3.5">
        {ordenados.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-soft">
            No hay niveles abiertos en este momento.
          </p>
        )}
        {ordenados.map((c) => {
          const pct = Math.min(100, (c.lugares_ocupados / c.producto.gente_requerida) * 100);
          const faltan = Math.max(0, c.producto.gente_requerida - c.lugares_ocupados);
          return (
            <Link
              key={c.id}
              href={`/ciclo/${c.id}`}
              className="block rounded-2xl border border-line bg-surface p-5"
            >
              <div className="flex items-center justify-between">
                <p className="font-display text-[17px] font-semibold">{c.producto.nombre}</p>
                <span className="flex items-center gap-1.5 rounded-full bg-mint-chip px-3 py-1 text-xs font-semibold text-mint">
                  <ShieldIcon className="h-3 w-3" strokeWidth={2.2} /> ${c.producto.precio.toLocaleString("es-MX")}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">{c.evento_nombre}</p>

              <div className="mt-4 flex items-center gap-3">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-mint" style={{ width: `${pct}%` }} />
                </div>
                <span className="shrink-0 text-[12.5px] font-medium text-ink-soft">
                  {c.estado === "lleno" ? "Lleno -- por resolverse" : `Faltan ${faltan.toLocaleString("es-MX")} lugares`}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}
