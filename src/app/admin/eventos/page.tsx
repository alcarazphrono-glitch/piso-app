"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Event Manager -- PISO Core V1, checkpoint 3-sep-2026. Antes de esto, un
// evento nuevo significaba editar src/types/index.ts a mano y redesplegar.
// Ahora se crea, publica y resuelve aquí; Consumer lo lee de la tabla
// `eventos` (ver src/lib/eventos.ts) sin ningún deploy de código.

interface EventoAdmin {
  id: string;
  nombre: string;
  categoria: string;
  pregunta: string;
  probabilidad: number;
  estado: "borrador" | "abierto" | "cerrado" | "resuelto";
  fuente_resolucion: string;
  premio_override: number | null;
  premio_estado: "validado" | "interino_pendiente_finanzas" | "formula_automatica";
  fecha_texto: string;
  exposure_limite_mxn: number | null;
}

const PREMIO_ESTADO_LABEL: Record<string, string> = {
  validado: "Validado por Finanzas",
  interino_pendiente_finanzas: "Interino -- pendiente de Finanzas",
  formula_automatica: "Fórmula automática",
};

const PREMIO_ESTADO_ESTILO: Record<string, string> = {
  validado: "bg-emerald-100 text-emerald-700",
  interino_pendiente_finanzas: "bg-amber-100 text-amber-700",
  formula_automatica: "bg-neutral-100 text-neutral-600",
};

const ESTADO_ESTILO: Record<string, string> = {
  borrador: "bg-neutral-100 text-neutral-600",
  abierto: "bg-emerald-100 text-emerald-700",
  cerrado: "bg-amber-100 text-amber-700",
  resuelto: "bg-neutral-800 text-white",
};

export default function AdminEventosPage() {
  const [eventos, setEventos] = useState<EventoAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function recargar() {
    setCargando(true);
    const { data, error } = await supabase
      .from("eventos")
      .select("id, nombre, categoria, pregunta, probabilidad, estado, fuente_resolucion, premio_override, premio_estado, fecha_texto, exposure_limite_mxn")
      .order("creado_en", { ascending: false });
    if (!error) setEventos((data as EventoAdmin[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    recargar();
  }, []);

  async function crearEvento(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMensaje(null);
    const form = new FormData(e.currentTarget);
    const id = String(form.get("id")).trim();

    const { error } = await supabase.from("eventos").insert({
      id,
      nombre: form.get("nombre"),
      categoria: form.get("categoria"),
      pregunta: form.get("pregunta"),
      descripcion: form.get("descripcion"),
      explicacion_1: form.get("explicacion_1"),
      explicacion_2: form.get("explicacion_2"),
      probabilidad: Number(form.get("probabilidad")),
      fuente_resolucion: form.get("fuente_resolucion"),
      fecha_texto: form.get("fecha_texto"),
      fecha_contexto: form.get("fecha_contexto"),
      premio_override: form.get("premio_override") ? Number(form.get("premio_override")) : null,
      premio_estado: form.get("premio_override") ? form.get("premio_estado") : "formula_automatica",
      exposure_limite_mxn: form.get("exposure_limite_mxn") ? Number(form.get("exposure_limite_mxn")) : null,
      estado: "borrador",
      activo: true,
    });

    if (error) {
      setMensaje(`No se pudo crear: ${error.message}`);
      return;
    }
    setMensaje(`Evento "${id}" creado como borrador.`);
    setMostrandoForm(false);
    (e.target as HTMLFormElement).reset();
    recargar();
  }

  async function publicar(id: string) {
    setMensaje(null);
    const { error } = await supabase.from("eventos").update({ estado: "abierto" }).eq("id", id);
    if (error) {
      setMensaje(`No se pudo publicar: ${error.message}`);
      return;
    }
    recargar();
  }

  async function resolver(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    setMensaje(null);
    const form = new FormData(e.currentTarget);

    const { data, error } = await supabase.rpc("resolver_evento", {
      p_evento_id: id,
      p_resultado: form.get("resultado"),
      p_fuente: form.get("fuente"),
      p_evidencia: form.get("evidencia") || null,
    });

    if (error) {
      setMensaje(`No se pudo resolver: ${error.message}`);
      return;
    }
    setMensaje(`Evento "${id}" resuelto. Se liquidaron ${data} posiciones abiertas.`);
    setResolviendo(null);
    recargar();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Eventos</h1>
          <p className="text-sm text-neutral-500">Crear, publicar y resolver eventos sin tocar código.</p>
        </div>
        <button
          onClick={() => setMostrandoForm((v) => !v)}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          {mostrandoForm ? "Cancelar" : "+ Crear evento"}
        </button>
      </div>

      {mensaje && (
        <div className="mb-4 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm">{mensaje}</div>
      )}

      {mostrandoForm && (
        <form onSubmit={crearEvento} className="mb-8 grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-white p-5">
          <Campo label="id (slug único, sin espacios)"><input name="id" required pattern="[a-z0-9_]+" className={inputClass} /></Campo>
          <Campo label="Categoría"><input name="categoria" required defaultValue="macro" className={inputClass} /></Campo>
          <Campo label="Nombre corto"><input name="nombre" required className={inputClass} /></Campo>
          <Campo label="Probabilidad histórica (0-1)"><input name="probabilidad" type="number" step="0.01" min="0" max="1" required className={inputClass} /></Campo>
          <Campo label="Pregunta (¿Va a ocurrir?)" full><input name="pregunta" required className={inputClass} /></Campo>
          <Campo label="Descripción corta" full><input name="descripcion" required className={inputClass} /></Campo>
          <Campo label="Explicación línea 1" full><input name="explicacion_1" required className={inputClass} /></Campo>
          <Campo label="Explicación línea 2" full><input name="explicacion_2" required className={inputClass} /></Campo>
          <Campo label="Fecha (texto, ej. 'Se resuelve el 20 de octubre')"><input name="fecha_texto" required className={inputClass} /></Campo>
          <Campo label="Contexto de la fecha"><input name="fecha_contexto" required className={inputClass} /></Campo>
          <Campo label="Fuente de resolución" full><input name="fuente_resolucion" required placeholder="ej. Liga MX — resultado oficial" className={inputClass} /></Campo>
          <Campo label="Premio fijo en MXN (opcional -- vacío = fórmula automática)">
            <input name="premio_override" type="number" className={inputClass} />
          </Campo>
          <Campo label="Si pusiste premio fijo, ¿su estado es...?">
            <select name="premio_estado" className={inputClass} defaultValue="interino_pendiente_finanzas">
              <option value="validado">Validado por Finanzas</option>
              <option value="interino_pendiente_finanzas">Interino -- pendiente de Finanzas</option>
            </select>
          </Campo>
          <Campo label="Límite de exposición MXN (D5, opcional -- kill switch de Finanzas/Tesorería)">
            <input name="exposure_limite_mxn" type="number" placeholder="sin límite" className={inputClass} />
          </Campo>
          <div className="col-span-2 mt-2">
            <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
              Crear como borrador
            </button>
          </div>
        </form>
      )}

      {cargando ? (
        <p className="text-sm text-neutral-500">Cargando…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {eventos.map((ev) => (
            <div key={ev.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{ev.nombre}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_ESTILO[ev.estado]}`}>{ev.estado}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {ev.id} · {ev.categoria} · p={ev.probabilidad} · {ev.fecha_texto}
                  </p>
                  <p className="mt-1 text-sm text-neutral-700">{ev.pregunta}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
                    Premio: {ev.premio_override ? `$${ev.premio_override} MXN (fijo)` : "fórmula automática"} · Fuente: {ev.fuente_resolucion}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PREMIO_ESTADO_ESTILO[ev.premio_estado]}`}>
                      {PREMIO_ESTADO_LABEL[ev.premio_estado]}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {ev.estado === "borrador" && (
                    <button onClick={() => publicar(ev.id)} className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700">
                      Publicar
                    </button>
                  )}
                  {(ev.estado === "abierto" || ev.estado === "cerrado") && (
                    <button
                      onClick={() => setResolviendo(resolviendo === ev.id ? null : ev.id)}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium"
                    >
                      Resolver
                    </button>
                  )}
                </div>
              </div>

              {resolviendo === ev.id && (
                <form onSubmit={(e) => resolver(e, ev.id)} className="mt-4 border-t border-neutral-100 pt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Resolver "{ev.pregunta}" -- esto liquida todas las posiciones abiertas de este evento.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Resultado">
                      <select name="resultado" required className={inputClass}>
                        <option value="">Selecciona…</option>
                        <option value="si">Sí</option>
                        <option value="no">No</option>
                      </select>
                    </Campo>
                    <Campo label="Fuente (obligatoria)"><input name="fuente" required placeholder={ev.fuente_resolucion} className={inputClass} /></Campo>
                    <Campo label="Evidencia (link o nota)" full><input name="evidencia" className={inputClass} /></Campo>
                  </div>
                  <button type="submit" className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
                    Confirmar resolución
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
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
