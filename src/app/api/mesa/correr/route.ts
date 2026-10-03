import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PLUGINS, AnalistaRow, Borrador, PluginAnalista, tasaCetesBanxico } from "@/lib/mesa/analistas";
import { SinDatos } from "@/lib/mesa/fuentes";
import { redactar } from "@/lib/mesa/narrativa";
import { calcularPayoff, ProductoMesa, TramoCarry } from "@/lib/mesa/payoff";

// Mesa de derivados -- corre a los analistas.
//   GET  = cron de Vercel (vercel.json), con Authorization: Bearer CRON_SECRET.
//   POST = botón "Correr analistas" de /admin/mesa, con el access token del operador.
// Lo que sale de aquí entra a mesa_propuestas en estado 'pendiente': nada
// llega a la app sin pasar por la mesa y por Riesgo.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ResultadoAnalista {
  analista: string;
  estado: "propuesta" | "duplicada" | "sin_datos" | "error";
  detalle: string;
}

type Db = ReturnType<typeof supabaseAdmin>;

export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  return correr("cron", null);
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "falta sesión" }, { status: 401 });
  let admin;
  try {
    admin = supabaseAdmin();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const { data: u } = await admin.auth.getUser(token);
  if (!u.user) return NextResponse.json({ error: "sesión inválida" }, { status: 401 });
  const { data: op } = await admin.from("operadores").select("user_id").eq("user_id", u.user.id).maybeSingle();
  if (!op) return NextResponse.json({ error: "no eres operador" }, { status: 403 });
  return correr("manual", u.user.id);
}

async function correr(origen: "cron" | "manual", userId: string | null) {
  let db;
  try {
    db = supabaseAdmin();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const [{ data: analistas, error: e1 }, { data: productos, error: e2 }, { data: tramos }, { data: params }] = await Promise.all([
    db.from("mesa_analistas").select("clave, nombre, mercado, config").eq("activo", true),
    db.from("productos").select("clave, nombre, precio, gente_requerida, dias_resolucion, alpha_em").eq("activo", true),
    db.from("producto_carry_tramos").select("producto_clave, orden, premio_hasta, carry_pct"),
    db.from("parametros_pricing").select("tasa_cetes_anual").maybeSingle(),
  ]);
  if (e1 || e2) return NextResponse.json({ error: (e1 || e2)!.message }, { status: 500 });

  const prods = (productos ?? []).map((p) => ({
    ...p,
    precio: Number(p.precio),
    alpha_em: p.alpha_em == null ? null : Number(p.alpha_em),
  })) as ProductoMesa[];
  const tramosN = (tramos ?? []).map((t) => ({
    ...t,
    premio_hasta: t.premio_hasta == null ? null : Number(t.premio_hasta),
    carry_pct: Number(t.carry_pct),
  })) as TramoCarry[];

  let tasa: { valor: number; fuente: string } | null = null;
  if (params?.tasa_cetes_anual != null) tasa = { valor: Number(params.tasa_cetes_anual), fuente: "parametros_pricing" };
  else {
    const vivo = await tasaCetesBanxico();
    if (vivo != null) tasa = { valor: vivo, fuente: "CETES 28 Banxico (dato vivo)" };
  }

  const { data: corrida, error: e3 } = await db
    .from("mesa_corridas")
    .insert({ origen, iniciada_por: userId })
    .select("id")
    .single();
  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

  const ctx = { db, corridaId: corrida.id as string, prods, tramosN, tasa };
  const resultados: ResultadoAnalista[] = (
    await Promise.all(
      ((analistas ?? []) as AnalistaRow[]).map(async (a): Promise<ResultadoAnalista[]> => {
        const plugin = PLUGINS[a.clave];
        if (!plugin) return [{ analista: a.clave, estado: "error", detalle: "analista sin plugin en src/lib/mesa/analistas" }];
        try {
          const borradores = await plugin.proponer(a, prods);
          return await Promise.all(borradores.map((b) => guardar(ctx, a, plugin, b)));
        } catch (e) {
          if (e instanceof SinDatos) return [{ analista: a.clave, estado: "sin_datos", detalle: e.message }];
          return [{ analista: a.clave, estado: "error", detalle: (e as Error).message }];
        }
      })
    )
  ).flat();

  const creadas = resultados.filter((r) => r.estado === "propuesta").length;
  await db
    .from("mesa_corridas")
    .update({ terminada_en: new Date().toISOString(), propuestas_creadas: creadas, resultado: resultados })
    .eq("id", corrida.id);

  return NextResponse.json({ corrida: corrida.id, propuestas_creadas: creadas, resultados });
}

async function guardar(
  ctx: { db: Db; corridaId: string; prods: ProductoMesa[]; tramosN: TramoCarry[]; tasa: { valor: number; fuente: string } | null },
  a: AnalistaRow,
  plugin: PluginAnalista,
  b: Borrador
): Promise<ResultadoAnalista> {
  const { db } = ctx;
  const { data: viva } = await db
    .from("mesa_propuestas")
    .select("id")
    .eq("analista_clave", a.clave)
    .eq("pregunta", b.pregunta)
    .in("estado", ["pendiente", "aceptada", "aprobada_riesgo"])
    .maybeSingle();
  if (viva) return { analista: a.clave, estado: "duplicada", detalle: b.pregunta };

  const narrativa = await redactar(a.nombre, b);
  const niveles = ctx.prods.map((p) => calcularPayoff(b.base.probabilidad, p, ctx.tramosN, ctx.tasa));

  const { data: prop, error } = await db
    .from("mesa_propuestas")
    .insert({
      analista_clave: a.clave,
      corrida_id: ctx.corridaId,
      titulo: b.titulo,
      pregunta: b.pregunta,
      descripcion_usuario: narrativa.descripcion_usuario,
      categoria: b.categoria,
      fuente_resolucion: b.fuente_resolucion,
      fecha_resolucion: b.fecha_resolucion.toISOString(),
      fecha_texto: b.fecha_texto,
      modelo_estocastico: b.base.modelo,
      probabilidad: b.base.probabilidad,
      prob_baja: b.base.prob_baja,
      prob_alta: b.base.prob_alta,
      parametros: b.base.parametros,
      datos: { ...b.datos, narrativa: narrativa.motor },
      riesgo_legal: plugin.riesgoLegal.nivel,
      nota_legal: plugin.riesgoLegal.nota,
      tesis: narrativa.tesis,
      riesgos: narrativa.riesgos,
      payoff: { niveles, tasa_cetes: ctx.tasa },
      producto_sugerido: b.producto_sugerido,
    })
    .select("id")
    .single();
  if (error) return { analista: a.clave, estado: "error", detalle: error.message };

  await db.from("mesa_bitacora").insert({
    propuesta_id: prop.id,
    accion: "agente_propone",
    nota: `${a.nombre}: p=${b.base.probabilidad.toFixed(2)} (${b.base.modelo})`,
  });
  return { analista: a.clave, estado: "propuesta", detalle: b.pregunta };
}
