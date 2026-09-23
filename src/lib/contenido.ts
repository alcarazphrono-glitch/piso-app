import { supabase } from "./supabase";

// D14/D15 (memo Behavioral Forest, 17-sep-2026): el copy del Trust Center
// y de los tratamientos vive en la tabla contenido_versionado (migración
// 0007), no en un arreglo hardcodeado dentro de la pantalla. Aquí solo se
// lee lo ACTIVO -- RLS ya restringe contenido_versionado a filas
// `activa = true` para cualquiera que no sea operador (ver 0007), así que
// esta consulta nunca puede filtrar un borrador sin publicar.

export interface PreguntaTrustCenter {
  clave: string;
  q: string;
  a: string;
  pendienteLegal: boolean;
}

export async function obtenerTrustCenter(): Promise<PreguntaTrustCenter[]> {
  const { data, error } = await supabase
    .from("contenido_versionado")
    .select("clave, cuerpo, pendiente_legal")
    .eq("activa", true)
    .like("clave", "trust_center:%")
    .order("clave", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((fila) => {
    const cuerpo = fila.cuerpo as { q?: string; a?: string };
    return {
      clave: fila.clave as string,
      q: cuerpo.q ?? "",
      a: cuerpo.a ?? "",
      pendienteLegal: Boolean(fila.pendiente_legal),
    };
  });
}
