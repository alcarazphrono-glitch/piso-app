"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Contenido -- CMS ligero, D14/D15 (memo Behavioral Forest 17-sep-2026).
// El Trust Center y el copy de tratamientos ya NO viven hardcodeados en
// pantallas -- viven en contenido_versionado (migración 0007), cada
// "clave" con historial de versiones y solo una activa a la vez. Guardar
// aquí es publicar una versión nueva (nunca se sobreescribe una vigente).
//
// D12 se integra aquí, no en un pipeline de anuncios que no existe: al
// escribir, se llama validar_copy() y se muestra un AVISO si aparece un
// término prohibido -- no bloquea el guardado, tal como pide el memo para
// esta fase.
//
// D15 -- nota de alcance honesta: el mecanismo (contenido editable sin
// deploy) ya está. Lo que NO está construido es que Legal tenga su propio
// acceso separado de un admin completo -- hoy esto sigue gateado por la
// tabla `operadores` (rol='admin' únicamente). Ver README.

interface FilaContenido {
  id: string;
  clave: string;
  version: number;
  cuerpo: { q?: string; a?: string; titulo?: string; nota?: string; [k: string]: unknown };
  activa: boolean;
  pendiente_legal: boolean;
  creado_en: string;
}

export default function AdminContenidoPage() {
  const [filas, setFilas] = useState<FilaContenido[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<{ termino: string; motivo: string }[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    const { data, error } = await supabase
      .from("contenido_versionado")
      .select("id, clave, version, cuerpo, activa, pendiente_legal, creado_en")
      .order("clave", { ascending: true })
      .order("version", { ascending: false });
    if (!error) setFilas((data as FilaContenido[]) ?? []);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function revisarCopy(texto: string) {
    const { data } = await supabase.rpc("validar_copy", { p_texto: texto });
    setAvisos((data as { termino: string; motivo: string }[]) ?? []);
  }

  async function publicar(e: FormEvent<HTMLFormElement>, clave: string, pendienteLegalActual: boolean) {
    e.preventDefault();
    setMensaje(null);
    const form = new FormData(e.currentTarget);
    const q = String(form.get("q") ?? "");
    const a = String(form.get("a") ?? "");
    const pendienteLegal = form.get("pendiente_legal") === "on";

    const { error } = await supabase.rpc("publicar_contenido", {
      p_clave: clave,
      p_cuerpo: { q, a },
      p_pendiente_legal: pendienteLegal,
    });

    setMensaje(error ? `No se pudo publicar: ${error.message}` : `"${clave}" publicado como nueva versión.`);
    if (!error) {
      setEditando(null);
      setAvisos([]);
      cargar();
    }
  }

  const activas = filas.filter((f) => f.activa).sort((a, b) => a.clave.localeCompare(b.clave));
  const versionesPorClave = (clave: string) => filas.filter((f) => f.clave === clave);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Contenido</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Trust Center y copy de tratamientos, versionado. Publicar aquí no requiere deploy -- Consumer lee siempre la
        versión activa.
      </p>

      {mensaje && <div className="mb-4 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm">{mensaje}</div>}

      <div className="flex flex-col gap-3">
        {activas.map((f) => (
          <div key={f.clave} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-mono text-xs text-neutral-400">
                  {f.clave} · v{f.version}
                  {f.pendiente_legal && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">pendiente de Legal</span>
                  )}
                </p>
                {f.cuerpo.q && <p className="mt-1 text-sm font-medium">{f.cuerpo.q}</p>}
                {f.cuerpo.a && <p className="mt-0.5 text-sm text-neutral-600">{f.cuerpo.a}</p>}
                {f.cuerpo.titulo && <p className="mt-1 text-sm font-medium">{f.cuerpo.titulo}</p>}
                {f.cuerpo.nota && <p className="mt-0.5 text-xs text-neutral-500">{f.cuerpo.nota}</p>}
                <p className="mt-1 text-[11px] text-neutral-400">{versionesPorClave(f.clave).length} versión(es) en el historial</p>
              </div>
              <button
                onClick={() => {
                  setEditando(editando === f.clave ? null : f.clave);
                  setAvisos([]);
                }}
                className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium"
              >
                {editando === f.clave ? "Cancelar" : "Editar"}
              </button>
            </div>

            {editando === f.clave && (
              <form onSubmit={(e) => publicar(e, f.clave, f.pendiente_legal)} className="mt-4 flex flex-col gap-3 border-t border-neutral-100 pt-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-neutral-500">Pregunta / título</span>
                  <input
                    name="q"
                    defaultValue={f.cuerpo.q ?? f.cuerpo.titulo ?? ""}
                    onChange={(e) => revisarCopy(e.target.value)}
                    className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-neutral-500">Respuesta / cuerpo</span>
                  <textarea
                    name="a"
                    rows={3}
                    defaultValue={f.cuerpo.a ?? f.cuerpo.nota ?? ""}
                    onChange={(e) => revisarCopy(e.target.value)}
                    className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-neutral-600">
                  <input type="checkbox" name="pendiente_legal" defaultChecked={f.pendiente_legal} />
                  Marcar como pendiente de validación de Legal
                </label>

                {avisos.length > 0 && (
                  <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
                    <p className="font-medium">D12 -- términos que Behavioral pidió evitar (no bloquea, solo avisa):</p>
                    {avisos.map((av) => (
                      <p key={av.termino} className="mt-1">
                        "{av.termino}" -- {av.motivo}
                      </p>
                    ))}
                  </div>
                )}

                <button type="submit" className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
                  Publicar nueva versión
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
