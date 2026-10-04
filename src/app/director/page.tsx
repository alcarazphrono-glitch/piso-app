"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// Portal del director -- vista ejecutiva de PISO. Tres ideas:
//   1. Ver la empresa en vivo (director_estado, 0016).
//   2. Decidir: toda decisión queda en la bitácora con lo que esperamos;
//      si trae un cambio en la app, se aplica al aprobarla (decidir()).
//   3. Entrar a cada departamento y a la app.
// No calcula economía: márgenes y LTV salen del modelo único de Finanzas
// (/consola/palancas). Aquí solo se cambian los parámetros que ese modelo lee.

type Ciclo = { id: string; nivel: string; evento: string; ocupados: number; requeridos: number; resuelve: string };
type Infra = "0011_legal_sorteo" | "0012_mesa" | "0013_lista_espera" | "0014_economia";

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
  decisiones_propuestas: number;
  decisiones_por_revisar: number;
  infra: Record<Infra, boolean>;
  generado_en: string;
};

type Producto = {
  clave: string;
  nombre: string;
  precio: number;
  gente_requerida: number;
  dias_resolucion: number;
  activo: boolean;
  cuota_evento?: number;
  alpha_em?: number | null;
};
type Parametros = { productos: Producto[]; economia: Record<string, number | boolean | null> | null };

type Cambio = { tabla: "productos" | "economia_parametros"; clave?: string; campo: string; valor: number | boolean };

type Depto = "direccion" | "tecnologia" | "finanzas" | "behavioral" | "legal" | "mesa" | "marketing";

type Decision = {
  id: string;
  titulo: string;
  departamento: Depto;
  por_que: string;
  resultado_esperado: string;
  como_medir: string;
  revisar_el: string | null;
  estado: "propuesta" | "abierta" | "revisada" | "descartada";
  propuesta_por: string;
  cambio: Cambio | null;
  cambio_antes: { valor: unknown } | null;
  aplicado_en: string | null;
  resultado_real: string | null;
  aprendizaje: string | null;
  salio_como_esperabamos: "si" | "parcial" | "no" | null;
  creado_en: string;
};

const DEPTOS: Record<Depto, string> = {
  direccion: "Dirección General",
  tecnologia: "Tecnología",
  finanzas: "Finanzas",
  behavioral: "Behavioral",
  legal: "Legal",
  mesa: "Mesa y Riesgo",
  marketing: "Crecimiento",
};

const CAMPOS_PRODUCTO: Record<string, string> = {
  precio: "Precio del boleto",
  gente_requerida: "Gente por ciclo",
  dias_resolucion: "Días para resolver",
  cuota_evento: "Cuota por evento",
  alpha_em: "Alpha EM",
  activo: "Activo",
};

const CAMPOS_ECONOMIA: Record<string, string> = {
  cac_mxn: "Costo de adquirir un usuario (CAC)",
  churn_mensual: "Usuarios que se van al mes",
  eventos_por_usuario_mes: "Eventos por usuario al mes",
  cuota_al_premio: "Parte de la cuota que va al premio",
  saldo_entre_ciclos: "Saldo que se queda entre eventos",
  bono_bienvenida_mxn: "Bono de bienvenida",
  alpha_c1: "Premio por antigüedad (alpha C1)",
  costos_fijos_mes_mxn: "Costos fijos al mes",
};

const DEPARTAMENTOS: { clave: Depto; que_hace: string; href: string; boton: string; necesita?: Infra }[] = [
  { clave: "tecnologia", que_hace: "Operación diaria de la app: eventos, ciclos, usuarios.", href: "/admin/eventos", boton: "PISO Core" },
  { clave: "finanzas", que_hace: "Cuánto deja cada usuario. Un solo cálculo para toda la empresa.", href: "/consola/palancas", boton: "Palancas", necesita: "0014_economia" },
  { clave: "mesa", que_hace: "Agentes proponen eventos; la mesa acepta y Riesgo pone límites.", href: "/consola/mesa", boton: "Mesa", necesita: "0012_mesa" },
  { clave: "behavioral", que_hace: "Experimentos, contenido y referidos.", href: "/admin/experimentos", boton: "Experimentos" },
  { clave: "legal", que_hace: "Custodio, sorteo verificable, ledger y consentimientos.", href: "/trust-center", boton: "Trust Center", necesita: "0011_legal_sorteo" },
  { clave: "marketing", que_hace: "Lista de espera y usuarios nuevos.", href: "/unete", boton: "Landing", necesita: "0013_lista_espera" },
];

const mxn = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
const num = (n: number | undefined) => (n === undefined ? "—" : new Intl.NumberFormat("es-MX").format(n));
const fecha = (s: string) => new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

function nombreCampo(c: Cambio) {
  return c.tabla === "productos" ? CAMPOS_PRODUCTO[c.campo] ?? c.campo : CAMPOS_ECONOMIA[c.campo] ?? c.campo;
}
function valorTexto(campo: string, v: unknown) {
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v !== "number") return String(v ?? "—");
  if (["precio", "cuota_evento", "cac_mxn", "bono_bienvenida_mxn", "costos_fijos_mes_mxn"].includes(campo)) return mxn(v);
  return num(v);
}
function describirCambio(c: Cambio, productos: Producto[]) {
  const nivel = c.tabla === "productos" ? productos.find((p) => p.clave === c.clave)?.nombre ?? c.clave : "Finanzas";
  return `${nivel} · ${nombreCampo(c)}`;
}

export default function DirectorPage() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [params, setParams] = useState<Parametros | null>(null);
  const [decisiones, setDecisiones] = useState<Decision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [correo, setCorreo] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Cambio | null | undefined>(undefined); // undefined = formulario cerrado

  const cargar = useCallback(async () => {
    const [e, p, d] = await Promise.all([
      supabase.rpc("director_estado"),
      supabase.rpc("director_parametros"),
      supabase.from("decisiones").select("*").order("creado_en", { ascending: false }),
    ]);
    setError(e.error?.message ?? null);
    if (!e.error) setEstado(e.data as Estado);
    if (!p.error) setParams(p.data as Parametros);
    if (!d.error) setDecisiones((d.data ?? []) as Decision[]);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setCorreo(data.session?.user.email ?? null));
    cargar();
    const t = setInterval(cargar, 30_000);
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargar]);

  const productos = params?.productos ?? [];
  const propuestas = decisiones.filter((d) => d.estado === "propuesta");
  const hoy = new Date().toISOString().slice(0, 10);
  const porRevisar = decisiones.filter((d) => d.estado === "abierta" && d.revisar_el && d.revisar_el <= hoy);
  const pendientes = propuestas.length + porRevisar.length + (estado?.mesa_pendientes ?? 0);

  function proponerCambio(c: Cambio | null) {
    setBorrador(c);
    setTimeout(() => document.getElementById("nueva-decision")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">PISO · Dirección</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-stone-500">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"}`} />
              {error ? "Sin conexión con la base" : estado ? `En vivo · ${new Date(estado.generado_en).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : "Cargando…"}
              {correo && <span className="hidden sm:inline"> · {correo}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/home" className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white">
              Abrir la app
            </Link>
            <button onClick={() => supabase.auth.signOut()} className="rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100">
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}. ¿Ya corriste la migración 0016 en Supabase?
          </p>
        )}

        {/* 1. Lo que necesita tu decisión */}
        <Seccion titulo="Necesita tu decisión" sub={pendientes ? `${pendientes} pendiente${pendientes === 1 ? "" : "s"}` : "Nada pendiente. Todo en orden."}>
          <div className="space-y-3">
            {propuestas.map((d) => (
              <Propuesta key={d.id} d={d} productos={productos} params={params} alCambiar={cargar} />
            ))}
            {!!estado?.mesa_pendientes && (
              <Aviso texto={`La Mesa tiene ${estado.mesa_pendientes} evento${estado.mesa_pendientes === 1 ? "" : "s"} propuesto${estado.mesa_pendientes === 1 ? "" : "s"} esperando aprobación.`} href="/consola/mesa" boton="Ir a la Mesa" />
            )}
            {porRevisar.length > 0 && (
              <Aviso texto={`Ya llegó la fecha de revisar ${porRevisar.length} decisi${porRevisar.length === 1 ? "ón" : "ones"}: anota qué pasó de verdad.`} href="#decisiones" boton="Revisar" />
            )}
          </div>
        </Seccion>

        {/* 2. La empresa hoy */}
        <Seccion titulo="La empresa hoy">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Usuarios" valor={num(estado?.usuarios_total)} nota={estado && `+${estado.usuarios_7d} esta semana`} />
            <Kpi
              label="Lista de espera"
              valor={estado?.infra["0013_lista_espera"] ? num(estado.lista_espera) : "—"}
              nota={estado && (estado.infra["0013_lista_espera"] ? `+${estado.lista_espera_7d} esta semana` : "Falta activar la landing")}
            />
            <Kpi label="Dinero en juego" valor={estado ? mxn(estado.pool_abierto) : "—"} nota={estado && `${estado.ciclos_abiertos} ciclo${estado.ciclos_abiertos === 1 ? "" : "s"} abierto${estado.ciclos_abiertos === 1 ? "" : "s"}`} />
            <Kpi label="Boletos esta semana" valor={num(estado?.boletos_7d)} nota={estado && `${num(estado.boletos_total)} en total`} />
          </div>
          {!!estado?.ciclos.length && (
            <div className="mt-3 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
              {estado.ciclos.map((c) => {
                const pct = Math.min(100, Math.round((c.ocupados / Math.max(1, c.requeridos)) * 100));
                return (
                  <div key={c.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{c.nivel}</span> <span className="text-stone-500">· {c.evento}</span>
                      </span>
                      <span className="text-xs text-stone-500">
                        {num(c.ocupados)} de {num(c.requeridos)} · resuelve {fecha(c.resuelve)}
                      </span>
                    </div>
                    <div className="mt-2 h-1 rounded-full bg-stone-100">
                      <div className="h-1 rounded-full bg-emerald-500" style={{ width: `${Math.max(pct, 1)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Seccion>

        {/* 3. La app hoy */}
        <Seccion titulo="La app hoy" sub="Lo que ven los usuarios ahora. Para cambiarlo, registra una decisión: queda qué esperas y se aplica al aprobarla.">
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs text-stone-500">
                  <th className="px-4 py-2 font-normal">Nivel</th>
                  <th className="px-4 py-2 font-normal">Boleto</th>
                  <th className="px-4 py-2 font-normal">Gente por ciclo</th>
                  <th className="px-4 py-2 font-normal">Días</th>
                  {productos.some((p) => p.cuota_evento !== undefined) && <th className="px-4 py-2 font-normal">Cuota</th>}
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => (
                  <tr key={p.clave} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      {p.nombre}
                      {!p.activo && <span className="ml-2 text-xs text-stone-400">(pausado)</span>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{mxn(p.precio)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{num(p.gente_requerida)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{p.dias_resolucion}</td>
                    {p.cuota_evento !== undefined && <td className="px-4 py-2.5 tabular-nums">{mxn(p.cuota_evento)}</td>}
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => proponerCambio({ tabla: "productos", clave: p.clave, campo: "precio", valor: p.precio })}
                        className="rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-50"
                      >
                        Cambiar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Seccion>

        {/* 4. Decisiones */}
        <Decisiones
          decisiones={decisiones}
          productos={productos}
          params={params}
          borrador={borrador}
          abrir={proponerCambio}
          cerrar={() => setBorrador(undefined)}
          alCambiar={cargar}
        />

        {/* 5. Departamentos */}
        <Seccion titulo="Departamentos">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DEPARTAMENTOS.map((d) => {
              const listo = !d.necesita || estado?.infra[d.necesita];
              return (
                <Link key={d.clave} href={d.href} className="group flex flex-col rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-400">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{DEPTOS[d.clave]}</span>
                    {estado && !listo && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">Falta activar</span>}
                  </div>
                  <p className="mt-1 flex-1 text-sm text-stone-500">{d.que_hace}</p>
                  <span className="mt-3 text-sm font-medium text-stone-900 group-hover:underline">{d.boton} →</span>
                </Link>
              );
            })}
          </div>
        </Seccion>

        {/* 6. Agentes */}
        <Seccion titulo="Agentes y Claude">
          <div className="rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600">
            <p>
              Cuando Claude o un agente propone algo (un precio, una cuota, una palanca), aparece arriba en <b>Necesita tu decisión</b>.
              Tú lo apruebas o lo rechazas, y si lo apruebas se aplica a la app en ese momento.
            </p>
            <p className="mt-2">
              Hoy trabajan los analistas de la <Link href="/consola/mesa" className="underline">Mesa</Link> (tasas, inflación, tipo de cambio,
              deportes, cripto, tendencias). Siguiente paso: verlos correr y darles instrucciones desde aquí.
            </p>
          </div>
          {estado && (
            <p className="mt-3 text-xs text-stone-400">
              Partes activas en la base:{" "}
              {(Object.keys(estado.infra) as Infra[]).map((k) => `${k.slice(0, 4)} ${estado.infra[k] ? "✓" : "pendiente"}`).join(" · ")}
            </p>
          )}
        </Seccion>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------
// Propuesta pendiente: aprobar (aplica el cambio) o rechazar
// ---------------------------------------------------------------------
function Propuesta({ d, productos, params, alCambiar }: { d: Decision; productos: Producto[]; params: Parametros | null; alCambiar: () => void }) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actual = d.cambio ? valorActual(d.cambio, params) : undefined;

  async function decidir(aprobar: boolean) {
    setCargando(true);
    const { error } = await supabase.rpc("decidir", { p_id: d.id, p_aprobar: aprobar });
    setCargando(false);
    if (error) return setError(error.message);
    alCambiar();
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{d.titulo}</p>
          <p className="text-xs text-stone-500">
            Propone {d.propuesta_por === "director" ? "Dirección" : d.propuesta_por} · {DEPTOS[d.departamento]} · {fecha(d.creado_en)}
          </p>
        </div>
      </div>
      {d.cambio && (
        <p className="mt-3 inline-block rounded-lg bg-stone-100 px-3 py-1.5 text-sm">
          {describirCambio(d.cambio, productos)}: <span className="text-stone-500 line-through">{valorTexto(d.cambio.campo, actual)}</span>{" "}
          → <b>{valorTexto(d.cambio.campo, d.cambio.valor)}</b>
        </p>
      )}
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <Campo label="Por qué" texto={d.por_que} />
        <Campo label="Qué esperamos" texto={d.resultado_esperado} />
        <Campo label="Cómo medimos" texto={d.como_medir} />
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button disabled={cargando} onClick={() => decidir(true)} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {d.cambio ? "Aprobar y aplicar a la app" : "Aprobar"}
        </button>
        <button disabled={cargando} onClick={() => decidir(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm disabled:opacity-50">
          Rechazar
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function valorActual(c: Cambio, params: Parametros | null): unknown {
  if (!params) return undefined;
  if (c.tabla === "productos") return params.productos.find((p) => p.clave === c.clave)?.[c.campo as keyof Producto];
  return params.economia?.[c.campo];
}

// ---------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------
function Decisiones(props: {
  decisiones: Decision[];
  productos: Producto[];
  params: Parametros | null;
  borrador: Cambio | null | undefined;
  abrir: (c: Cambio | null) => void;
  cerrar: () => void;
  alCambiar: () => void;
}) {
  const { decisiones, productos, params, borrador, abrir, cerrar, alCambiar } = props;
  const [filtro, setFiltro] = useState<"abierta" | "revisada" | "todas">("abierta");
  const lista = decisiones.filter((d) => d.estado !== "propuesta" && (filtro === "todas" || d.estado === filtro));
  const revisadas = decisiones.filter((d) => d.estado === "revisada");
  const aciertos = revisadas.filter((d) => d.salio_como_esperabamos === "si").length;

  return (
    <section id="decisiones" className="scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Decisiones</h2>
          <p className="text-sm text-stone-500">
            Qué decidimos, por qué y qué esperamos. Después anotamos qué pasó de verdad.
            {revisadas.length > 0 && ` Acertamos ${aciertos} de ${revisadas.length}.`}
          </p>
        </div>
        <button onClick={() => (borrador === undefined ? abrir(null) : cerrar())} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white">
          {borrador === undefined ? "Nueva decisión" : "Cerrar"}
        </button>
      </div>

      {borrador !== undefined && (
        <NuevaDecision
          key={JSON.stringify(borrador)}
          inicial={borrador}
          productos={productos}
          params={params}
          alGuardar={() => {
            cerrar();
            alCambiar();
          }}
        />
      )}

      <div className="mb-3 flex gap-1 text-sm">
        {(["abierta", "revisada", "todas"] as const).map((f) => (
          <button key={f} onClick={() => setFiltro(f)} className={`rounded-full px-3 py-1 ${filtro === f ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"}`}>
            {f === "abierta" ? "En curso" : f === "revisada" ? "Revisadas" : "Todas"}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <p className="text-sm text-stone-400">Nada aquí todavía.</p>
      ) : (
        <div className="space-y-3">
          {lista.map((d) => (
            <TarjetaDecision key={d.id} d={d} productos={productos} alCambiar={alCambiar} />
          ))}
        </div>
      )}
    </section>
  );
}

const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900";

function NuevaDecision({ inicial, productos, params, alGuardar }: { inicial: Cambio | null; productos: Producto[]; params: Parametros | null; alGuardar: () => void }) {
  const [f, setF] = useState({ titulo: "", departamento: (inicial ? "finanzas" : "direccion") as Depto, por_que: "", resultado_esperado: "", como_medir: "", revisar_el: "" });
  const [conCambio, setConCambio] = useState(!!inicial);
  const [cambio, setCambio] = useState<Cambio>(inicial ?? { tabla: "productos", clave: productos[0]?.clave, campo: "precio", valor: productos[0]?.precio ?? 0 });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  // Opciones de "qué cambiar": niveles x campos, y palancas de Finanzas si 0014 está corrida.
  const opciones = useMemo(() => {
    const o: { id: string; label: string; c: Omit<Cambio, "valor"> }[] = [];
    for (const p of productos)
      for (const campo of Object.keys(CAMPOS_PRODUCTO))
        if (campo in p) o.push({ id: `productos|${p.clave}|${campo}`, label: `${p.nombre} · ${CAMPOS_PRODUCTO[campo]}`, c: { tabla: "productos", clave: p.clave, campo } });
    for (const [campo, v] of Object.entries(params?.economia ?? {}))
      if (typeof v === "number") o.push({ id: `economia_parametros||${campo}`, label: `Finanzas · ${CAMPOS_ECONOMIA[campo] ?? campo}`, c: { tabla: "economia_parametros", campo } });
    return o;
  }, [productos, params]);

  const idActual = `${cambio.tabla}|${cambio.clave ?? ""}|${cambio.campo}`;
  const actual = valorActual(cambio, params);

  function elegir(id: string) {
    const op = opciones.find((o) => o.id === id);
    if (!op) return;
    const c = { ...op.c, valor: 0 } as Cambio;
    const v = valorActual(c, params);
    setCambio({ ...c, valor: typeof v === "boolean" || typeof v === "number" ? v : 0 });
  }

  async function guardar(aplicarYa: boolean) {
    if (!f.titulo.trim()) return setError("Escribe qué decidiste.");
    setGuardando(true);
    setError(null);
    const fila = { ...f, revisar_el: f.revisar_el || null, cambio: conCambio ? cambio : null, estado: "propuesta" };
    const { data, error } = await supabase.from("decisiones").insert(fila).select("id").single();
    if (!error && aplicarYa) {
      const r = await supabase.rpc("decidir", { p_id: data.id, p_aprobar: true });
      if (r.error) {
        // La decisión quedó guardada como propuesta; se ve arriba para reintentar.
        setGuardando(false);
        setError(`Se guardó como propuesta, pero no se aplicó: ${r.error.message}`);
        return;
      }
    }
    setGuardando(false);
    if (error) return setError(error.message);
    alGuardar();
  }

  return (
    <div id="nueva-decision" className="mb-5 scroll-mt-20 space-y-3 rounded-xl border border-stone-300 bg-white p-4">
      <input className={input} placeholder="¿Qué decidimos?" value={f.titulo} onChange={set("titulo")} autoFocus />
      <div className="grid gap-3 sm:grid-cols-2">
        <select className={input} value={f.departamento} onChange={set("departamento")}>
          {(Object.keys(DEPTOS) as Depto[]).map((k) => (
            <option key={k} value={k}>
              {DEPTOS[k]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-stone-500">
          <span className="shrink-0">Revisar el</span>
          <input type="date" className={input} value={f.revisar_el} onChange={set("revisar_el")} />
        </label>
      </div>

      <div className="rounded-lg bg-stone-50 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={conCambio} onChange={(e) => setConCambio(e.target.checked)} />
          Esta decisión cambia algo en la app
        </label>
        {conCambio && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <select className={input} value={idActual} onChange={(e) => elegir(e.target.value)}>
              {opciones.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {typeof actual === "boolean" ? (
              <select className={input} value={String(cambio.valor)} onChange={(e) => setCambio({ ...cambio, valor: e.target.value === "true" })}>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                type="number"
                step="any"
                className={`${input} sm:w-40`}
                value={String(cambio.valor)}
                onChange={(e) => setCambio({ ...cambio, valor: e.target.value === "" ? 0 : Number(e.target.value) })}
              />
            )}
            <p className="text-xs text-stone-500 sm:col-span-2">Hoy: {valorTexto(cambio.campo, actual)}</p>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <textarea className={input} rows={2} placeholder="¿Por qué?" value={f.por_que} onChange={set("por_que")} />
        <textarea className={input} rows={2} placeholder="¿Qué esperamos que pase?" value={f.resultado_esperado} onChange={set("resultado_esperado")} />
      </div>
      <input className={input} placeholder="¿Cómo lo vamos a medir?" value={f.como_medir} onChange={set("como_medir")} />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => guardar(true)} disabled={guardando} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {guardando ? "Guardando…" : conCambio ? "Decidir y aplicar a la app" : "Guardar decisión"}
        </button>
        <button onClick={() => guardar(false)} disabled={guardando} className="rounded-lg border border-stone-300 px-4 py-2 text-sm disabled:opacity-50">
          Dejar como propuesta
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function TarjetaDecision({ d, productos, alCambiar }: { d: Decision; productos: Producto[]; alCambiar: () => void }) {
  const [revisando, setRevisando] = useState(false);
  const [r, setR] = useState({ resultado_real: "", aprendizaje: "", salio_como_esperabamos: "si" as "si" | "parcial" | "no" });
  const [error, setError] = useState<string | null>(null);
  const hoy = new Date().toISOString().slice(0, 10);
  const vencida = d.estado === "abierta" && !!d.revisar_el && d.revisar_el <= hoy;
  const veredicto = { si: "Salió como esperábamos", parcial: "Salió a medias", no: "No salió como esperábamos" };

  async function cerrar(estado: "revisada" | "descartada") {
    if (estado === "revisada") {
      const u = await supabase.from("decisiones").update(r).eq("id", d.id);
      if (u.error) return setError(u.error.message);
    }
    const { error } = await supabase.rpc("director_cerrar", { p_id: d.id, p_estado: estado });
    if (error) return setError(error.message);
    setRevisando(false);
    alCambiar();
  }

  const chip =
    d.estado === "abierta"
      ? vencida
        ? ["Toca revisar", "bg-amber-50 text-amber-700"]
        : ["En curso", "bg-sky-50 text-sky-700"]
      : d.estado === "revisada"
        ? ["Revisada", "bg-emerald-50 text-emerald-700"]
        : ["Descartada", "bg-stone-100 text-stone-500"];

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{d.titulo}</p>
          <p className="text-xs text-stone-500">
            {DEPTOS[d.departamento]} · {fecha(d.creado_en)}
            {d.revisar_el && ` · revisar el ${fecha(d.revisar_el)}`}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${chip[1]}`}>{chip[0]}</span>
      </div>

      {d.cambio && d.aplicado_en && (
        <p className="mt-3 inline-block rounded-lg bg-stone-100 px-3 py-1.5 text-sm">
          Aplicado en la app · {describirCambio(d.cambio, productos)}: {valorTexto(d.cambio.campo, d.cambio_antes?.valor)} → <b>{valorTexto(d.cambio.campo, d.cambio.valor)}</b>
        </p>
      )}

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <Campo label="Por qué" texto={d.por_que} />
        <Campo label="Qué esperamos" texto={d.resultado_esperado} />
        <Campo label="Cómo medimos" texto={d.como_medir} />
        {d.estado === "revisada" && (
          <>
            <Campo label="Qué pasó" texto={d.resultado_real} />
            <Campo label="Qué aprendimos" texto={d.aprendizaje} />
            <Campo label="Veredicto" texto={d.salio_como_esperabamos && veredicto[d.salio_como_esperabamos]} />
          </>
        )}
      </dl>

      {d.estado === "abierta" && !revisando && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => setRevisando(true)} className="rounded-md border border-stone-300 px-2.5 py-1 text-xs hover:bg-stone-50">
            Anotar qué pasó
          </button>
          <button onClick={() => cerrar("descartada")} className="rounded-md px-2.5 py-1 text-xs text-stone-400 hover:bg-stone-50">
            Descartar
          </button>
        </div>
      )}

      {revisando && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <textarea className={input} rows={2} placeholder="¿Qué pasó de verdad? (con el número)" value={r.resultado_real} onChange={(e) => setR({ ...r, resultado_real: e.target.value })} />
          <textarea className={input} rows={2} placeholder="¿Qué aprendimos?" value={r.aprendizaje} onChange={(e) => setR({ ...r, aprendizaje: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            {(["si", "parcial", "no"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setR({ ...r, salio_como_esperabamos: k })}
                className={`rounded-full px-3 py-1 text-xs ${r.salio_como_esperabamos === k ? "bg-stone-900 text-white" : "border border-stone-300"}`}
              >
                {veredicto[k]}
              </button>
            ))}
            <button onClick={() => cerrar("revisada")} className="ml-auto rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white">
              Guardar
            </button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
function Seccion({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
      {sub && <p className="mb-3 text-sm text-stone-500">{sub}</p>}
      {!sub && <div className="mb-3" />}
      {children}
    </section>
  );
}

function Kpi({ label, valor, nota }: { label: string; valor: string; nota?: string | null | false }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{valor}</p>
      {nota && <p className="mt-1 text-xs text-stone-500">{nota}</p>}
    </div>
  );
}

function Aviso({ texto, href, boton }: { texto: string; href: string; boton: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
      <span>{texto}</span>
      <Link href={href} className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium">
        {boton}
      </Link>
    </div>
  );
}

function Campo({ label, texto }: { label: string; texto: string | null | undefined | false }) {
  if (!texto) return null;
  return (
    <div>
      <dt className="text-xs text-stone-400">{label}</dt>
      <dd className="text-stone-700">{texto}</dd>
    </div>
  );
}
