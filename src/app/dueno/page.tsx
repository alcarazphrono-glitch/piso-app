"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// Tablero del dueño -- una sola pantalla para ver la empresa: estado en
// vivo, departamentos y sus herramientas, la app, y la bitácora de
// decisiones de negocio. No calcula economía: los números de Finanzas
// viven en /consola/palancas (modelo único, 0014). Aquí solo se cuenta lo
// que ya pasó en la base, vía dueno_estado() (0016).

type Ciclo = {
  id: string;
  nivel: string;
  evento: string;
  ocupados: number;
  requeridos: number;
  estado: string;
  resuelve: string;
};

type Estado = {
  usuarios_total: number;
  usuarios_7d: number;
  usuarios_24h: number;
  usuarios_modo_real: number;
  ciclos_abiertos: number;
  ciclos_resueltos: number;
  pool_abierto: number;
  boletos_7d: number;
  boletos_total: number;
  eventos_abiertos: number;
  ciclos: Ciclo[];
  lista_espera?: number;
  lista_espera_7d?: number;
  mesa_pendientes?: number;
  decisiones_por_revisar: number;
  infra: Record<"0011_legal_sorteo" | "0012_mesa" | "0013_lista_espera" | "0014_economia", boolean>;
  generado_en: string;
};

type Decision = {
  id: string;
  titulo: string;
  departamento: Depto;
  por_que: string;
  resultado_esperado: string;
  como_medir: string;
  revisar_el: string | null;
  estado: "abierta" | "revisada" | "descartada";
  resultado_real: string | null;
  aprendizaje: string | null;
  salio_como_esperabamos: "si" | "parcial" | "no" | null;
  creado_en: string;
};

type Depto = "direccion" | "tecnologia" | "finanzas" | "behavioral" | "legal" | "mesa" | "marketing";

const DEPTOS: Record<Depto, string> = {
  direccion: "Dirección General",
  tecnologia: "Tecnología",
  finanzas: "Finanzas",
  behavioral: "Behavioral",
  legal: "Legal",
  mesa: "Mesa y Riesgo",
  marketing: "Crecimiento",
};

type Infra = keyof Estado["infra"];

const DEPARTAMENTOS: {
  clave: Depto;
  que_hace: string;
  links: { href: string; label: string }[];
  necesita?: Infra;
}[] = [
  {
    clave: "direccion",
    que_hace: "Decide, junta departamentos y registra cada decisión con lo que esperamos que pase.",
    links: [{ href: "#decisiones", label: "Bitácora de decisiones" }],
  },
  {
    clave: "tecnologia",
    que_hace: "La app y su operación diaria: eventos, ciclos, usuarios y analytics.",
    links: [
      { href: "/admin/eventos", label: "PISO Core" },
      { href: "/admin/usuarios", label: "Usuarios" },
      { href: "/admin/analytics", label: "Analytics" },
    ],
  },
  {
    clave: "finanzas",
    que_hace: "Cuánto deja cada usuario. Palancas (cuota, días, N, alpha) y un solo cálculo para toda la empresa.",
    links: [
      { href: "/consola/palancas", label: "Palancas" },
      { href: "/consola", label: "Resumen financiero" },
    ],
    necesita: "0014_economia",
  },
  {
    clave: "mesa",
    que_hace: "Agentes analistas proponen eventos; la mesa acepta y Riesgo pone límites antes de publicar.",
    links: [
      { href: "/consola/mesa", label: "Mesa de derivados" },
      { href: "/consola/riesgo", label: "Riesgo" },
      { href: "/consola/reserva", label: "Reserva" },
    ],
    necesita: "0012_mesa",
  },
  {
    clave: "behavioral",
    que_hace: "Cómo se siente el producto: experimentos, contenido y referidos.",
    links: [
      { href: "/admin/experimentos", label: "Experimentos" },
      { href: "/admin/contenido", label: "Contenido" },
      { href: "/admin/referidos", label: "Referidos" },
    ],
  },
  {
    clave: "legal",
    que_hace: "Custodio regulado, sorteo verificable, ledger inmutable y consentimientos.",
    links: [{ href: "/trust-center", label: "Trust Center" }],
    necesita: "0011_legal_sorteo",
  },
  {
    clave: "marketing",
    que_hace: "Lista de espera y llegada de usuarios nuevos.",
    links: [{ href: "/unete", label: "Landing /unete" }],
    necesita: "0013_lista_espera",
  },
];

const INFRA: { clave: Infra; label: string }[] = [
  { clave: "0011_legal_sorteo", label: "0011 · Ledger, auditoría y sorteo verificable" },
  { clave: "0012_mesa", label: "0012 · Mesa de derivados" },
  { clave: "0013_lista_espera", label: "0013 · Lista de espera" },
  { clave: "0014_economia", label: "0014 · Palancas de Finanzas" },
];

const mxn = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
const num = (n: number | undefined) => (n === undefined ? "—" : new Intl.NumberFormat("es-MX").format(n));
const fecha = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

export default function DuenoPage() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisiones, setDecisiones] = useState<Decision[]>([]);

  const cargar = useCallback(async () => {
    const [e, d] = await Promise.all([
      supabase.rpc("dueno_estado"),
      supabase.from("decisiones").select("*").order("creado_en", { ascending: false }),
    ]);
    if (e.error) setError(e.error.message);
    else {
      setError(null);
      setEstado(e.data as Estado);
    }
    if (!d.error) setDecisiones((d.data ?? []) as Decision[]);
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 30_000);
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargar]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-neutral-500">PISO · Tablero del dueño</p>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-neutral-400">
              <span className={`h-2 w-2 rounded-full ${error ? "bg-red-500" : "bg-emerald-400 animate-pulse"}`} />
              {error ? "Sin conexión con la base" : estado ? `En vivo · ${new Date(estado.generado_en).toLocaleTimeString("es-MX")}` : "Cargando…"}
            </p>
          </div>
          <Link href="/home" className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900">
            Abrir la app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
        {error && (
          <p className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
            {error}. ¿Ya corriste la migración 0016 en Supabase?
          </p>
        )}

        <Seccion titulo="Hoy en PISO">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Usuarios" valor={num(estado?.usuarios_total)} nota={estado && `+${estado.usuarios_24h} hoy · +${estado.usuarios_7d} en 7 días`} />
            <Kpi
              label="Lista de espera"
              valor={estado?.infra["0013_lista_espera"] ? num(estado.lista_espera) : "—"}
              nota={estado?.infra["0013_lista_espera"] ? `+${estado.lista_espera_7d} en 7 días` : "Falta correr 0013"}
            />
            <Kpi label="Dinero en ciclos abiertos" valor={estado ? mxn(estado.pool_abierto) : "—"} nota={estado && `${estado.ciclos_abiertos} ciclos abiertos`} />
            <Kpi label="Boletos" valor={num(estado?.boletos_total)} nota={estado && `${estado.boletos_7d} en 7 días`} />
            <Kpi label="Usuarios en modo real" valor={num(estado?.usuarios_modo_real)} />
            <Kpi label="Eventos abiertos" valor={num(estado?.eventos_abiertos)} nota={estado && `${estado.ciclos_resueltos} ciclos resueltos`} />
            <Kpi
              label="Propuestas de la Mesa"
              valor={estado?.infra["0012_mesa"] ? num(estado.mesa_pendientes) : "—"}
              nota={estado?.infra["0012_mesa"] ? "esperando tu decisión" : "Falta correr 0012"}
              alerta={!!estado?.mesa_pendientes}
            />
            <Kpi
              label="Decisiones por revisar"
              valor={num(estado?.decisiones_por_revisar)}
              nota="ya llegó su fecha"
              alerta={!!estado?.decisiones_por_revisar}
            />
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Se actualiza solo cada 30 segundos. Márgenes y LTV están en{" "}
            <Link href="/consola/palancas" className="underline">Palancas</Link> (un solo cálculo de Finanzas); embudos y
            retención en PostHog.
          </p>
        </Seccion>

        <Seccion titulo="Ciclos abiertos">
          {!estado?.ciclos.length ? (
            <p className="text-sm text-neutral-500">No hay ciclos abiertos ahora.</p>
          ) : (
            <div className="space-y-2">
              {estado.ciclos.map((c) => {
                const pct = Math.min(100, Math.round((c.ocupados / Math.max(1, c.requeridos)) * 100));
                return (
                  <div key={c.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span>
                        <span className="font-medium">{c.nivel}</span> <span className="text-neutral-400">· {c.evento}</span>
                      </span>
                      <span className="text-neutral-400">
                        {num(c.ocupados)}/{num(c.requeridos)} · resuelve {fecha(c.resuelve)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-neutral-800">
                      <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Seccion>

        <Seccion titulo="Departamentos">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {DEPARTAMENTOS.map((d) => {
              const listo = !d.necesita || estado?.infra[d.necesita];
              return (
                <div key={d.clave} className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">{DEPTOS[d.clave]}</h3>
                    {estado && (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${listo ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}`}>
                        {listo ? "Listo" : "Falta mergear/correr"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 flex-1 text-sm text-neutral-400">{d.que_hace}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.links.map((l) => (
                      <Link key={l.href} href={l.href} className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800">
                        {l.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Seccion>

        <Bitacora decisiones={decisiones} alCambiar={cargar} />

        <div className="grid gap-6 md:grid-cols-2">
          <Seccion titulo="Agentes">
            <div className="rounded-lg border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
              <p className="text-neutral-200">Aquí vas a coordinar a tus agentes.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  Analistas de la Mesa (tasas, inflación, tipo de cambio, deportes, cripto, tendencias): ya proponen eventos en{" "}
                  <Link href="/consola/mesa" className="underline">la Mesa</Link>.
                </li>
                <li>Agentes de contenido de Behavioral: arrancan cuando la landing esté arriba.</li>
                <li>Próximo paso: verlos correr, pausarlos y darles instrucciones desde aquí.</li>
              </ul>
            </div>
          </Seccion>

          <Seccion titulo="Infraestructura en la base">
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center gap-2">
                <Punto ok={!error && !!estado} /> 0016 · Tablero del dueño y bitácora
              </li>
              {INFRA.map((i) => (
                <li key={i.clave} className="flex items-center gap-2">
                  <Punto ok={!!estado?.infra[i.clave]} /> {i.label}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-neutral-500">Gris = todavía no está corrida en Supabase.</p>
          </Seccion>
        </div>
      </main>
    </div>
  );
}

function Bitacora({ decisiones, alCambiar }: { decisiones: Decision[]; alCambiar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const revisadas = decisiones.filter((d) => d.estado === "revisada");
  const aciertos = revisadas.filter((d) => d.salio_como_esperabamos === "si").length;

  return (
    <section id="decisiones" className="scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Bitácora de decisiones</h2>
          <p className="text-sm text-neutral-400">
            Qué decidimos, por qué y qué esperamos. Después anotamos qué pasó de verdad y qué aprendimos.
            {revisadas.length > 0 && ` Hasta hoy salieron como esperábamos ${aciertos} de ${revisadas.length}.`}
          </p>
        </div>
        <button onClick={() => setAbierto(!abierto)} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-900">
          {abierto ? "Cerrar" : "Nueva decisión"}
        </button>
      </div>

      {abierto && (
        <NuevaDecision
          alGuardar={() => {
            setAbierto(false);
            alCambiar();
          }}
        />
      )}

      {decisiones.length === 0 ? (
        <p className="text-sm text-neutral-500">Todavía no hay decisiones registradas.</p>
      ) : (
        <div className="space-y-2">
          {decisiones.map((d) => (
            <TarjetaDecision key={d.id} d={d} alCambiar={alCambiar} />
          ))}
        </div>
      )}
    </section>
  );
}

const input = "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm placeholder:text-neutral-600";

function NuevaDecision({ alGuardar }: { alGuardar: () => void }) {
  const [f, setF] = useState({
    titulo: "",
    departamento: "direccion" as Depto,
    por_que: "",
    resultado_esperado: "",
    como_medir: "",
    revisar_el: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function guardar() {
    if (!f.titulo.trim()) return setError("Escribe qué decidiste.");
    setGuardando(true);
    const { error } = await supabase.from("decisiones").insert({ ...f, revisar_el: f.revisar_el || null });
    setGuardando(false);
    if (error) return setError(error.message);
    alGuardar();
  }

  return (
    <div className="mb-4 grid gap-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4 md:grid-cols-2">
      <input className={`${input} md:col-span-2`} placeholder="¿Qué decidimos?" value={f.titulo} onChange={set("titulo")} />
      <select className={input} value={f.departamento} onChange={set("departamento")}>
        {(Object.keys(DEPTOS) as Depto[]).map((k) => (
          <option key={k} value={k}>
            {DEPTOS[k]}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm text-neutral-400">
        Revisar el
        <input type="date" className={input} value={f.revisar_el} onChange={set("revisar_el")} />
      </label>
      <textarea className={input} rows={2} placeholder="¿Por qué?" value={f.por_que} onChange={set("por_que")} />
      <textarea className={input} rows={2} placeholder="¿Qué esperamos que pase?" value={f.resultado_esperado} onChange={set("resultado_esperado")} />
      <input className={`${input} md:col-span-2`} placeholder="¿Cómo lo vamos a medir? (métrica, dónde se ve)" value={f.como_medir} onChange={set("como_medir")} />
      <div className="flex items-center gap-3 md:col-span-2">
        <button onClick={guardar} disabled={guardando} className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50">
          {guardando ? "Guardando…" : "Guardar decisión"}
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </div>
  );
}

function TarjetaDecision({ d, alCambiar }: { d: Decision; alCambiar: () => void }) {
  const [revisando, setRevisando] = useState(false);
  const [r, setR] = useState({ resultado_real: "", aprendizaje: "", salio_como_esperabamos: "si" as "si" | "parcial" | "no" });
  const [error, setError] = useState<string | null>(null);
  const vencida = d.estado === "abierta" && d.revisar_el && d.revisar_el <= new Date().toISOString().slice(0, 10);

  async function cerrar(estado: "revisada" | "descartada") {
    const cambios =
      estado === "revisada" ? { ...r, estado, revisado_en: new Date().toISOString() } : { estado, revisado_en: new Date().toISOString() };
    const { error } = await supabase.from("decisiones").update(cambios).eq("id", d.id);
    if (error) return setError(error.message);
    setRevisando(false);
    alCambiar();
  }

  const chip = {
    abierta: vencida ? "bg-amber-950 text-amber-300" : "bg-sky-950 text-sky-300",
    revisada: "bg-emerald-950 text-emerald-300",
    descartada: "bg-neutral-800 text-neutral-400",
  }[d.estado];
  const resultado = { si: "Salió como esperábamos", parcial: "Salió a medias", no: "No salió como esperábamos" };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{d.titulo}</p>
          <p className="text-xs text-neutral-500">
            {DEPTOS[d.departamento]} · {fecha(d.creado_en)}
            {d.revisar_el && ` · revisar el ${fecha(d.revisar_el + "T12:00:00")}`}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${chip}`}>
          {d.estado === "abierta" ? (vencida ? "Toca revisar" : "Abierta") : d.estado === "revisada" ? "Revisada" : "Descartada"}
        </span>
      </div>

      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
        <Campo label="Por qué" texto={d.por_que} />
        <Campo label="Qué esperamos" texto={d.resultado_esperado} />
        <Campo label="Cómo medimos" texto={d.como_medir} />
        {d.estado === "revisada" && (
          <>
            <Campo label="Qué pasó" texto={d.resultado_real} />
            <Campo label="Qué aprendimos" texto={d.aprendizaje} />
            <Campo label="Veredicto" texto={d.salio_como_esperabamos && resultado[d.salio_como_esperabamos]} />
          </>
        )}
      </dl>

      {d.estado === "abierta" && !revisando && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => setRevisando(true)} className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800">
            Anotar resultado real
          </button>
          <button onClick={() => cerrar("descartada")} className="rounded-md px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-800">
            Descartar
          </button>
        </div>
      )}

      {revisando && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <textarea className={input} rows={2} placeholder="¿Qué pasó de verdad? (con el número)" value={r.resultado_real} onChange={(e) => setR({ ...r, resultado_real: e.target.value })} />
          <textarea className={input} rows={2} placeholder="¿Qué aprendimos?" value={r.aprendizaje} onChange={(e) => setR({ ...r, aprendizaje: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            {(["si", "parcial", "no"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setR({ ...r, salio_como_esperabamos: k })}
                className={`rounded-md px-2.5 py-1 text-xs ${r.salio_como_esperabamos === k ? "bg-white text-neutral-900" : "border border-neutral-700"}`}
              >
                {resultado[k]}
              </button>
            ))}
            <button onClick={() => cerrar("revisada")} className="ml-auto rounded-md bg-emerald-400 px-3 py-1.5 text-xs font-medium text-neutral-950">
              Guardar revisión
            </button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, valor, nota, alerta }: { label: string; valor: string; nota?: string | null | false; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${alerta ? "border-amber-700 bg-amber-950/30" : "border-neutral-800 bg-neutral-900"}`}>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{valor}</p>
      {nota && <p className="mt-1 text-xs text-neutral-500">{nota}</p>}
    </div>
  );
}

function Campo({ label, texto }: { label: string; texto: string | null | undefined }) {
  if (!texto) return null;
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="text-neutral-300">{texto}</dd>
    </div>
  );
}

function Punto({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-neutral-600"}`} />;
}
