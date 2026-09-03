"use client";

// Nav compartido entre las pantallas de PISO Core V1 (Event Manager,
// Configuración) -- pedido de Beto tras el checkpoint: que se sienta un
// panel, no páginas sueltas que hay que recordar por URL. El gateo de
// acceso real sigue viviendo en cada página (auth.getSession() + RLS del
// lado de Postgres) -- esto es solo navegación, no seguridad.

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/eventos", label: "Eventos" },
  { href: "/admin/configuracion", label: "Configuración" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <nav className="mx-auto flex max-w-3xl gap-5 px-6 pt-6 text-sm">
        {TABS.map((t) => {
          const activo = pathname?.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`border-b-2 pb-3 font-medium ${
                activo ? "border-ink text-ink" : "border-transparent text-ink-soft"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
