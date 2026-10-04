"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Tablero del dueño -- exclusivo para el fundador. El acceso lo decide
// Postgres con es_dueno() (supabase/migrations/0016_tablero_dueno.sql):
// aunque alguien abra esta ruta, las políticas y dueno_estado() no le
// devuelven nada si no está en la tabla duenos.

export default function DuenoLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [estado, setEstado] = useState<"cargando" | "autorizado" | "no_autorizado" | "sin_sesion">("cargando");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.user) return setEstado("sin_sesion");
      const { data: ok, error } = await supabase.rpc("es_dueno");
      setEstado(!error && ok === true ? "autorizado" : "no_autorizado");
    });
  }, []);

  if (estado === "autorizado") return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-8 text-neutral-100">
      <div className="max-w-sm text-center">
        <p className="mb-1 text-xs uppercase tracking-widest text-neutral-500">PISO · Dueño</p>
        {estado === "cargando" && <p className="text-sm text-neutral-400">Verificando acceso…</p>}
        {estado === "sin_sesion" && (
          <>
            <p className="mb-4 text-sm">Inicia sesión con tu cuenta.</p>
            <button onClick={() => router.push("/auth")} className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900">
              Iniciar sesión
            </button>
          </>
        )}
        {estado === "no_autorizado" && <p className="text-sm text-neutral-400">Esta página es solo para el dueño de PISO.</p>}
      </div>
    </div>
  );
}
