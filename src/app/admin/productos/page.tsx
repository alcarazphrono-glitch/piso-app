"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Admin de productos -- sistema de boletos por nivel (Finanzas, 23-sep-2026).
// Los 3 niveles (Entrada/Crecimiento/Elite) están sembrados por la
// migración 0009 -- este panel los deja editables sin tocar código,
// mismo patrón que /admin/configuracion con los alphas de D4. Los
// nombres de las columnas vienen tal cual del doc de Finanzas:
// gente_requerida y dias_resolucion son "Estimado", no definitivos.

interface Producto {
  clave: string;
  nombre: string;
  precio: number;
  gente_requerida: number;
  dias_resolucion: number;
  alpha_em: number | null;
  premio_estatico: number;
  activo: boolean;
}

interface CarryTramo {
  id: string;
  producto_clave: string;
  orden: number;
  premio_hasta: number | null;
  carry_pct: number;
}

export default function AdminProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [tramos, setTramos] = useState<CarryTramo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const [{ data: p, error: e1 }, { data: t, error: e2 }] = await Promise.all([
      supabase.from("productos").select("*").order("precio", { ascending: true }),
      supabase.from("producto_carry_tramos").select("*").order("producto_clave").order("orden"),
    ]);
    if (!e1) setProductos((p as Producto[]) ?? []);
    if (!e2) setTramos((t as CarryTramo[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardarProducto(e: FormEvent<HTMLFormElement>, clave: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const alphaRaw = form.get("alpha_em");
    const { error } = await supabase
      .from("productos")
      .update({
        precio: Number(form.get("precio")),
        gente_requerida: Number(form.get("gente_requerida")),
        dias_resolucion: Number(form.get("dias_resolucion")),
        alpha_em: alphaRaw === "" || alphaRaw === null ? null : Number(alphaRaw) / 100,
        premio_estatico: Number(form.get("premio_estatico")),
        activo: form.get("activo") === "on",
      })
      .eq("clave", clave);
    setMensaje(error ? `No se pudo guardar "${clave}": ${error.message}` : `Producto "${clave}" actualizado.`);
    if (!error) cargar();
  }

  async function guardarTramo(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const hastaRaw = form.get("premio_hasta");
    const { error } = await supabase
      .from("producto_carry_tramos")
      .update({
        premio_hasta: hastaRaw === "" || hastaRaw === null ? null : Number(hastaRaw),
        carry_pct: Number(form.get("carry_pct")),
      })
      .eq("id", id);
    setMensaje(error ? `No se pudo guardar el tramo: ${error.message}` : "Tramo de carry actualizado.");
    if (!error) cargar();
  }

  if (cargando) return <p className="text-sm text-neutral-500">Cargando…</p>;

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Productos</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Los 3 niveles del sistema de boletos (spec de Finanzas, 23-sep-2026). "Gente requerida" y "días de
        resolución" vienen marcados como Estimado en el documento original.
      </p>

      {mensaje && <div className="mb-4 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm">{mensaje}</div>}

      <div className="mb-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium">alpha_em (comisión de PISO en el modelo de interés) sigue vacío por default.</p>
        <p className="mt-1 text-xs text-amber-700">
          Mientras esté vacío, calcular_premio_ciclo() usa el "premio_estatico" de la tabla de Finanzas (motor
          "estatico") -- en cuanto se llena aquí (y tasa_cetes_anual en Configuración), el sistema pasa solo al
          motor "real" con interés compuesto continuo.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {productos.map((p) => (
          <form
            key={p.clave}
            onSubmit={(e) => guardarProducto(e, p.clave)}
            className="rounded-lg border border-neutral-200 bg-white p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-medium">{p.nombre} <span className="text-xs font-normal text-neutral-400">({p.clave})</span></p>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                <input type="checkbox" name="activo" defaultChecked={p.activo} /> activo
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Campo label="Precio del boleto (MXN)"><input name="precio" type="number" defaultValue={p.precio} className={inputClass} /></Campo>
              <Campo label="Gente requerida (N, estimado)"><input name="gente_requerida" type="number" defaultValue={p.gente_requerida} className={inputClass} /></Campo>
              <Campo label="Días de resolución (estimado)"><input name="dias_resolucion" type="number" defaultValue={p.dias_resolucion} className={inputClass} /></Campo>
              <Campo label="alpha_em % (vacío = motor estático)">
                <input name="alpha_em" type="number" step="0.01" defaultValue={p.alpha_em != null ? p.alpha_em * 100 : ""} placeholder="pendiente" className={inputClass} />
              </Campo>
              <Campo label="Premio estático (tabla de Finanzas)"><input name="premio_estatico" type="number" defaultValue={p.premio_estatico} className={inputClass} /></Campo>
            </div>
            <button type="submit" className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium">
              Guardar
            </button>

            <div className="mt-4 border-t border-neutral-100 pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                Carry escalonado -- estimado, Finanzas dio 12/20/30% pero no los cortes de premio exactos
              </p>
              <div className="flex flex-col gap-2">
                {tramos
                  .filter((t) => t.producto_clave === p.clave)
                  .map((t) => (
                    <form key={t.id} onSubmit={(e) => guardarTramo(e, t.id)} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-16 text-neutral-500">tramo {t.orden}</span>
                      <span className="text-neutral-400">premio hasta</span>
                      <input name="premio_hasta" type="number" defaultValue={t.premio_hasta ?? ""} placeholder="sin tope" className="w-28 rounded-md border border-neutral-300 px-2 py-1" />
                      <span className="text-neutral-400">carry</span>
                      <input name="carry_pct" type="number" defaultValue={t.carry_pct} className="w-16 rounded-md border border-neutral-300 px-2 py-1" />
                      <span className="text-neutral-400">%</span>
                      <button type="submit" className="rounded-md border border-neutral-300 px-2 py-1 font-medium">Guardar</button>
                    </form>
                  ))}
              </div>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}

const inputClass = "w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
