"use client";

// PISO Core V1 -- Event Manager (sección 3.1 del brief de arranque,
// 3-sep-2026). Primera pieza construida bajo la Opción C del memo de
// arquitectura del mismo día: un operador crea/edita/resuelve eventos
// desde aquí, sin tocar código. La tabla `eventos` (supabase/schema.sql)
// ya existía; esta página es lo primero que le da uso real más allá de
// ser el destino de una FK.
//
// Gateo de acceso: esta página NO revisa un rol en el cliente -- lo
// revisa Postgres. Si quien está logueado no está en public.operadores,
// cualquier insert/update a `eventos` o llamada a resolver_evento()
// regresa un error de RLS / "No autorizado", que se muestra tal cual. Es
// intencional (ver migración 0002_piso_core_v1.sql): más simple que
// duplicar la lógica de autorización en dos lugares, y evita que la
// página *aparente* dar acceso cuando en realidad la base de datos lo
// va a rechazar.
//
// NOTA (checkpoint, memo de arquitectura): este es el primer evento
// end-to-end. Consumer todavía NO lee de esta tabla -- sigue leyendo del
// arreglo EVENTOS hardcodeado en src/types/index.ts. Conectar esa lectura
// es el siguiente paso, deliberadamente fuera de este cambio.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  EventoCore,
  NuevoEventoCore,
  actualizarEstadoEventoCore,
  crearEventoCore,
  listarEventosCore,
  resolverEventoCore,
} from "@/lib/core";

const ESTADO_SIGUIENTE: Partial<Record<EventoCore["estado"], EventoCore["estado"]>> = {
  borrador: "abierto",
  abierto: "cerrado",
};

const ESTADO_LABEL: Record<EventoCore["estado"], string> = {
  borrador: "Borrador",
  abierto: "Abierto",
  cerrado: "Cerrado",
  resuelto: "Resuelto",
};

function formVacio(): NuevoEventoCore {
  return {
    id: "",
    nombre: "",
    probabilidad: 0.5,
    categoria: "",
    descripcion: "",
    explicacion_corta: "",
    explicacion_larga: "",
    fecha_display: "",
    fecha_contexto: "",
    fuente_resolucion: "",
  };
}

export default function AdminEventosPage() {
  const router = useRouter();
  const [autenticado, setAutenticado] = useState(false);
  const [eventos, setEventos] = useState<EventoCore[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NuevoEventoCore>(formVacio());
  const [creando, setCreando] = useState(false);
  const [resolviendo, setResolviendo] = useState<string | null>(null); // evento_id en curso
  const [resultadoForm, setResultadoForm] = useState<Record<string, { resultado: string; fuente: string; evidencia: string }>>({});

  async function cargarEventos() {
    setCargando(true);
    try {
      const data = await listarEventosCore();
      setEventos(data);
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
      cargarEventos();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function mensajeError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    // Los mensajes de las funciones SECURITY DEFINER (ej. "No autorizado:
    // se requiere rol de operador") llegan tal cual en e.message -- se
    // muestran directo, sin envolver, porque ya están escritos para un
    // humano (ver migración 0002_piso_core_v1.sql).
    return msg;
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!form.id || !form.nombre) return;
    setCreando(true);
    setError(null);
    try {
      await crearEventoCore(form);
      setForm(formVacio());
      await cargarEventos();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCreando(false);
    }
  }

  async function avanzarEstado(ev: EventoCore) {
    const siguiente = ESTADO_SIGUIENTE[ev.estado];
    if (!siguiente) return;
    setError(null);
    try {
      await actualizarEstadoEventoCore(ev.id, siguiente);
      await cargarEventos();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function resolver(ev: EventoCore) {
    const datos = resultadoForm[ev.id];
    if (!datos?.resultado || !datos?.fuente) return;
    setResolviendo(ev.id);
    setError(null);
    try {
      const n = await resolverEventoCore({
        eventoId: ev.id,
        resultado: datos.resultado,
        fuente: datos.fuente,
        evidencia: datos.evidencia || undefined,
      });
      await cargarEventos();
      alert(`Evento resuelto. ${n} posición(es) actualizada(s).`);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setResolviendo(null);
    }
  }

  if (!autenticado) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-sm">
      <h1 className="text-xl font-bold">PISO Core -- Event Manager</h1>
      <p className="mt-1 text-ink-soft">
        Crear, publicar y resolver eventos sin tocar código. Requiere estar dado de alta en{" "}
        <code>operadores</code>.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>
      )}

      <section className="mt-8 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Nuevo evento</h2>
        <form onSubmit={crear} className="mt-3 grid grid-cols-2 gap-3">
          <input
            className="col-span-1 rounded-lg border border-line px-3 py-2"
            placeholder="id (slug, ej. banxico_18sep)"
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value.trim() })}
          />
          <input
            className="col-span-1 rounded-lg border border-line px-3 py-2"
            placeholder="Categoría"
            value={form.categoria}
            onChange={(e) => setForm({ ...form, categoria: e.target.value })}
          />
          <input
            className="col-span-2 rounded-lg border border-line px-3 py-2"
            placeholder="Nombre / pregunta"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          />
          <textarea
            className="col-span-2 rounded-lg border border-line px-3 py-2"
            placeholder="Descripción"
            value={form.descripcion}
            onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            className="col-span-1 rounded-lg border border-line px-3 py-2"
            placeholder="Probabilidad histórica (0-1)"
            value={form.probabilidad}
            onChange={(e) => setForm({ ...form, probabilidad: Number(e.target.value) })}
          />
          <input
            className="col-span-1 rounded-lg border border-line px-3 py-2"
            placeholder="Fuente de resolución (ej. Banxico -- comunicado oficial)"
            value={form.fuente_resolucion}
            onChange={(e) => setForm({ ...form, fuente_resolucion: e.target.value })}
          />
          <input
            className="col-span-2 rounded-lg border border-line px-3 py-2"
            placeholder='Fecha a mostrar (ej. "Se resuelve el 18 de septiembre")'
            value={form.fecha_display}
            onChange={(e) => setForm({ ...form, fecha_display: e.target.value })}
          />
          <button
            type="submit"
            disabled={creando}
            className="col-span-2 mt-1 rounded-lg bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {creando ? "Creando…" : "Crear evento (borrador)"}
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Eventos</h2>
        {cargando ? (
          <p className="mt-3 text-ink-soft">Cargando…</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {eventos.map((ev) => (
              <div key={ev.id} className="rounded-2xl border border-line p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{ev.nombre}</p>
                    <p className="text-xs text-ink-soft">
                      {ev.id} · {ev.categoria ?? "sin categoría"} · probabilidad {ev.probabilidad}
                    </p>
                  </div>
                  <span className="rounded-full border border-line px-2.5 py-1 text-xs font-medium">
                    {ESTADO_LABEL[ev.estado]}
                  </span>
                </div>

                {ev.resultado_oficial && (
                  <p className="mt-2 text-xs text-mint">Resultado oficial: {ev.resultado_oficial}</p>
                )}

                <div className="mt-3 flex items-center gap-2">
                  {ESTADO_SIGUIENTE[ev.estado] && (
                    <button
                      onClick={() => avanzarEstado(ev)}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium"
                    >
                      Pasar a {ESTADO_LABEL[ESTADO_SIGUIENTE[ev.estado]!]}
                    </button>
                  )}
                </div>

                {ev.estado !== "resuelto" && (
                  <div className="mt-3 rounded-xl border border-dashed border-line p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-ink-soft">
                      Resolver evento (Resolution Engine)
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className="col-span-1 rounded-lg border border-line px-2 py-1.5 text-xs"
                        value={resultadoForm[ev.id]?.resultado ?? ""}
                        onChange={(e) =>
                          setResultadoForm({
                            ...resultadoForm,
                            [ev.id]: { ...resultadoForm[ev.id], resultado: e.target.value, fuente: resultadoForm[ev.id]?.fuente ?? "", evidencia: resultadoForm[ev.id]?.evidencia ?? "" },
                          })
                        }
                      >
                        <option value="">Resultado…</option>
                        {(ev.opciones ?? ["si", "no"]).map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                      <input
                        className="col-span-1 rounded-lg border border-line px-2 py-1.5 text-xs"
                        placeholder="Fuente (ej. Banxico -- comunicado oficial)"
                        value={resultadoForm[ev.id]?.fuente ?? ""}
                        onChange={(e) =>
                          setResultadoForm({
                            ...resultadoForm,
                            [ev.id]: { ...resultadoForm[ev.id], resultado: resultadoForm[ev.id]?.resultado ?? "", fuente: e.target.value, evidencia: resultadoForm[ev.id]?.evidencia ?? "" },
                          })
                        }
                      />
                      <input
                        className="col-span-2 rounded-lg border border-line px-2 py-1.5 text-xs"
                        placeholder="Evidencia (url o descripción)"
                        value={resultadoForm[ev.id]?.evidencia ?? ""}
                        onChange={(e) =>
                          setResultadoForm({
                            ...resultadoForm,
                            [ev.id]: { ...resultadoForm[ev.id], resultado: resultadoForm[ev.id]?.resultado ?? "", fuente: resultadoForm[ev.id]?.fuente ?? "", evidencia: e.target.value },
                          })
                        }
                      />
                    </div>
                    <button
                      onClick={() => resolver(ev)}
                      disabled={resolviendo === ev.id}
                      className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {resolviendo === ev.id ? "Resolviendo…" : "Resolver, para todos"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
