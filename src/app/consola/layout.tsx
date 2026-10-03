"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Consola financiera -- herramienta aparte de /admin: todo lo financiero
// en un solo lugar y desde aquí se opera la app (mesa de derivados,
// riesgo, reserva, niveles, ciclos). Mismo gate que /admin (tabla
// operadores); el layout es propio para que se use como app independiente.

const SECCIONES = [
  { href: "/consola", label: "Resumen" },
  { href: "/consola/mesa", label: "Mesa de derivados" },
  { href: "/consola/riesgo", label: "Riesgo" },
  { href: "/consola/reserva", label: "Reserva" },
  { href: "/consola/niveles", label: "Niveles" },
  { href: "/consola/ciclos", label: "Ciclos" },
];

export default function ConsolaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState<"cargando" | "autorizado" | "no_autorizado" | "sin_sesion">("cargando");
  const [correo, setCorreo] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) return setEstado("sin_sesion");
      setCorreo(user.email ?? null);
      const { data: op } = await supabase.from("operadores").select("user_id").eq("user_id", user.id).maybeSingle();
      setEstado(op ? "autorizado" : "no_autorizado");
    });
  }, []);

  if (estado !== "autorizado") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-8 text-neutral-100">
        <div className="max-w-sm text-center">
          <p className="mb-1 text-xs uppercase tracking-widest text-neutral-500">PISO · Consola financiera</p>
          {estado === "cargando" && <p className="text-sm text-neutral-400">Verificando acceso…</p>}
          {estado === "sin_sesion" && (
            <>
              <p className="mb-4 text-sm">Inicia sesión con tu cuenta de operador.</p>
              <button onClick={() => router.push("/auth")} className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900">
                Iniciar sesión
              </button>
            </>
          )}
          {estado === "no_autorizado" && (
            <p className="text-sm text-neutral-400">Esta cuenta no es operador. Pide que la agreguen a la tabla operadores.</p>
          )}
        </div>
      </div>
    );
  }

  const activa = (href: string) => (href === "/consola" ? pathname === href : pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="bg-neutral-950 text-neutral-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight">PISO</span>
            <span className="text-xs uppercase tracking-widest text-neutral-500">Consola financiera</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-neutral-500">
            {correo && <span>{correo}</span>}
            <Link href="/admin" className="hover:text-neutral-300">
              Panel operativo
            </Link>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6">
          {SECCIONES.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                activa(s.href) ? "border-emerald-400 text-white" : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
