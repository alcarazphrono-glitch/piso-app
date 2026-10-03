"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { trackListaEspera } from "@/lib/posthog";
import {
  Wordmark,
  PrimaryButton,
  ShieldCheckIcon,
  TargetIcon,
  TrophyIcon,
  LockIcon,
} from "@/components/ui";

// Landing pública de lista de espera. Su único trabajo es medir interés
// antes del App Store: cuánta gente deja su correo, de qué campaña viene
// (UTM) y cuánta trae a otros (?ref=CODIGO). Registro vía
// unirse_lista_espera() -- ver supabase/migrations/0013_lista_espera.sql.
//
// Copy revisado contra lo que pidió Legal: no se promete rendimiento, no
// se habla de "apostar" ni de "recuperar lo perdido", y se dice claro que
// hoy PISO no recibe dinero.

type Utm = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  ref: string | null;
  referrer: string | null;
};

type Resultado = { posicion: number; codigo: string; ya_registrado: boolean };

const RANGOS = [
  { valor: "menos_18", label: "Menos de 18" },
  { valor: "18_24", label: "18–24" },
  { valor: "25_34", label: "25–34" },
  { valor: "35_mas", label: "35+" },
];

function leerUtm(): Utm {
  const q = new URLSearchParams(window.location.search);
  const ref = q.get("ref");
  return {
    utm_source: q.get("utm_source") ?? (ref ? "invitacion" : null),
    utm_medium: q.get("utm_medium"),
    utm_campaign: q.get("utm_campaign"),
    utm_content: q.get("utm_content"),
    ref: ref ? ref.toUpperCase() : null,
    referrer: document.referrer || null,
  };
}

export default function UnetePage() {
  const [utm, setUtm] = useState<Utm | null>(null);

  useEffect(() => {
    const u = leerUtm();
    setUtm(u);
    trackListaEspera("lista_espera_vista", { ...u });
  }, []);

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <header className="flex items-center justify-between py-6">
          <Wordmark />
          <a href="#registro" className="text-[13px] font-semibold text-mint hover:opacity-80">
            Apartar mi lugar
          </a>
        </header>

        {/* Hero */}
        <section className="grid items-center gap-10 pb-16 pt-6 md:grid-cols-[1.1fr_0.9fr] md:pt-12">
          {/* min-w-0: sin esto el enlace largo de invitación ensancha la columna en móvil */}
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-chip px-3 py-1.5 text-[12px] font-semibold text-mint">
              <LockIcon className="h-3 w-3" /> Lista de espera abierta
            </span>
            <h1 className="mt-5 font-display text-[36px] font-bold leading-[1.05] tracking-[-0.02em] [text-wrap:balance] sm:text-[48px]">
              Tu dinero no se arriesga. <span className="text-mint">Tu criterio sí cuenta.</span>
            </h1>
            <p className="mt-5 max-w-[480px] text-[16px] leading-relaxed text-ink-soft">
              En PISO tu capital se queda intacto. Lo único que pones en juego es lo que tu dinero
              genera, y lo usas para opinar sobre eventos económicos reales: tasas, inflación, el
              dólar.
            </p>
            <div id="registro" className="mt-8 scroll-mt-6">
              <Registro utm={utm} />
            </div>
          </div>

          <EjemploEvento />
        </section>

        {/* Cómo funciona */}
        <section className="border-t border-line py-16">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">Cómo funciona</p>
          <h2 className="mt-2 font-display text-[28px] font-bold tracking-[-0.01em]">Tres pasos, sin letra chiquita</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Paso
              n="1"
              icono={<ShieldCheckIcon className="h-5 w-5 text-mint" />}
              titulo="Apartas tu lugar"
              texto="Eliges un nivel y tu depósito queda protegido. Ese monto no se toca, pase lo que pase."
            />
            <Paso
              n="2"
              icono={<TargetIcon className="h-5 w-5 text-mint" />}
              titulo="Das tu opinión"
              texto="Sí o no: ¿Banxico baja la tasa? ¿La inflación pasa de 4%? Eventos públicos, con fecha y fuente oficial."
            />
            <Paso
              n="3"
              icono={<TrophyIcon className="h-5 w-5 text-gold" />}
              titulo="Si aciertas, participas"
              texto="Quien acierta entra por el premio del evento, que sale del rendimiento del grupo. Si no, tu capital regresa completo."
            />
          </div>
        </section>

        {/* El piso */}
        <section className="grid gap-10 border-t border-line py-16 md:grid-cols-2">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">Por qué se llama PISO</p>
            <h2 className="mt-2 font-display text-[28px] font-bold tracking-[-0.01em] [text-wrap:balance]">
              Tu capital es el piso. Nunca bajas de ahí.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
              Ahorrar suele ser aburrido y lo emocionante suele ser arriesgado. PISO separa las dos cosas: lo
              que depositas se queda como está y solo el rendimiento entra en juego. Y si un evento no se
              llena, se cancela y te devolvemos todo.
            </p>
          </div>
          <BarraPiso />
        </section>

        {/* FAQ */}
        <section className="border-t border-line py-16">
          <h2 className="font-display text-[28px] font-bold tracking-[-0.01em]">Preguntas rápidas</h2>
          <div className="mt-6 divide-y divide-line rounded-card border border-line bg-surface">
            <Pregunta q="¿Puedo perder lo que deposito?">
              No. Ese es el diseño central: tu capital no se usa para participar. Lo que entra en juego es el
              rendimiento que genera mientras está guardado.
            </Pregunta>
            <Pregunta q="¿Ya puedo depositar?">
              Todavía no. Hoy solo estamos armando la lista de espera; no recibimos dinero. Te avisamos por
              correo cuando abramos.
            </Pregunta>
            <Pregunta q="¿Es una apuesta?">
              No arriesgas tu dinero. Participas con el rendimiento, sobre eventos económicos públicos que se
              resuelven con datos oficiales.
            </Pregunta>
            <Pregunta q="¿Qué hago con mi código de invitación?">
              Compártelo. Así sabemos quién está trayendo a sus amigos, y quienes lleguen por ti quedan
              ligados a tu lugar.
            </Pregunta>
          </div>
        </section>

        {/* CTA final */}
        <section className="border-t border-line py-16 text-center">
          <h2 className="mx-auto max-w-[520px] font-display text-[30px] font-bold tracking-[-0.01em] [text-wrap:balance]">
            Sé de los primeros en tener tu PISO.
          </h2>
          <a
            href="#registro"
            className="mt-6 inline-block rounded-card bg-mint px-6 py-3.5 font-bold text-mint-ink hover:opacity-90"
          >
            Apartar mi lugar
          </a>
        </section>

        <footer className="border-t border-line py-8 text-[12px] leading-relaxed text-faint">
          <p>
            PISO está en desarrollo. Registrarte en la lista de espera no implica ningún depósito ni
            compromiso, y hoy no recibimos dinero. Los ejemplos son ilustrativos. Usamos tu correo solo para
            avisarte del lanzamiento.
          </p>
          <p className="mt-2">© {new Date().getFullYear()} PISO</p>
        </footer>
      </div>
    </main>
  );
}

function Registro({ utm }: { utm: Utm | null }) {
  const [email, setEmail] = useState("");
  const [edad, setEdad] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const empezo = useRef(false);

  function alEscribir(v: string) {
    setEmail(v);
    if (!empezo.current && v.length > 0) {
      empezo.current = true;
      trackListaEspera("lista_espera_inicio_form", { ...utm });
    }
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const { data, error: err } = await supabase.rpc("unirse_lista_espera", {
      p_email: email,
      p_rango_edad: edad,
      p_referido_por: utm?.ref ?? null,
      p_utm_source: utm?.utm_source ?? null,
      p_utm_medium: utm?.utm_medium ?? null,
      p_utm_campaign: utm?.utm_campaign ?? null,
      p_utm_content: utm?.utm_content ?? null,
      p_referrer: utm?.referrer ?? null,
    });
    setEnviando(false);

    const fila = Array.isArray(data) ? (data[0] as Resultado | undefined) : undefined;
    if (err || !fila) {
      const invalido = err?.message?.includes("correo_invalido");
      setError(invalido ? "Revisa tu correo, parece que tiene un error." : "No pudimos registrarte. Intenta de nuevo.");
      trackListaEspera("lista_espera_error", { ...utm, motivo: invalido ? "correo_invalido" : "servidor" });
      return;
    }

    setResultado(fila);
    trackListaEspera("lista_espera_registro", {
      ...utm,
      rango_edad: edad,
      posicion: fila.posicion,
      ya_registrado: fila.ya_registrado,
      codigo: fila.codigo,
    });
  }

  if (resultado) return <Confirmacion resultado={resultado} />;

  return (
    <form onSubmit={enviar} className="max-w-[460px]">
      <label htmlFor="email" className="sr-only">
        Correo
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="tu@correo.com"
          value={email}
          onChange={(e) => alEscribir(e.target.value)}
          className="min-w-0 flex-1 rounded-card border border-line bg-surface px-4 py-3.5 text-[15px] text-ink placeholder:text-faint focus:border-mint focus:outline-none"
        />
        <PrimaryButton type="submit" disabled={enviando} className="sm:w-auto sm:px-6">
          {enviando ? "Apartando…" : "Apartar lugar"}
        </PrimaryButton>
      </div>

      <fieldset className="mt-4">
        <legend className="text-[12.5px] text-ink-soft">¿Cuántos años tienes? (opcional)</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {RANGOS.map((r) => (
            <button
              key={r.valor}
              type="button"
              aria-pressed={edad === r.valor}
              onClick={() => setEdad(edad === r.valor ? null : r.valor)}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                edad === r.valor ? "border-mint bg-mint-chip text-mint" : "border-line text-ink-soft hover:border-ink-soft"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </fieldset>

      {error && <p className="mt-3 text-[13px] text-gold">{error}</p>}
      <p className="mt-4 text-[12px] text-faint">Sin spam. Solo te escribimos para avisarte del lanzamiento.</p>
    </form>
  );
}

function Confirmacion({ resultado }: { resultado: Resultado }) {
  const [copiado, setCopiado] = useState(false);
  const enlace =
    typeof window !== "undefined"
      ? `${window.location.origin}/unete?ref=${resultado.codigo}&utm_source=invitacion`
      : "";
  const mensaje = `Me apunté a PISO: tu dinero no se arriesga, solo juegas lo que genera. Aparta tu lugar: ${enlace}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* algunos navegadores bloquean el portapapeles; el enlace queda visible */
    }
    trackListaEspera("lista_espera_compartir", { canal: "copiar", codigo: resultado.codigo });
  }

  return (
    <div className="max-w-[460px] rounded-card border border-[oklch(80%_0.17_158_/_0.4)] bg-surface p-5">
      <p className="text-[13px] font-semibold text-mint">
        {resultado.ya_registrado ? "Ya estabas en la lista" : "Listo, estás dentro"}
      </p>
      <p className="mt-1 font-display text-[30px] font-bold tracking-[-0.01em]">
        Lugar #{resultado.posicion.toLocaleString("es-MX")}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
        Comparte tu enlace. Quien se registre con él queda ligado a tu código{" "}
        <span className="font-mono font-semibold text-ink">{resultado.codigo}</span>.
      </p>
      <div className="mt-4 truncate rounded-[10px] border border-line bg-bg px-3 py-2.5 font-mono text-[12.5px] text-ink-soft">
        {enlace}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackListaEspera("lista_espera_compartir", { canal: "whatsapp", codigo: resultado.codigo })}
          className="rounded-card bg-mint px-4 py-3 text-center text-[14px] font-bold text-mint-ink hover:opacity-90"
        >
          WhatsApp
        </a>
        <button
          onClick={copiar}
          className="rounded-card border border-line px-4 py-3 text-[14px] font-semibold text-ink hover:border-ink-soft"
        >
          {copiado ? "¡Copiado!" : "Copiar enlace"}
        </button>
      </div>
    </div>
  );
}

function EjemploEvento() {
  return (
    <div className="relative mx-auto w-full max-w-[340px]" aria-hidden="true">
      <div className="absolute -inset-6 rounded-[40px] bg-[oklch(80%_0.17_158_/_0.10)] blur-3xl" />
      <div className="relative rounded-[28px] border border-line bg-surface p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-gold-chip px-2.5 py-1 text-[11px] font-semibold text-gold-ink">Evento · Banxico</span>
          <span className="text-[11px] text-faint">Ejemplo</span>
        </div>
        <p className="mt-4 font-display text-[20px] font-bold leading-snug">
          ¿Banxico baja la tasa en su próximo anuncio?
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-[12px] bg-mint py-3 text-center font-bold text-mint-ink">Sí</div>
          <div className="rounded-[12px] border border-line py-3 text-center font-semibold text-ink-soft">No</div>
        </div>
        <div className="mt-5 rounded-[14px] bg-bg p-4">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-ink-soft">Tu depósito</span>
            <span className="flex items-center gap-1 font-semibold text-mint">
              <ShieldCheckIcon className="h-3.5 w-3.5" /> Protegido
            </span>
          </div>
          <p className="mt-1 font-display text-[26px] font-bold">$500</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full w-[72%] rounded-full bg-mint" />
          </div>
          <p className="mt-2 text-[11.5px] text-faint">Faltan 1,400 lugares para que se juegue</p>
        </div>
      </div>
    </div>
  );
}

function BarraPiso() {
  return (
    <div className="rounded-card border border-line bg-surface p-6" aria-label="Tu capital queda protegido; solo el rendimiento participa">
      <p className="text-[12.5px] text-ink-soft">Ejemplo con un depósito de $3,000</p>
      <div className="mt-5 space-y-4">
        <div>
          <div className="flex justify-between text-[13px]">
            <span className="font-semibold">Tu capital</span>
            <span className="font-mono">$3,000 · protegido</span>
          </div>
          <div className="mt-2 h-10 rounded-[10px] bg-mint-chip ring-1 ring-[oklch(80%_0.17_158_/_0.4)]" />
        </div>
        <div>
          <div className="flex justify-between text-[13px]">
            <span className="font-semibold text-gold-ink">Rendimiento que genera</span>
            <span className="font-mono text-gold-ink">en juego</span>
          </div>
          <div className="mt-2 h-10 w-[12%] min-w-[28px] rounded-[10px] bg-gold" />
        </div>
      </div>
      <p className="mt-5 text-[12px] leading-relaxed text-faint">
        Sin escala. El rendimiento de una persona es pequeño frente a su capital; por eso se junta el de todo el grupo para formar el premio del evento.
      </p>
    </div>
  );
}

function Paso({ n, icono, titulo, texto }: { n: string; icono: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        {icono}
        <span className="font-mono text-[12px] text-faint">0{n}</span>
      </div>
      <h3 className="mt-4 font-display text-[18px] font-bold">{titulo}</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{texto}</p>
    </div>
  );
}

function Pregunta({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
        {q}
        <span className="text-ink-soft transition-transform group-open:rotate-45">+</span>
      </summary>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{children}</p>
    </details>
  );
}
