import { supabase } from "./supabase";
import { TICKET_DEMO_MXN } from "./config";

// PISO Core, checkpoint 17-sep-2026: /admin/configuracion deja editar el
// ticket demo desde la tabla parametros_pricing -- este helper es lo que
// hace que Consumer de verdad lo refleje. Si la lectura falla (por ejemplo,
// sin sesión todavía), cae al valor de config.ts como respaldo -- nunca
// deja la pantalla sin número.
export async function obtenerTicketDemo(): Promise<number> {
  const { data, error } = await supabase.from("parametros_pricing").select("ticket_demo_mxn").maybeSingle();
  if (error || !data) return TICKET_DEMO_MXN;
  return (data as { ticket_demo_mxn: number }).ticket_demo_mxn;
}
