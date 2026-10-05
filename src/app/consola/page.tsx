"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { cargarEscenario } from "@/lib/economia/cargar";
import { calcular, NIVELES, type Resultado } from "@/lib/economia/modelo";

// Resumen de la consola financiera: la foto del negocio en una pantalla.
// Todo sale de datos reales (calcular_exposicion_global, ciclos, mesa);
// lo que falta de Finanzas se marca como pendiente, nunca se rellena.

interface Exposicion {
  capital_en_pool: number;
  premios_en_riesgo: number;
  reserva_minima: number;
  reserva_fondeada: number | null;
  kill_switch_activo: boolean;
}

interface CicloActivo {
  id: string;
  producto_clave: string;
  evento_id: string;
  lugares_ocupados: number;
  estado: string;
  fecha_resolucion: string;
  productos: { nombre: string; gente_requerida: number; precio: number } | null;
}

interface Nivel {
  clave: string;
  nombre: string;
  precio: number;
  gente_requerida: number;
  dias_resolucion: number;
  alpha_em: number | null;
}

const mxn = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(Number(n)).toLocaleString("es-MX")}`);
const DIA = 86_400_000;

export default function ConsolaResumen() {
  const [exp, setExp] = useState<Exposicion | null>(null);
  const [ciclos, setCiclos] = useState<CicloActivo[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [tasa, setTasa] = useState<number | null>(null);
  const [eco, setEco] = useState<{ r: Resultado; supuestos: string[] } | null>(null);
  const [mesa, setMesa] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      const [r1, r2, r3, r4, r5, r6] = await Promise.all([
        supabase.rpc("calcular_exposicion_global"),
        supabase
          .from("ciclos")
          .select("id, producto_clave, evento_id, lugares_ocupados, estado, fecha_resolucion, productos(nombre, gente_requerida, precio)")
          .in("estado", ["llenando", "lleno"])
          .order("fecha_resolucion"),
        supabase.from("productos").select("clave, nombre, precio, gente_requerida, dias_resolucion, alpha_em").order("precio"),
        supabase.from("parametros_pricing").select("tasa_cetes_anual").maybeSingle(),
        supabase.from("mesa_propuestas").select("estado").in("estado", ["pendiente", "aceptada", "aprobada_riesgo"]),
        cargarEscenario(supabase).catch(() => null),
      ]);
      if (r6) setEco({ r: calcular(r6.escenario), supuestos: r6.supuestos });
      setExp(r1.data?.[0] ?? null);
      setCiclos((r2.data as unknown as CicloActivo[]) ?? []);
      setNiveles((r3.data as Nivel[]) ?? []);
      setTasa(r4.data?.tasa_cetes_anual ?? null);
      const conteo: Record<string, number> = {};
      for (const p of (r5.data as { estado: string }[]) ?? []) conteo[p.estado] = (conteo[p.estado] ?? 0) + 1;
      setMesa(conteo);
      setCargando(false);
    })();
  }, []);

  if (cargando) return <p className="text-sm text-neutral-500">Cargando…</p>;

  const cobertura = exp?.reserva_fondeada ? exp.reserva_fondeada / Math.max(1, exp.premios_en_riesgo) : null;
  const porRevisar = (mesa.pendiente ?? 0) + (mesa.aceptada ?? 0) + (mesa.aprobada_riesgo ?? 0);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-lg font-semibold">Resumen</h1>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Capital de usuarios en pool" valor={mxn(exp?.capital_en_pool)} nota="Protegido: se devuelve completo" />
          <Kpi label="Premios en riesgo" valor={mxn(exp?.premios_en_riesgo)} />
          <Kpi label="Reserva mínima recomendada" valor={mxn(exp?.reserva_minima)} />
          <Kpi
            label="Reserva fondeada"
            valor={mxn(exp?.reserva_fondeada)}
            nota={exp?.reserva_fondeada == null ? "Pendiente de Tesorería" : `Cubre ${cobertura?.toFixed(1)}× los premios`}
            alerta={exp?.reserva_fondeada == null}
          />
          <Kpi label="Kill switch global" valor={exp?.kill_switch_activo ? "ACTIVO" : "Normal"} alerta={!!exp?.kill_switch_activo} />
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">Ciclos activos</h2>
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {ciclos.length === 0 && <p className="p-4 text-sm text-neutral-400">Sin ciclos activos.</p>}
            {ciclos.map((c) => {
              const req = c.productos?.gente_requerida ?? 1;
              const avance = Math.min(1, c.lugares_ocupados / req);
              const dias = Math.max(0, Math.ceil((new Date(c.fecha_resolucion).getTime() - Date.now()) / DIA));
              return (
                <div key={c.id} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 text-sm last:border-0">
                  <span className="w-24 shrink-0 font-medium">{c.productos?.nombre ?? c.producto_clave}</span>
                  <span className="w-48 shrink-0 truncate text-xs text-neutral-500">{c.evento_id}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-100">
                    <div className="h-full bg-emerald-600" style={{ width: `${avance * 100}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                    {c.lugares_ocupados.toLocaleString("es-MX")}/{req.toLocaleString("es-MX")} · {dias}d
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">Mesa de derivados</h2>
          <Link href="/consola/mesa" className="block rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-400">
            <p className="text-2xl font-semibold tabular-nums">{porRevisar}</p>
            <p className="text-xs text-neutral-500">propuestas esperando decisión</p>
            <div className="mt-3 flex flex-col gap-1 text-xs text-neutral-600">
              <span>Hallazgos por revisar: {mesa.pendiente ?? 0}</span>
              <span>En Riesgo: {mesa.aceptada ?? 0}</span>
              <span>Listas para publicar: {mesa.aprobada_riesgo ?? 0}</span>
            </div>
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">Cuánto gana PISO por usuario</h2>
          <Link href="/consola/palancas" className="text-xs text-emerald-700 hover:underline">
            Mover palancas →
          </Link>
        </div>
        <p className="mb-2 text-xs text-neutral-500">
          Modelo de Finanzas (src/lib/economia): ingreso por rendimiento, carry, cuota y saldo, menos pagos, custodia e infra, al año.
        </p>
        {!eco ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-400">
            Sin datos del modelo. ¿Ya corriste la migración 0014?
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <div className="grid grid-cols-2 gap-px bg-neutral-100 md:grid-cols-4">
              {[
                ["Ganancia por usuario al año", mxn(eco.r.contrib)],
                ["LTV / CAC", isFinite(eco.r.ltvCac) ? `${eco.r.ltvCac.toFixed(1)}×` : "—"],
                ["Recupera el CAC en", isFinite(eco.r.payback) && eco.r.payback < 600 ? `${eco.r.payback.toFixed(1)} meses` : "nunca"],
                ["Utilidad al mes", mxn(eco.r.utilidadMes)],
              ].map(([l, v]) => (
                <div key={l} className="bg-white px-4 py-3">
                  <p className="text-xs text-neutral-500">{l}</p>
                  <p className="text-lg font-semibold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-neutral-400">
                <tr className="text-right">
                  <th className="px-4 py-2 text-left font-normal">Nivel</th>
                  <th className="font-normal">Ciclos/año</th>
                  <th className="font-normal">Premio en mano</th>
                  <th className="font-normal">Ingreso/año</th>
                  <th className="px-4 font-normal">Ganancia/año</th>
                </tr>
              </thead>
              <tbody>
                {NIVELES.map((n) => {
                  const x = eco.r.niveles[n];
                  return (
                    <tr key={n} className="border-t border-neutral-100 text-right">
                      <td className="px-4 py-2 text-left font-medium capitalize">{n}</td>
                      <td>{x.ciclos.toFixed(1)}</td>
                      <td>{mxn(x.premioEnMano)}</td>
                      <td>{mxn(x.ingreso)}</td>
                      <td className={`px-4 font-semibold ${x.contrib < 0 ? "text-red-600" : "text-emerald-700"}`}>{mxn(x.contrib)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {eco.supuestos.length > 0 && (
              <p className="border-t border-neutral-100 px-4 py-2 text-xs text-amber-700">Supuestos: {eco.supuestos.join(" · ")}</p>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Parámetros del modelo financiero</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-neutral-400">
              <tr className="text-right">
                <th className="px-4 py-2 text-left font-normal">Nivel</th>
                <th className="font-normal">Boleto</th>
                <th className="font-normal">Lugares</th>
                <th className="font-normal">Días</th>
                <th className="font-normal">Pool lleno</th>
                <th className="px-4 font-normal">alpha_em</th>
              </tr>
            </thead>
            <tbody>
              {niveles.map((n) => (
                <tr key={n.clave} className="border-t border-neutral-100 text-right">
                  <td className="px-4 py-2 text-left font-medium">{n.nombre}</td>
                  <td>{mxn(n.precio)}</td>
                  <td>{n.gente_requerida.toLocaleString("es-MX")}</td>
                  <td>{n.dias_resolucion}</td>
                  <td>{mxn(Number(n.precio) * n.gente_requerida)}</td>
                  <td className={`px-4 ${n.alpha_em == null ? "text-amber-700" : ""}`}>
                    {n.alpha_em == null ? "pendiente" : `${Math.round(Number(n.alpha_em) * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`border-t border-neutral-100 px-4 py-2 text-xs ${tasa == null ? "text-amber-700" : "text-neutral-500"}`}>
            Tasa CETES anual: {tasa == null ? "sin dato (la base usa 10% mientras tanto). La Mesa la llena con el CETES 28 de Banxico en su siguiente corrida" : `${tasa}%`}
          </p>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, valor, nota, alerta }: { label: string; valor: string; nota?: string; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${alerta ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"}`}>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{valor}</p>
      {nota && <p className={`mt-1 text-[11px] ${alerta ? "text-amber-700" : "text-neutral-400"}`}>{nota}</p>}
    </div>
  );
}
