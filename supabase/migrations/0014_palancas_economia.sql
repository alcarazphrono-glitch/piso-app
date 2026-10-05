-- =====================================================================
-- 0014 -- Palancas de economía (Finanzas, 4-oct-2026)
-- =====================================================================
-- Beto pidió separar, estilo Uber, lo que PISO no puede mover (CETES,
-- impuestos, regulación, proveedores) de las palancas que sí decide
-- (cuota, días, N, reparto, saldo, CAC...). Antes de esta migración esas
-- palancas vivían en un HTML aislado; ahora viven aquí, y la app, la
-- consola de la Mesa y la herramienta "Palancas PISO" leen los mismos
-- números con un solo cálculo: src/lib/economia/modelo.ts.
--
-- Qué ya existía y NO se duplica:
--   parametros_pricing.tasa_cetes_anual  (CETES, en %)
--   productos.precio / gente_requerida / dias_resolucion / alpha_em
--   producto_carry_tramos                 (carry, en %)
--
-- Se siembra con los valores de HOY: cuota 0, nada al premio, nada de
-- saldo. Ningún comportamiento de la app cambia hasta que Finanzas o
-- Beto muevan una palanca desde la consola.
-- =====================================================================

-- 1. Cuota por evento, por nivel (precio con IVA, en MXN).
alter table public.productos
  add column if not exists cuota_evento numeric not null default 0 check (cuota_evento >= 0);

comment on column public.productos.cuota_evento is
  'Cuota por evento en MXN, IVA incluido. 0 = sin cuota (hoy). Palanca de Finanzas; requiere visto bueno de Legal (sorteo con participación pagada).';

-- 2. Palancas y variables fijas globales -- fila única.
create table if not exists public.economia_parametros (
  id boolean primary key default true check (id),

  -- Palancas de producto (fracciones: 0.25 = 25%)
  alpha_c1 numeric not null default 0 check (alpha_c1 between 0 and 1),            -- premio por antigüedad (choque abierto 0% vs 10%)
  cuota_al_premio numeric not null default 0 check (cuota_al_premio between 0 and 1), -- parte de la cuota (sin IVA) que va al premio
  saldo_entre_ciclos numeric not null default 0 check (saldo_entre_ciclos between 0 and 1), -- dinero que se queda invertido entre eventos

  -- Palancas de crecimiento
  eventos_por_usuario_mes numeric not null default 1 check (eventos_por_usuario_mes > 0),
  cac_mxn numeric not null default 50,
  bono_bienvenida_mxn numeric not null default 0,
  churn_mensual numeric not null default 0.06 check (churn_mensual > 0 and churn_mensual < 1),
  usuarios_objetivo integer not null default 50000,
  mezcla_entrada numeric not null default 0.65,
  mezcla_crecimiento numeric not null default 0.25,
  mezcla_elite numeric not null default 0.10,

  -- Variables fijas (no dependen de PISO). Estimados del CFO hasta cotizar.
  spread_reporto numeric not null default 0,          -- reporto/fondo diario paga menos que CETES 28 (estimado 0.003; en 0 hasta cotizar custodio para no mover premios)
  iva numeric not null default 0.16,
  isr_premio numeric not null default 0.07,           -- 1% federal + ~6% estatal sobre premios de sorteo
  aprovechamiento_segob numeric not null default 0.01, -- sobre cuotas; supuesto, confirmar con Legal
  custodia_anual numeric not null default 0.0015,
  costo_pago_mxn numeric not null default 4,          -- por movimiento SPEI
  infra_usuario_ano_mxn numeric not null default 6,
  kyc_mxn numeric not null default 12,
  costos_fijos_mes_mxn numeric not null default 265000,

  -- Valor mínimo para el cliente (umbrales del buscador de combinaciones)
  umbral_multiplo_premio numeric not null default 4,
  umbral_espera_dias numeric not null default 7,
  umbral_costo_mes_mxn numeric not null default 100,
  umbral_costo_ano_pct numeric not null default 0.25,

  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.operadores(user_id),

  constraint mezcla_suma_uno check (abs(mezcla_entrada + mezcla_crecimiento + mezcla_elite - 1) < 0.001)
);

insert into public.economia_parametros (id) values (true) on conflict (id) do nothing;

comment on table public.economia_parametros is
  'Palancas y variables fijas del modelo de unit economics (Finanzas, 4-oct-2026). Un solo cálculo las usa: src/lib/economia/modelo.ts. Cambios quedan en economia_parametros_historial.';

alter table public.economia_parametros enable row level security;

-- CAC, churn y costos son internos: solo operadores los leen y editan.
create policy "operadores leen economia_parametros"
  on public.economia_parametros for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores editan economia_parametros"
  on public.economia_parametros for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- 3. Historial: cada cambio guarda la fila anterior completa (solo insert).
create table if not exists public.economia_parametros_historial (
  id bigint generated always as identity primary key,
  valores_anteriores jsonb not null,
  valores_nuevos jsonb not null,
  cambiado_en timestamptz not null default now(),
  cambiado_por uuid
);

alter table public.economia_parametros_historial enable row level security;

create policy "operadores leen economia_parametros_historial"
  on public.economia_parametros_historial for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create or replace function public.economia_parametros_auditar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  insert into public.economia_parametros_historial (valores_anteriores, valores_nuevos, cambiado_por)
  values (to_jsonb(old), to_jsonb(new), auth.uid());
  return new;
end;
$$;

drop trigger if exists economia_parametros_auditar on public.economia_parametros;
create trigger economia_parametros_auditar
  before update on public.economia_parametros
  for each row execute function public.economia_parametros_auditar();

-- 4. Lo que la app necesita para mostrar el premio sin ver CAC ni costos.
create or replace function public.parametros_premio_publicos()
returns table (alpha_c1 numeric, cuota_al_premio numeric, iva numeric, isr_premio numeric, spread_reporto numeric)
language sql
stable
security definer
set search_path = public
as $$
  select alpha_c1, cuota_al_premio, iva, isr_premio, spread_reporto
  from public.economia_parametros
  limit 1;
$$;

grant execute on function public.parametros_premio_publicos() to anon, authenticated;
