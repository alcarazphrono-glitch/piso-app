"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// User/Behavior Dashboard -- PISO Core V1. Filosofía del brief original,
// sección 3.6: "User → behavior → positions → progression". Sin KYC, sin
// límites, sin AML -- eso no es V1. El correo sale de
// admin_resumen_usuarios() (SECURITY DEFINER) porque auth.users no es
// consultable directo desde el cliente.

interface Usuario {
  user_id: string;
  email: string;
  piso: string | null;
  balance: number | null;
  modo: string | null;
  posiciones_totales: number;
  wins: number;
  losses: number;
  creado_en: string;
}

export default function AdminUsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("admin_resumen_usuarios").then(({ data, error }) => {
      if (error) setError(error.message);
      else setUsuarios((data as Usuario[]) ?? []);
      setCargando(false);
    });
  }, []);

  if (cargando) return <p className="text-sm text-neutral-500">Cargando…</p>;
  if (error) return <p className="text-sm text-red-600">No se pudo cargar: {error}</p>;

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Usuarios</h1>
      <p className="mb-6 text-sm text-neutral-500">{usuarios.length} usuarios registrados.</p>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Usuario</th>
              <th className="px-3 py-2 font-medium">Piso</th>
              <th className="px-3 py-2 font-medium">Balance</th>
              <th className="px-3 py-2 font-medium">Modo</th>
              <th className="px-3 py-2 font-medium">Eventos</th>
              <th className="px-3 py-2 font-medium">W/L</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.user_id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2 capitalize">{u.piso ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{u.balance != null ? `$${Number(u.balance).toLocaleString("es-MX")}` : "—"}</td>
                <td className="px-3 py-2">{u.modo ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{u.posiciones_totales}</td>
                <td className="px-3 py-2 tabular-nums">{u.wins}/{u.losses}</td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr><td className="px-3 py-4 text-neutral-400" colSpan={6}>Sin usuarios todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
