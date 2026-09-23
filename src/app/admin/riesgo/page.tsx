"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Risk Dashboard -- PISO Core V1. Todo lo que se muestra aquí es
// computable directo de balances/posiciones/eventos, que ya son datos
// reales, no simulados. VaR/CVaR se deja marcado como pendiente a
// propósito -- no hay metodología confirmada por Finanzas todavía (ver
// checkpoint del 3-sep-2026), y no le corresponde a Tecnología inventarla.
//
// Checkpoint 17-sep-2026 (Behavioral Forest, D1/D5): se agrega el kill
// switch real -- exposure_limite_mxn por evento, editable aquí, y
// confirmar_posicion() (migración 0005) lo hace cumplir de verdad, no
// solo lo muestra. También se agrega el widget de integridad de capital
// (D1) -- verificar_integridad_capital() debe regresar cero filas siempre;
// si regresa algo, es la señal más seria que puede dar este panel.

interface PosicionAbierta {
  id: string;
  premio_potencial: number;
  respuesta: "si" | "no";
  evento_id: string;
}

interface EventoProb {
  id: string;
  nombre: string;
  probabilidad: number;
  exposure_limite_mxn: number | null;
  estado: string;
}

interface ViolacionCapital {
  user_id: string;
  balance_registrado: number;
  balance_esperado: number;
  diferencia: number;
}

export default function AdminRiesgoPage() {
  const [cargando, setCargando] = useState(true);
  const [capitalProtegido, setCapitalProtegido] = useState(0);
  const [posiciones, setPosiciones] = useState<PosicionAbierta[]>([]);
  const [eventos, setEventos] = useState<Record<string, EventoProb>>({});
  const [violaciones, setViolaciones] = useState<ViolacionCapital[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    const [{ data: balances, error: e1 }, { data: pos, error: e2 }, { data: ev, error: e3 }, { data: viol }] =
      await Promise.all([
        supabase.from("balances").select("demo_balance"),
        supabase.from("posiciones").select("id, premio_potencial, respuesta, evento_id").eq("estado", "abierta"),
        supabase.from("eventos").select("id, nombre, probabilidad, exposure_limite_mxn, estado"),
        supabase.rpc("verificar_integridad_capital"),
      ]);

    if (e1 || e2 || e3) {
      setError((e1 || e2 || e3)?.message ?? "Error cargando datos de riesgo.");
      setCargando(false);
      return;
    }

    setCapitalProtegido((balances ?? []).reduce((acc, b) => acc + Number(b.demo_balance), 0));
    setPosiciones((pos as PosicionAbierta[]) ?? []);
    const mapaEventos: Record<string, EventoProb> = {};
    for (const e of (ev as EventoProb[]) ?? []) mapaEventos[e.id] = e;
    setEventos(mapaEventos);
    setViolaciones((viol as ViolacionCapital[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardarLimite(e: FormEvent<HTMLFormElement>, eventoId: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const raw = form.get("limite");
    const limite = raw === "" || raw === null ? null : Number(raw);
    const { error } = await supabase.from("eventos").update({ exposure_limite_mxn: limite }).eq("id", eventoId);
    setMensaje(error ? `No se pudo guardar: ${error.message}` : `Límite de "${eventoId}" actualizado.`);
    if (!error) cargar();
  }

  if (cargando) return <p className="text-sm text-neutral-500">Cargando…</p>;
  if (error) return <p className="text-sm text-red-600">No se pudo cargar: {error}</p>;

  const potentialPayout = posiciones.reduce((acc, p) => acc + Number(p.premio_potencial), 0);

  const expectedPayout = posiciones.reduce((acc, p) => {
    const ev = eventos[p.evento_id];
    if (!ev) return acc;
    const pOcurre = p.respuesta === "si" ? ev.probabilidad : 1 - ev.probabilidad;
    return acc + Number(p.premio_potencial) * pOcurre;
  }, 0);

  const porEvento: Record<string, { nombre: string; exposure: number }> = {};
  for (const p of posiciones) {
    const ev = eventos[p.evento_id];
    const key = p.evento_id;
    if (!porEvento[key]) porEvento[key] = { nombre: ev?.nombre ?? p.evento_id, exposure: 0 };
    porEvento[key].exposure += Number(p.premio_potencial);
  }
  const maxExposure = Math.max(1, ...Object.values(porEvento).map((e) => e.exposure));

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Riesgo</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Calculado en vivo de balances y posiciones abiertas -- {posiciones.length} posiciones abiertas.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metrica label="Capital protegido" valor={capitalProtegido} />
        <Metrica label="Posiciones abiertas" valor={posiciones.length} moneda={false} />
        <Metrica label="Potential payout (peor caso)" valor={potentialPayout} />
        <Metrica label="Expected payout" valor={Math.round(expectedPayout)} />
      </div>

      <div className="mb-8 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium">VaR 95% / CVaR 95%: sin metodología confirmada por Finanzas.</p>
        <p className="mt-1 text-xs text-amber-700">
          "Expected payout" de arriba es valor esperado simple (premio × probabilidad del evento) -- no es lo mismo
          que un VaR/CVaR real. No se muestra un número ahí para no dar una falsa sensación de rigor estadístico
          que todavía no existe.
        </p>
      </div>

      <div className={`mb-8 rounded-lg border p-4 text-sm ${violaciones.length > 0 ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
        <p className="font-medium">
          {violaciones.length > 0
            ? `Integridad de capital (D1): ${violaciones.length} cuenta(s) fuera de reconciliación.`
            : "Integridad de capital (D1): todo reconcilia -- balance = $1,000 + suma del ledger para cada usuario."}
        </p>
        {violaciones.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 text-xs">
            {violaciones.map((v) => (
              <p key={v.user_id}>
                {v.user_id} -- registrado ${v.balance_registrado.toLocaleString("es-MX")}, esperado $
                {v.balance_esperado.toLocaleString("es-MX")} (diferencia {v.diferencia > 0 ? "+" : ""}
                {v.diferencia})
              </p>
            ))}
          </div>
        )}
        <p className="mt-1 text-xs opacity-80">
          resolver_evento() ya se niega a cerrar una resolución que deje a algún usuario liquidado fuera de esta
          reconciliación -- este widget es la misma verificación, pasada manualmente sobre todas las cuentas.
        </p>
      </div>

      {mensaje && <div className="mb-4 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm">{mensaje}</div>}

      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Kill switch por evento (D5)</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Límite de exposición agregada que Finanzas/Tesorería autoriza por evento -- confirmar_posicion() lo hace
        cumplir de verdad: en cuanto la exposición llega al límite, deja de aceptar posiciones nuevas para ese
        evento. Vacío = sin límite (comportamiento de hoy).
      </p>
      <div className="mb-8 flex flex-col gap-2">
        {Object.values(eventos).map((ev) => {
          const exposureActual = porEvento[ev.id]?.exposure ?? 0;
          const pausado = ev.exposure_limite_mxn != null && exposureActual >= ev.exposure_limite_mxn;
          return (
            <form
              key={ev.id}
              onSubmit={(e) => guardarLimite(e, ev.id)}
              className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${pausado ? "border-red-300 bg-red-50" : "border-neutral-200 bg-white"}`}
            >
              <span className="w-40 shrink-0 truncate font-medium">{ev.nombre}</span>
              <span className="text-xs text-neutral-500">exposición actual: ${exposureActual.toLocaleString("es-MX")}</span>
              <input
                name="limite"
                type="number"
                defaultValue={ev.exposure_limite_mxn ?? ""}
                placeholder="sin límite"
                className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs"
              />
              <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium">
                Guardar
              </button>
              {pausado && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white">Kill switch activo -- pausado</span>}
            </form>
          );
        })}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-neutral-700">Exposure por evento</h2>
      <div className="flex flex-col gap-2">
        {Object.entries(porEvento).length === 0 && (
          <p className="text-sm text-neutral-400">Sin posiciones abiertas todavía.</p>
        )}
        {Object.entries(porEvento).map(([id, e]) => (
          <div key={id} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-sm">{e.nombre}</span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-neutral-100">
              <div className="h-full bg-neutral-800" style={{ width: `${(e.exposure / maxExposure) * 100}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right text-sm tabular-nums">${e.exposure.toLocaleString("es-MX")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metrica({ label, valor, moneda = true }: { label: string; valor: number; moneda?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums">
        {moneda ? `$${valor.toLocaleString("es-MX")}` : valor}
      </p>
    </div>
  );
}
