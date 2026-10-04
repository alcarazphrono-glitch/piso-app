"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Portal del director -- web aparte de la app de consumo, misma base de
// datos. Tiene su propia entrada con correo y contraseña. Quién es
// director lo decide Postgres (es_director(), 0016): un correo de la lista
// director_correos, confirmado. Esta pantalla solo refleja esa respuesta.

type Estado = "cargando" | "sin_sesion" | "nueva_contrasena" | "no_autorizado" | "autorizado";

export default function DirectorLayout({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [correo, setCorreo] = useState<string | null>(null);

  async function verificar() {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return setEstado("sin_sesion");
    setCorreo(user.email ?? null);
    const { data: ok, error } = await supabase.rpc("director_activar");
    setEstado(!error && ok === true ? "autorizado" : "no_autorizado");
  }

  useEffect(() => {
    verificar();
    const { data } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "PASSWORD_RECOVERY") setEstado("nueva_contrasena");
      else if (evento === "SIGNED_OUT") setEstado("sin_sesion");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (estado === "autorizado") return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 text-stone-900">
      <div className="w-full max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">PISO</p>
        <h1 className="mb-6 mt-1 text-2xl font-semibold tracking-tight">Portal del director</h1>
        {estado === "cargando" && <p className="text-sm text-stone-500">Verificando acceso…</p>}
        {estado === "sin_sesion" && <Entrar alEntrar={verificar} />}
        {estado === "nueva_contrasena" && <NuevaContrasena alGuardar={verificar} />}
        {estado === "no_autorizado" && (
          <div className="space-y-4 text-sm">
            <p>
              <span className="font-medium">{correo}</span> no tiene acceso de director, o todavía no confirmas tu correo.
            </p>
            <button onClick={() => supabase.auth.signOut()} className="rounded-lg border border-stone-300 px-4 py-2">
              Entrar con otra cuenta
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const campo = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-stone-900";
const boton = "w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50";

function Entrar({ alEntrar }: { alEntrar: () => void }) {
  const [modo, setModo] = useState<"entrar" | "crear" | "olvide">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setMensaje(null);
    const redirectTo = `${window.location.origin}/director`;
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        alEntrar();
      } else if (modo === "crear") {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setMensaje({ tipo: "ok", texto: "Te mandamos un correo. Confírmalo y regresa aquí a entrar." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setMensaje({ tipo: "ok", texto: "Te mandamos un correo con el link para poner tu contraseña." });
      }
    } catch (err) {
      const texto = err instanceof Error ? err.message : "No se pudo.";
      setMensaje({ tipo: "error", texto: texto === "Invalid login credentials" ? "Correo o contraseña incorrectos." : texto });
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <input className={campo} type="email" autoComplete="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} required />
      {modo !== "olvide" && (
        <input
          className={campo}
          type="password"
          autoComplete={modo === "crear" ? "new-password" : "current-password"}
          placeholder="Contraseña"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      )}
      <button className={boton} disabled={cargando}>
        {cargando ? "Un momento…" : modo === "entrar" ? "Entrar" : modo === "crear" ? "Crear mi acceso" : "Mandarme el link"}
      </button>
      {mensaje && <p className={`text-sm ${mensaje.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{mensaje.texto}</p>}
      <div className="flex justify-between pt-1 text-xs text-stone-500">
        {modo !== "entrar" ? (
          <button type="button" onClick={() => setModo("entrar")}>Ya tengo contraseña</button>
        ) : (
          <button type="button" onClick={() => setModo("crear")}>Primera vez: crear acceso</button>
        )}
        {modo !== "olvide" && <button type="button" onClick={() => setModo("olvide")}>Olvidé mi contraseña</button>}
      </div>
    </form>
  );
}

function NuevaContrasena({ alGuardar }: { alGuardar: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setError(error.message);
    alGuardar();
  }

  return (
    <form onSubmit={guardar} className="space-y-3">
      <p className="text-sm text-stone-600">Escribe tu nueva contraseña.</p>
      <input className={campo} type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button className={boton}>Guardar y entrar</button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
