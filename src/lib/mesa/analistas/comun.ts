import type { ProductoMesa } from "../payoff";

export const DIA = 86_400_000;
// Margen para que el humano y Riesgo revisen antes de publicar.
export const DIAS_REVISION = 3;

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaLarga(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "America/Mexico_City" }).format(d);
}

// El nivel más largo cuya venta cierra antes del evento y que no retiene el
// capital más de 7 días después de terminar (misma regla que mesa_publicar).
export function elegirNivel(fechaEvento: Date, productos: ProductoMesa[], ahora = new Date()): string | null {
  const dias = (fechaEvento.getTime() - ahora.getTime()) / DIA - DIAS_REVISION;
  const cabe = productos
    .filter((p) => dias >= p.dias_resolucion && dias - p.dias_resolucion <= 7 - DIAS_REVISION)
    .sort((a, b) => b.dias_resolucion - a.dias_resolucion);
  return cabe[0]?.clave ?? null;
}
