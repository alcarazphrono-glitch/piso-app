"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { asegurarPerfilYBalanceDemo } from "@/lib/demo";
import { trackFunnel, identifyUsuario } from "@/lib/posthog";
import { Screen, H1, Lede, PrimaryButton, SecondaryButton } from "@/components/ui";

type Modo = "registro" | "login";

export default function AuthPage() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>("registro");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);

    try {
      if (modo === "registro") {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        if (!data.user) throw new Error("No se pudo crear la cuenta. Intenta de nuevo.");

        await asegurarPerfilYBalanceDemo(data.user.id);
        identifyUsuario(data.user.id, { email });
        trackFunnel("registro", { metodo: "email" });
        trackFunnel("demo_activo", { balance_inicial: 1000 });
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        if (data.user) identifyUsuario(data.user.id, { email });
      }
      router.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal. Intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <Screen>
      <div className="pt-2 font-display text-xl font-bold">PISO</div>
      <div className="mt-8">
        <H1>{modo === "registro" ? "Crea tu cuenta demo" : "Entra a tu cuenta"}</H1>
        <Lede>
          {modo === "registro"
            ? "Arrancas con $1,000 MXN virtuales. Nada de esto mueve dinero real todavía."
            : "Vuelve a tu piso, tu balance y tus posiciones."}
        </Lede>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="tu@correo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-card border border-line bg-surface px-4 py-3.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-gold"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-card border border-line bg-surface px-4 py-3.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-gold"
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <PrimaryButton type="submit" disabled={cargando} className="mt-2">
            {cargando ? "Un momento…" : modo === "registro" ? "Crear cuenta y empezar" : "Entrar"}
          </PrimaryButton>
        </form>

        <button
          onClick={() => setModo(modo === "registro" ? "login" : "registro")}
          className="mt-4 w-full text-center text-sm text-ink-soft underline underline-offset-2"
        >
          {modo === "registro" ? "Ya tengo cuenta" : "Crear una cuenta nueva"}
        </button>
      </div>
    </Screen>
  );
}
