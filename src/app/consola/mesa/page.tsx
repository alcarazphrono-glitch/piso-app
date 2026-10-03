"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { PayoffNivel } from "@/lib/mesa/payoff";

// Mesa de derivados (consola financiera) -- migración 0012. Flujo:
//   analista (agente) propone → mesa (humano) acepta → Riesgo aprueba con
//   límite → se publica como evento + ciclo en la app.
// Esta pantalla es el filtro humano: nada llega a Consumer sin pasar por
// aquí. Las decisiones van por funciones mesa_* (SECURITY DEFINER), nunca
// por updates directos.

type Estado = "pendiente" | "aceptada" | "aprobada_riesgo" | "publicada" | "rechazada";

interface Propuesta {
  id: string;
  analista_clave: string;
  titulo: string;
  pregunta: string;
  descripcion_usuario: string;
  fuente_resolucion: string;
  fecha_resolucion: string;
  fecha_texto: string;
  modelo_estocastico: string;
  probabilidad: number;
  prob_baja: number | null;
  prob_alta: number | null;
  parametros: Record<string, unknown>;
  datos: Record<string, unknown>;
  tesis: string;
  riesgos: string;
  payoff: { niveles?: PayoffNivel[] };
  riesgo_legal: "bajo" | "medio" | "alto";
  nota_legal: string;
  producto_sugerido: string | null;
  estado: Estado;
  nota_revision: string | null;
  nota_riesgo: string | null;
  limite_exposicion_mxn: number | null;
  evento_id: string | null;
  creado_en: string;
}

interface Analista {
  clave: string;
  nombre: string;
  mercado: string;
  modelo_estocastico: string;
  descripcion: string;
  config: Record<string, unknown>;
  activo: boolean;
}

interface Corrida {
  id: string;
  origen: string;
  iniciada_en: string;
  propuestas_creadas: number;
  resultado: { analista: string; estado: string; detalle: string }[];
}

interface Bitacora {
  id: string;
  accion: string;
  nota: string | null;
  creado_en: string;
  propuesta_id: string | null;
}

interface Exposicion {
  capital_en_pool: number;
  premios_en_riesgo: number;
  reserva_minima: number;
  reserva_fondeada: number | null;
  kill_switch_activo: boolean;
}

interface Producto {
  clave: string;
  nombre: string;
  dias_resolucion: number;
}

const TABS = [
  { clave: "pendiente", label: "Hallazgos" },
  { clave: "aceptada", label: "Riesgo" },
  { clave: "aprobada_riesgo", label: "Publicar" },
  { clave: "historial", label: "Historial" },
  { clave: "analistas", label: "Analistas" },
] as const;
type Tab = (typeof TABS)[number]["clave"];

const ACCION_LABEL: Record<string, string> = {
  agente_propone: "Analista propone",
  mesa_acepta: "Mesa acepta",
  mesa_rechaza: "Mesa rechaza",
  riesgo_aprueba: "Riesgo aprueba",
  riesgo_rechaza: "Riesgo rechaza",
  publicada: "Publicada en la app",
};

const mxn = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(Number(n)).toLocaleString("es-MX")}`);
const pct = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(Number(p) * 100)}%`);
const DIA = 86_400_000;

export default function MesaPage() {
  const [tab, setTab] = useState<Tab>("pendiente");
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [analistas, setAnalistas] = useState<Analista[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [bitacora, setBitacora] = useState<Bitacora[]>([]);
  const [exposicion, setExposicion] = useState<Exposicion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [corriendo, setCorriendo] = useState(false);

  async function cargar() {
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      supabase.from("mesa_propuestas").select("*").order("creado_en", { ascending: false }).limit(200),
      supabase.from("mesa_analistas").select("*").order("clave"),
      supabase.from("productos").select("clave, nombre, dias_resolucion").eq("activo", true).order("dias_resolucion", { ascending: false }),
      supabase.from("mesa_corridas").select("*").order("iniciada_en", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("mesa_bitacora").select("*").order("creado_en", { ascending: false }).limit(15),
      supabase.rpc("calcular_exposicion_global"),
    ]);
    const err = r1.error || r2.error || r3.error;
    if (err) {
      setError(err.message);
      setCargando(false);
      return;
    }
    setPropuestas((r1.data as Propuesta[]) ?? []);
    setAnalistas((r2.data as Analista[]) ?? []);
    setProductos((r3.data as Producto[]) ?? []);
    setCorrida((r4.data as Corrida) ?? null);
    setBitacora((r5.data as Bitacora[]) ?? []);
    setExposicion(r6.data?.[0] ?? null);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    setMensaje(null);
    const { error } = await supabase.rpc(fn, args);
    setMensaje(error ? { tipo: "error", texto: error.message } : { tipo: "ok", texto: ok });
    if (!error) await cargar();
  }

  async function correrAnalistas() {
    setCorriendo(true);
    setMensaje(null);
    const { data } = await supabase.auth.getSession();
    try {
      const res = await fetch("/api/mesa/correr", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      const json = await res.json();
      setMensaje(
        res.ok
          ? { tipo: "ok", texto: `Corrida lista: ${json.propuestas_creadas} hallazgo(s) nuevo(s).` }
          : { tipo: "error", texto: json.error ?? `HTTP ${res.status}` }
      );
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    }
    setCorriendo(false);
    await cargar();
  }

  async function actualizarAnalista(clave: string, cambios: Partial<Analista>) {
    const { error } = await supabase.from("mesa_analistas").update(cambios).eq("clave", clave);
    setMensaje(error ? { tipo: "error", texto: error.message } : { tipo: "ok", texto: "Analista actualizado." });
    if (!error) cargar();
  }

  if (cargando) return <p className="text-sm text-neutral-500">Cargando…</p>;
  if (error)
    return (
      <p className="text-sm text-red-600">
        No se pudo cargar la mesa: {error}. ¿Ya corriste la migración 0012?
      </p>
    );

  const porEstado = (e: Estado) => propuestas.filter((p) => p.estado === e);
  const hace30 = Date.now() - 30 * DIA;
  const publicadas30 = propuestas.filter((p) => p.estado === "publicada" && new Date(p.creado_en).getTime() > hace30).length;
  const nombreAnalista = (clave: string) => analistas.find((a) => a.clave === clave)?.nombre ?? clave;
  const lista =
    tab === "historial"
      ? propuestas.filter((p) => p.estado === "publicada" || p.estado === "rechazada")
      : tab === "analistas"
        ? []
        : porEstado(tab);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-lg font-semibold">Mesa de derivados</h1>
          <p className="text-sm text-neutral-500">
            Analistas proponen → la mesa acepta → Riesgo pone límite → se publica en la app.
          </p>
          {corrida && (
            <p className="mt-1 text-xs text-neutral-400">
              Última corrida ({corrida.origen}): {new Date(corrida.iniciada_en).toLocaleString("es-MX")} ·{" "}
              {corrida.propuestas_creadas} hallazgo(s)
            </p>
          )}
        </div>
        <button
          onClick={correrAnalistas}
          disabled={corriendo}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {corriendo ? "Analistas trabajando…" : "Correr analistas"}
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi label="Hallazgos por revisar" valor={String(porEstado("pendiente").length)} alerta={porEstado("pendiente").length > 0} />
        <Kpi label="En Riesgo" valor={String(porEstado("aceptada").length)} />
        <Kpi label="Listas para publicar" valor={String(porEstado("aprobada_riesgo").length)} />
        <Kpi label="Publicadas (30 días)" valor={String(publicadas30)} />
        <Kpi
          label="Premios en riesgo / reserva fondeada"
          valor={exposicion ? `${mxn(exposicion.premios_en_riesgo)} / ${mxn(exposicion.reserva_fondeada)}` : "—"}
          nota={exposicion?.reserva_fondeada == null ? "Reserva sin fondear: kill switch global inactivo" : undefined}
        />
        <Kpi
          label="Kill switch global"
          valor={exposicion?.kill_switch_activo ? "ACTIVO" : "Normal"}
          alerta={!!exposicion?.kill_switch_activo}
        />
      </div>

      {mensaje && (
        <div
          className={`mb-4 rounded-md border px-4 py-2.5 text-sm ${
            mensaje.tipo === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
        {TABS.map((t) => {
          const n = t.clave === "historial" || t.clave === "analistas" ? null : porEstado(t.clave).length;
          return (
            <button
              key={t.clave}
              onClick={() => setTab(t.clave)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.clave ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {t.label}
              {n ? <span className="ml-1.5 rounded-full bg-neutral-900 px-1.5 text-[10px] text-white">{n}</span> : null}
            </button>
          );
        })}
      </nav>

      {tab === "analistas" ? (
        <PanelAnalistas analistas={analistas} corrida={corrida} onCambio={actualizarAnalista} />
      ) : (
        <div className="flex flex-col gap-4">
          {lista.length === 0 && <p className="py-6 text-center text-sm text-neutral-400">Nada en esta bandeja.</p>}
          {lista.map((p) => (
            <TarjetaPropuesta key={p.id} p={p} analista={nombreAnalista(p.analista_clave)}>
              {p.estado === "pendiente" && (
                <AccionMesa
                  onAceptar={(nota) => rpc("mesa_decidir_analista", { p_propuesta_id: p.id, p_aceptar: true, p_nota: nota || null }, "Aceptada: pasa a Riesgo.")}
                  onRechazar={(nota) => rpc("mesa_decidir_analista", { p_propuesta_id: p.id, p_aceptar: false, p_nota: nota }, "Rechazada.")}
                />
              )}
              {p.estado === "aceptada" && (
                <AccionRiesgo
                  p={p}
                  onAprobar={(limite, nota) =>
                    rpc("mesa_decidir_riesgo", { p_propuesta_id: p.id, p_aprobar: true, p_limite_mxn: limite, p_nota: nota || null }, "Aprobada por Riesgo: lista para publicar.")
                  }
                  onRechazar={(nota) => rpc("mesa_decidir_riesgo", { p_propuesta_id: p.id, p_aprobar: false, p_nota: nota }, "Rechazada por Riesgo.")}
                />
              )}
              {p.estado === "aprobada_riesgo" && (
                <AccionPublicar
                  p={p}
                  productos={productos}
                  onPublicar={(nivel, aceptoLegal) =>
                    rpc(
                      "mesa_publicar",
                      { p_propuesta_id: p.id, p_producto_clave: nivel, p_acepto_riesgo_legal: aceptoLegal },
                      "Publicada: el evento y su ciclo ya están en la app."
                    )
                  }
                />
              )}
              {(p.estado === "publicada" || p.estado === "rechazada") && <Resolucion p={p} />}
            </TarjetaPropuesta>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-10 text-sm font-semibold text-neutral-700">Bitácora</h2>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {bitacora.length === 0 && <p className="p-3 text-sm text-neutral-400">Sin movimientos todavía.</p>}
        {bitacora.map((b) => (
          <div key={b.id} className="flex gap-3 border-b border-neutral-100 px-3 py-2 text-xs last:border-0">
            <span className="w-32 shrink-0 tabular-nums text-neutral-400">{new Date(b.creado_en).toLocaleString("es-MX")}</span>
            <span className="w-32 shrink-0 font-medium">{ACCION_LABEL[b.accion] ?? b.accion}</span>
            <span className="truncate text-neutral-600">{b.nota}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, valor, alerta, nota }: { label: string; valor: string; alerta?: boolean; nota?: string }) {
  return (
    <div className={`rounded-lg border p-4 ${alerta ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"}`}>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{valor}</p>
      {nota && <p className="mt-1 text-[11px] text-amber-700">{nota}</p>}
    </div>
  );
}

function TarjetaPropuesta({ p, analista, children }: { p: Propuesta; analista: string; children: React.ReactNode }) {
  const [verDatos, setVerDatos] = useState(false);
  const niveles = p.payoff?.niveles ?? [];
  const supuestos = Array.from(new Set(niveles.flatMap((n) => n.supuestos)));
  const baja = p.prob_baja ?? p.probabilidad;
  const alta = p.prob_alta ?? p.probabilidad;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-700">{analista}</span>
          <span>{p.fecha_texto}</span>
          <span>· {p.fuente_resolucion}</span>
          {p.riesgo_legal !== "bajo" && (
            <span
              title={p.nota_legal}
              className={`rounded px-1.5 py-0.5 font-medium ${p.riesgo_legal === "alto" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
            >
              Riesgo legal {p.riesgo_legal}
            </span>
          )}
        </div>
        {p.riesgo_legal === "alto" && <p className="mb-1 text-xs text-red-700">{p.nota_legal}</p>}
        <p className="font-medium">{p.pregunta}</p>
        {p.descripcion_usuario && p.descripcion_usuario !== p.pregunta && (
          <p className="mt-0.5 text-xs text-neutral-500">Usuario verá: “{p.descripcion_usuario}”</p>
        )}
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold text-neutral-700">Base estocástica</p>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{pct(p.probabilidad)}</span>
            <span className="text-xs text-neutral-500">
              IC 90%: {pct(baja)}–{pct(alta)}
            </span>
          </div>
          <div className="relative mb-2 h-2 rounded bg-neutral-100">
            <div className="absolute h-2 rounded bg-neutral-300" style={{ left: `${baja * 100}%`, width: `${Math.max(1, (alta - baja) * 100)}%` }} />
            <div className="absolute h-2 w-0.5 bg-neutral-900" style={{ left: `${p.probabilidad * 100}%` }} />
          </div>
          <p className="text-xs text-neutral-500">
            Modelo: <span className="font-medium text-neutral-700">{p.modelo_estocastico}</span>
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {Object.entries(p.parametros)
              .map(([k, v]) => `${k}=${v}`)
              .join(" · ")}
          </p>
          <button onClick={() => setVerDatos(!verDatos)} className="mt-1 text-xs text-neutral-400 underline">
            {verDatos ? "Ocultar datos" : "Ver datos de la fuente"}
          </button>
          {verDatos && (
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-neutral-50 p-2 text-[10px] leading-tight text-neutral-600">
              {JSON.stringify(p.datos, null, 2)}
            </pre>
          )}
        </div>
        <div className="text-sm">
          <p className="mb-1 text-xs font-semibold text-neutral-700">Lectura del analista</p>
          <p className="text-neutral-700">{p.tesis}</p>
          {p.riesgos && <p className="mt-2 text-xs text-amber-700">Riesgos: {p.riesgos}</p>}
        </div>
      </div>

      {niveles.length > 0 && (
        <div className="overflow-x-auto border-t border-neutral-100 px-4 py-3">
          <p className="mb-1 text-xs font-semibold text-neutral-700">Payoff por nivel (digital: paga el premio si ocurre)</p>
          <table className="w-full text-xs tabular-nums">
            <thead className="text-neutral-400">
              <tr className="text-right">
                <th className="py-1 text-left font-normal">Nivel</th>
                <th className="font-normal">Rendimiento pool</th>
                <th className="font-normal">Premio neto</th>
                <th className="font-normal">Valor esperado</th>
                <th className="font-normal">Fondeo</th>
                <th className="font-normal">Déficit peor caso</th>
              </tr>
            </thead>
            <tbody>
              {niveles.map((n) => (
                <tr key={n.nivel} className={`text-right ${n.nivel === p.producto_sugerido ? "font-semibold" : ""}`}>
                  <td className="py-1 text-left">
                    {n.nombre} <span className="font-normal text-neutral-400">{n.dias}d</span>
                    {n.nivel === p.producto_sugerido && <span className="ml-1 text-[10px] text-emerald-700">sugerido</span>}
                  </td>
                  <td>{mxn(n.rendimiento_pool)}</td>
                  <td>{mxn(n.premio_neto)}</td>
                  <td>{mxn(n.valor_esperado)}</td>
                  <td>{mxn(n.fondeo_disponible)}</td>
                  <td className={n.deficit_peor_caso > 0 ? "text-red-600" : ""}>{mxn(n.deficit_peor_caso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {supuestos.length > 0 && <p className="mt-1 text-[11px] text-amber-700">Supuestos: {supuestos.join(" · ")}</p>}
        </div>
      )}

      <div className="border-t border-neutral-100 bg-neutral-50 p-3">{children}</div>
    </div>
  );
}

function AccionMesa({ onAceptar, onRechazar }: { onAceptar: (nota: string) => void; onRechazar: (nota: string) => void }) {
  const [nota, setNota] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota (obligatoria para rechazar)"
        className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
      />
      <button onClick={() => onAceptar(nota)} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white">
        Aceptar hallazgo
      </button>
      <button onClick={() => onRechazar(nota)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium">
        Rechazar
      </button>
    </div>
  );
}

function AccionRiesgo({
  p,
  onAprobar,
  onRechazar,
}: {
  p: Propuesta;
  onAprobar: (limite: number, nota: string) => void;
  onRechazar: (nota: string) => void;
}) {
  const sugerido = p.payoff?.niveles?.find((n) => n.nivel === p.producto_sugerido) ?? p.payoff?.niveles?.[0];
  const [limite, setLimite] = useState(String(sugerido?.peor_caso ?? ""));
  const [nota, setNota] = useState("");
  const ancho = (p.prob_alta ?? p.probabilidad) - (p.prob_baja ?? p.probabilidad);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-neutral-600">
        <span>
          Peor caso ({sugerido?.nombre ?? "—"}): <b className="tabular-nums">{mxn(sugerido?.peor_caso)}</b>
        </span>
        <span>
          Lo pone la reserva: <b className={`tabular-nums ${sugerido && sugerido.deficit_peor_caso > 0 ? "text-red-600" : ""}`}>{mxn(sugerido?.deficit_peor_caso)}</b>
        </span>
        <span className={ancho > 0.3 ? "text-amber-700" : ""}>Incertidumbre del modelo: ±{Math.round((ancho * 100) / 2)} pts</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-neutral-500">Límite de exposición $</label>
        <input value={limite} onChange={(e) => setLimite(e.target.value)} type="number" className="w-32 rounded-md border border-neutral-300 px-2 py-1.5 text-xs" />
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota de Riesgo" className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs" />
        <button onClick={() => onAprobar(Number(limite), nota)} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white">
          Aprobar con límite
        </button>
        <button onClick={() => onRechazar(nota)} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium">
          Rechazar
        </button>
      </div>
    </div>
  );
}

function AccionPublicar({
  p,
  productos,
  onPublicar,
}: {
  p: Propuesta;
  productos: Producto[];
  onPublicar: (nivel: string, aceptoLegal: boolean) => void;
}) {
  // Misma regla que mesa_publicar(): el evento se resuelve después de que
  // cierra la venta del nivel y a más tardar 7 días después.
  const dias = (new Date(p.fecha_resolucion).getTime() - Date.now()) / DIA;
  const validos = productos.filter((n) => dias >= n.dias_resolucion && dias - n.dias_resolucion <= 7);
  const inicial = validos.find((n) => n.clave === p.producto_sugerido)?.clave ?? validos[0]?.clave ?? "";
  const [nivel, setNivel] = useState(inicial);
  const [aceptoLegal, setAceptoLegal] = useState(false);
  const bloqueadoLegal = p.riesgo_legal === "alto" && !aceptoLegal;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-500">Límite de Riesgo: {mxn(p.limite_exposicion_mxn)}</span>
      {validos.length === 0 ? (
        <span className="text-red-600">
          Ningún nivel cabe: el evento se resuelve en {Math.round(dias)} días. Rechazar y esperar la siguiente corrida.
        </span>
      ) : (
        <>
          <select value={nivel} onChange={(e) => setNivel(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1.5">
            {validos.map((n) => (
              <option key={n.clave} value={n.clave}>
                {n.nombre} ({n.dias_resolucion} días)
              </option>
            ))}
          </select>
          {p.riesgo_legal === "alto" && (
            <label className="flex items-center gap-1.5 text-red-700">
              <input type="checkbox" checked={aceptoLegal} onChange={(e) => setAceptoLegal(e.target.checked)} />
              Acepto el riesgo legal
            </label>
          )}
          <button
            onClick={() => onPublicar(nivel, aceptoLegal)}
            disabled={bloqueadoLegal}
            className="rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-40"
          >
            Publicar en la app
          </button>
        </>
      )}
    </div>
  );
}

function Resolucion({ p }: { p: Propuesta }) {
  return (
    <div className="text-xs text-neutral-600">
      {p.estado === "publicada" ? (
        <span>
          Publicada como <code className="rounded bg-white px-1">{p.evento_id}</code> con límite {mxn(p.limite_exposicion_mxn)}.
        </span>
      ) : (
        <span className="text-red-700">Rechazada: {p.nota_riesgo || p.nota_revision}</span>
      )}
    </div>
  );
}

function PanelAnalistas({
  analistas,
  corrida,
  onCambio,
}: {
  analistas: Analista[];
  corrida: Corrida | null;
  onCambio: (clave: string, cambios: Partial<Analista>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {analistas.map((a) => {
        const ultimos = corrida?.resultado?.filter((r) => r.analista === a.clave) ?? [];
        return (
          <div key={a.clave} className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {a.nombre} <span className="font-normal text-neutral-400">· {a.mercado}</span>
              </span>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={a.activo} onChange={(e) => onCambio(a.clave, { activo: e.target.checked })} />
                Activo
              </label>
            </div>
            <p className="text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">{a.modelo_estocastico}.</span> {a.descripcion}
            </p>
            {a.clave === "tasas" && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <label className="text-neutral-500">Próxima decisión de Banxico</label>
                <input
                  type="date"
                  defaultValue={(a.config.proxima_decision as string) ?? ""}
                  onBlur={(e) => onCambio(a.clave, { config: { ...a.config, proxima_decision: e.target.value || null } })}
                  className="rounded-md border border-neutral-300 px-2 py-1"
                />
              </div>
            )}
            {ultimos.map((u, i) => (
              <p key={i} className={`mt-1 text-xs ${u.estado === "error" ? "text-red-600" : u.estado === "sin_datos" ? "text-amber-700" : "text-neutral-500"}`}>
                Última corrida: {u.estado.replace("_", " ")} · {u.detalle}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
