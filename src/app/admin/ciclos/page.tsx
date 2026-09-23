"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Admin de ciclos -- abrir, ver progreso de aforo, activar bono de
// bienvenida, y resolver con sorteo. No hay cron real conectado en este
// sandbox (ver README, "sigue pendiente") -- cancelar_ciclos_vencidos()
// se expone aquí como botón manual mientras no exista un pg_cron/Edge
// Function real en producción.

interface Producto {
  clave: string;
  nombre: string;
  precio: number;
  gente_requerida: number;
  dias_resolucion: number;
}

interface Evento {
  id: string;
  nombre: string;
  estado: string;
}

interface Ciclo {
  id: string;
  producto_clave: string;
  evento_id: string;
  lugares_ocupados: number;
  estado: "llenando" | "lleno" | "resuelto" | "cancelado";
  fecha_inicio: string;
  fecha_resolucion: string;
  bono_bienvenida_activado: boolean;
}

const ESTADO_ESTILO: Record<string, string> = {
  llenando: "bg-neutral-100 text-neutral-600",
  lleno: "bg-emerald-100 text-emerald-700",
  resuelto: "bg-neutral-800 text-white",
  cancelado: "bg-red-100 text-red-700",
};

export default function AdminCiclosPage() {
  const [ciclos, setCiclos] = useState<Ciclo[]>([]);
  const [productos, setProductos] = useState<Record<string, Producto>>({});
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const [{ data: c, error: e1 }, { data: p, error: e2 }, { data: ev, error: e3 }] = await Promise.all([
      supabase.from("ciclos").select("*").order("creado_en", { ascending: false }),
      supabase.from("productos").select("clave, nombre, precio, gente_requerida, dias_resolucion"),
      supabase.from("eventos").select("id, nombre, estado").order("nombre"),
    ]);
    if (!e1) setCiclos((c as Ciclo[]) ?? []);
    if (!e2) {
      const mapa: Record<string, Producto> = {};
      for (const prod of (p as Producto[]) ?? []) mapa[prod.clave] = prod;
      setProductos(mapa);
    }
    if (!e3) setEventos((ev as Evento[]) ?? []);
    if (e1 || e2 || e3) setMensaje((e1 || e2 || e3)?.message ?? "Error cargando ciclos.");
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function abrirCiclo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMensaje(null);
    const form = new FormData(e.currentTarget);
    const { error } = await supabase.rpc("abrir_ciclo", {
      p_producto_clave: form.get("producto_clave"),
      p_evento_id: form.get("evento_id"),
    });
    if (error) {
      setMensaje(`No se pudo abrir el ciclo: ${error.message}`);
      return;
    }
    setMensaje("Ciclo abierto.");
    setMostrandoForm(false);
    (e.target as HTMLFormElement).reset();
    cargar();
  }

  async function activarBono(cicloId: string) {
    setMensaje(null);
    const { error } = await supabase.rpc("activar_bono_bienvenida", { p_ciclo_id: cicloId });
    setMensaje(error ? `No se pudo activar el bono: ${error.message}` : "Bono de bienvenida activado ($10,000).");
    if (!error) cargar();
  }

  async function resolver(e: FormEvent<HTMLFormElement>, cicloId: string) {
    e.preventDefault();
    setMensaje(null);
    const form = new FormData(e.currentTarget);
    const { data, error } = await supabase.rpc("resolver_ciclo", {
      p_ciclo_id: cicloId,
      p_resultado: form.get("resultado"),
      p_fuente: form.get("fuente"),
      p_evidencia: form.get("evidencia") || null,
    });
    if (error) {
      setMensaje(`No se pudo resolver: ${error.message}`);
      return;
    }
    const ganador = (data as { ganador_boleto_id: string | null })?.ganador_boleto_id;
    setMensaje(ganador ? "Ciclo resuelto -- hubo ganador del sorteo." : "Ciclo resuelto -- nadie acertó, sin ganador (capital reembolsado igual a todos).");
    setResolviendo(null);
    cargar();
  }

  async function correrCancelacion() {
    setMensaje(null);
    const { data, error } = await supabase.rpc("cancelar_ciclos_vencidos");
    setMensaje(error ? `Error: ${error.message}` : `Revisión manual corrida -- ${data} ciclo(s) vencido(s) cancelado(s) y reembolsado(s).`);
    if (!error) cargar();
  }

  if (cargando) return <p className="text-sm text-neutral-500">Cargando…</p>;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Ciclos</h1>
          <p className="text-sm text-neutral-500">Instancias de un producto ligadas a un evento real.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={correrCancelacion} className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium">
            Cancelar vencidos ahora
          </button>
          <button
            onClick={() => setMostrandoForm((v) => !v)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            {mostrandoForm ? "Cancelar" : "+ Abrir ciclo"}
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-xs text-amber-800">
        No hay cron real conectado -- "Cancelar vencidos ahora" es el sustituto manual de
        cancelar_ciclos_vencidos() mientras no exista un pg_cron/Edge Function programada en producción. Llamarlo
        de más no cancela nada que no debiera: solo actúa sobre ciclos que YA vencieron.
      </div>

      {mensaje && <div className="mb-4 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm">{mensaje}</div>}

      {mostrandoForm && (
        <form onSubmit={abrirCiclo} className="mb-8 grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-white p-5">
          <Campo label="Producto">
            <select name="producto_clave" required className={inputClass}>
              <option value="">Selecciona…</option>
              {Object.values(productos).map((p) => (
                <option key={p.clave} value={p.clave}>{p.nombre} -- ${p.precio}, N={p.gente_requerida}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Evento real que resuelve el ciclo">
            <select name="evento_id" required className={inputClass}>
              <option value="">Selecciona…</option>
              {eventos.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.nombre} ({ev.estado})</option>
              ))}
            </select>
          </Campo>
          <div className="col-span-2">
            <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
              Abrir ciclo
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {ciclos.length === 0 && <p className="text-sm text-neutral-400">Sin ciclos todavía.</p>}
        {ciclos.map((c) => {
          const prod = productos[c.producto_clave];
          const evento = eventos.find((e) => e.id === c.evento_id);
          const pct = prod ? Math.min(100, (c.lugares_ocupados / prod.gente_requerida) * 100) : 0;
          const faltan = prod ? Math.max(0, prod.gente_requerida - c.lugares_ocupados) : null;
          const puedeActivarBono = c.producto_clave === "entrada" && c.estado === "llenando" && !c.bono_bienvenida_activado;

          return (
            <div key={c.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{prod?.nombre ?? c.producto_clave}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_ESTILO[c.estado]}`}>{c.estado}</span>
                    {c.bono_bienvenida_activado && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">bono activo</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    evento: {evento?.nombre ?? c.evento_id} · resolución límite: {new Date(c.fecha_resolucion).toLocaleString("es-MX")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {puedeActivarBono && (
                    <button onClick={() => activarBono(c.id)} className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-700">
                      Activar bono $10,000
                    </button>
                  )}
                  {c.estado === "lleno" && (
                    <button
                      onClick={() => setResolviendo(resolviendo === c.id ? null : c.id)}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium"
                    >
                      Resolver
                    </button>
                  )}
                </div>
              </div>

              {prod && c.estado !== "resuelto" && c.estado !== "cancelado" && (
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-4 flex-1 overflow-hidden rounded bg-neutral-100">
                    <div className="h-full bg-neutral-800" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-40 shrink-0 text-right text-xs text-neutral-500">
                    faltan {faltan} lugares ({c.lugares_ocupados}/{prod.gente_requerida})
                  </span>
                </div>
              )}

              {resolviendo === c.id && (
                <form onSubmit={(e) => resolver(e, c.id)} className="mt-4 border-t border-neutral-100 pt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Resolver este ciclo -- confirma el resultado real, reembolsa el 100% del capital a todos y
                    sortea el premio entre quienes acertaron.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Resultado">
                      <select name="resultado" required className={inputClass}>
                        <option value="">Selecciona…</option>
                        <option value="si">Sí</option>
                        <option value="no">No</option>
                      </select>
                    </Campo>
                    <Campo label="Fuente (obligatoria)"><input name="fuente" required className={inputClass} /></Campo>
                    <Campo label="Evidencia (link o nota)" full><input name="evidencia" className={inputClass} /></Campo>
                  </div>
                  <button type="submit" className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
                    Confirmar resolución (sorteo)
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inputClass = "w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm";

function Campo({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
