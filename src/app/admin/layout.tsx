"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// Panel de administración -- PISO Core, checkpoint 3-sep-2026. Gateado por
// la tabla operadores (supabase/migrations/0002_piso_core.sql). Deja el
// resto del panel de estilo deliberadamente plano y utilitario -- es una
// herramienta interna, no el producto de consumo, y no debe competir
// visualmente con la marca de Consumer.

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState<"cargando" | "autorizado" | "no_autorizado" | "sin_sesion">("cargando");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        setEstado("sin_sesion");
        return;
      }
      const { data: op } = await supabase.from("operadores").select("user_id").eq("user_id", user.id).maybeSingle();
      setEstado(op ? "autorizado" : "no_autorizado");
    });
  }, []);

  if (estado === "cargando") {
    return (
      <div className="min-h-screen bg-white p-8 text-neutral-900">
        <p className="text-sm text-neutral-500">Verificando acceso…</p>
      </div>
    );
  }

  if (estado === "sin_sesion") {
    return (
      <div className="min-h-screen bg-white p-8 text-neutral-900">
        <p className="mb-4 text-sm">Necesitas iniciar sesión primero.</p>
        <button onClick={() => router.push("/auth")} className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">
          Ir a iniciar sesión
        </button>
      </div>
    );
  }

  if (estado === "no_autorizado") {
    return (
      <div className="min-h-screen bg-white p-8 text-neutral-900">
        <p className="mb-2 text-sm font-medium">No tienes acceso a PISO Core.</p>
        <p className="mb-4 text-sm text-neutral-500">
          Esta cuenta no está registrada como operador. Si crees que debería estarlo, pide que te agreguen en la
          tabla <code className="rounded bg-neutral-100 px-1">operadores</code> de Supabase.
        </p>
        <button onClick={() => router.push("/home")} className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
          Volver a PISO
        </button>
      </div>
    );
  }

  const linkClass = (href: string) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      pathname === href ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
    }`;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="border-b border-neutral-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-semibold tracking-tight">PISO Core</span>
            <nav className="flex flex-wrap gap-1">
              <Link href="/admin/eventos" className={linkClass("/admin/eventos")}>Eventos</Link>
              <Link href="/admin/productos" className={linkClass("/admin/productos")}>Productos</Link>
              <Link href="/admin/ciclos" className={linkClass("/admin/ciclos")}>Ciclos</Link>
              <Link href="/admin/reserva" className={linkClass("/admin/reserva")}>Reserva</Link>
              <Link href="/admin/fuentes" className={linkClass("/admin/fuentes")}>Fuentes</Link>
              <Link href="/admin/riesgo" className={linkClass("/admin/riesgo")}>Riesgo</Link>
              <Link href="/admin/usuarios" className={linkClass("/admin/usuarios")}>Usuarios</Link>
              <Link href="/admin/analytics" className={linkClass("/admin/analytics")}>Analytics</Link>
              <Link href="/admin/referidos" className={linkClass("/admin/referidos")}>Referidos</Link>
              <Link href="/admin/experimentos" className={linkClass("/admin/experimentos")}>Experimentos</Link>
              <Link href="/admin/contenido" className={linkClass("/admin/contenido")}>Contenido</Link>
              <Link href="/admin/configuracion" className={linkClass("/admin/configuracion")}>Configuración</Link>
            </nav>
          </div>
          <Link href="/home" className="text-xs text-neutral-400 hover:text-neutral-600">← Volver a PISO</Link>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
    </div>
  );
}
