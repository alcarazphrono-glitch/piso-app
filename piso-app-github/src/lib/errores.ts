// Ver comentario histórico en el fix del Event Manager (commit f016a12):
// los errores de Supabase/Postgrest NO son instancias de Error -- son
// objetos planos {message, code, details, hint}. `e instanceof Error` da
// false y String(e) regresa "[object Object]" en vez del mensaje real.
// Centralizado aquí para que el resto del panel de administración
// (Configuración, lo que siga) no reintroduzca el mismo bug.
export function mensajeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
