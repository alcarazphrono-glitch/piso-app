"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Data ingestion -- PISO Core V1, sección 3.7 del brief original. No hay
// ninguna API real conectada (este entorno no tiene salida a Banxico ni
// INEGI) -- esto es el catálogo de fuentes y la bitácora de capturas
// manuales, para que resolver un evento cite una fuente REGISTRADA, y
// para que el día que alguien automatice la captura, ya exista dónde
// escribirla sin tocar el esquema otra vez.

interface Fuente {
  id: string;
  nombre: string;
  tipo: "manual" | "api" | "scraping";
  url: string | null;
  descripcion: string | null;
  activa: boolean;
}

interface Ingesta {
  id: string;
  fuente_id: string;
  evento_id: string | null;
  contenido: string;
  capturado_en: string;
}

export default function AdminFuentesPage() {
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [ingestas, setIngestas] = useState<Ingesta[]>([]);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    const [{ data: f }, { data: i }] = await Promise.all([
      supabase.from("fuentes_datos").select("*").order("creado_en", { ascending: true }),
      supabase.from("ingestas").select("*").order("capturado_en", { ascending: false }).limit(15),
    ]);
    setFuentes((f as Fuente[]) ?? []);
    setIngestas((i as Ingesta[]) ?? []);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function crearFuente(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const { error } = await supabase.from("fuentes_datos").insert({
      nombre: form.get("nombre"),
      tipo: form.get("tipo"),
      url: form.get("url") || null,
      descripcion: form.get("descripcion") || null,
    });
    setMensaje(error ? `No se pudo crear: ${error.message}` : "Fuente registrada.");
    if (!error) {
      setMostrandoForm(false);
      (e.target as HTMLFormElement).reset();
      cargar();
    }
  }

  async function registrarIngesta(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const { data: sess } = await supabase.auth.getSession();
    const { error } = await supabase.from("ingestas").insert({
      fuente_id: form.get("fuente_id"),
      evento_id: form.get("evento_id") || null,
      contenido: form.get("contenido"),
      capturado_por: sess.session?.user.id,
    });
    setMensaje(error ? `No se pudo registrar: ${error.message}` : "Captura registrada en la bitácora.");
    if (!error) {
      (e.target as HTMLFormElement).reset();
      cargar();
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Fuentes de datos</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Catálogo de fuentes + bitácora de capturas. Sin API real conectada todavía -- captura manual.
      </p>

      {mensaje && <div className="mb-4 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm">{mensaje}</div>}

      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">Fuentes registradas</h2>
          <button onClick={() => setMostrandoForm((v) => !v)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium">
            {mostrandoForm ? "Cancelar" : "+ Registrar fuente"}
          </button>
        </div>

        {mostrandoForm && (
          <form onSubmit={crearFuente} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-500">Nombre</span>
              <input name="nombre" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-500">Tipo</span>
              <select name="tipo" className={inputClass} defaultValue="manual">
                <option value="manual">Manual</option>
                <option value="api">API</option>
                <option value="scraping">Scraping</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-500">URL</span>
              <input name="url" type="url" className={inputClass} />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-500">Descripción</span>
              <input name="descripcion" className={inputClass} />
            </label>
            <button type="submit" className="col-span-2 w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
              Registrar
            </button>
          </form>
        )}

        <div className="flex flex-col gap-2">
          {fuentes.map((f) => (
            <div key={f.id} className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{f.nombre}</p>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">{f.tipo}</span>
              </div>
              {f.descripcion && <p className="mt-0.5 text-xs text-neutral-500">{f.descripcion}</p>}
              {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-neutral-400 hover:underline">{f.url}</a>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Registrar una captura</h2>
        <form onSubmit={registrarIngesta} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-white p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-500">Fuente</span>
            <select name="fuente_id" required className={inputClass}>
              <option value="">Selecciona…</option>
              {fuentes.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-500">Evento relacionado (id, opcional)</span>
            <input name="evento_id" placeholder="ej. banxico_baja_tasas" className={inputClass} />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-500">Qué se capturó</span>
            <textarea name="contenido" required rows={2} className={inputClass} />
          </label>
          <button type="submit" className="col-span-2 w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
            Registrar captura
          </button>
        </form>

        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Bitácora reciente</h2>
        <div className="flex flex-col gap-2">
          {ingestas.length === 0 && <p className="text-sm text-neutral-400">Sin capturas todavía.</p>}
          {ingestas.map((i) => (
            <div key={i.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
              <p className="text-xs text-neutral-400">
                {new Date(i.capturado_en).toLocaleString("es-MX")} {i.evento_id ? `· ${i.evento_id}` : ""}
              </p>
              <p className="mt-1">{i.contenido}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const inputClass = "w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm";
