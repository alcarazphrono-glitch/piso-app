-- PISO Core -- Pricing Engine real + espacio de Finanzas + auditoría
-- =====================================================================
-- Correr en el SQL Editor de Supabase DESPUÉS de 0002_piso_core.sql.
--
-- Qué resuelve, en una frase: float_pct / carry_pct / tasa_cetes_anual ya
-- existían en parametros_pricing desde la migración anterior, pero solo
-- vivían ahí como columnas sin usar y un letrero de "pendiente de
-- Finanzas" en la pantalla. Esta migración no inventa esos tres números
-- -- eso le toca a Finanzas -- pero sí construye la fórmula real
-- (float/carry sobre rendimiento de CETES, piso_fase0/pricing_engine.py)
-- para que el día que se llenen, el sistema empiece a calcular premios
-- reales automáticamente. Mientras tanto, sigue cayendo a la fórmula
-- placeholder de siempre -- nunca truena por falta de dato.

-- ---------------------------------------------------------------------
-- 1. Estado explícito del premio por evento -- saca la reconciliación
-- pendiente ($10,919 vs $8,750 de Banxico) del comentario en config.ts y
-- la vuelve un campo real, visible en /admin/eventos.
-- ---------------------------------------------------------------------
alter table public.eventos
  add column if not exists premio_estado text not null default 'formula_automatica'
    check (premio_estado in ('validado', 'interino_pendiente_finanzas', 'formula_automatica'));

update public.eventos
  set premio_estado = 'interino_pendiente_finanzas'
  where id = 'banxico_baja_tasas';
  -- $10,919 (Behavioral, Bloque 8, d=$500) vs $8,750 (DG, memo original,
  -- d=$1,000) no cuadran linealmente -- sigue sin confirmar con Finanzas
  -- cuál es el canónico. Ver checkpoint 3-sep-2026.

-- inpc_bajo se queda en 'formula_automatica' (default) -- no tiene
-- premio_override, cae a la fórmula.

-- ---------------------------------------------------------------------
-- 2. calcular_premio_potencial -- se reemplaza (mismo nombre y firma, así
-- que confirmar_posicion() no necesita ningún cambio) para intentar
-- primero el motor real, y solo caer al placeholder si falta algún dato.
-- ---------------------------------------------------------------------
create or replace function public.calcular_premio_potencial(p_evento_id text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override numeric;
  v_probabilidad numeric;
  v_fecha_apertura timestamptz;
  v_fecha_cierre timestamptz;
  v_ticket numeric;
  v_multiplicador numeric;
  v_float_pct numeric;
  v_carry_pct numeric;
  v_tasa_cetes numeric;
  v_dias numeric;
  v_rendimiento_cetes numeric;
  v_premio_bruto numeric;
begin
  select premio_override, probabilidad, fecha_apertura, fecha_cierre
    into v_override, v_probabilidad, v_fecha_apertura, v_fecha_cierre
    from public.eventos where id = p_evento_id;

  if v_probabilidad is null then
    raise exception 'evento % no existe', p_evento_id;
  end if;

  -- Un premio fijo (premio_override) manda siempre, sea 'validado' o
  -- 'interino_pendiente_finanzas' -- ninguno de los dos debe recalcularse
  -- con la fórmula mientras el campo siga puesto.
  if v_override is not null then
    return v_override;
  end if;

  select ticket_demo_mxn, multiplicador_demo, float_pct, carry_pct, tasa_cetes_anual
    into v_ticket, v_multiplicador, v_float_pct, v_carry_pct, v_tasa_cetes
    from public.parametros_pricing limit 1;

  if v_float_pct is not null and v_carry_pct is not null and v_tasa_cetes is not null
     and v_fecha_apertura is not null and v_fecha_cierre is not null
     and v_fecha_cierre > v_fecha_apertura then
    -- Motor real: rendimiento de CETES durante la ventana del evento,
    -- multiplicado por el % de float que financia el pool, dividido entre
    -- la probabilidad (para que el pago esperado cuadre con el float
    -- disponible), menos el carry que retiene PISO.
    v_dias := extract(epoch from (v_fecha_cierre - v_fecha_apertura)) / 86400.0;
    v_rendimiento_cetes := v_ticket * (v_tasa_cetes / 100.0) * (v_dias / 365.0);
    v_premio_bruto := (v_rendimiento_cetes * (v_float_pct / 100.0)) / v_probabilidad;
    return round(v_premio_bruto * (1 - v_carry_pct / 100.0));
  end if;

  -- Fórmula placeholder -- la de siempre, mientras falte algún parámetro.
  return round((v_ticket * v_multiplicador) / v_probabilidad);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Auditoría de parámetros de pricing -- mismo principio que el Ledger:
-- un número que cambia sin dejar rastro de quién y cuándo no es
-- infraestructura seria, aunque sea un número que Tecnología no inventó.
-- ---------------------------------------------------------------------
create table if not exists public.parametros_pricing_historial (
  id uuid primary key default gen_random_uuid(),
  ticket_demo_mxn numeric,
  multiplicador_demo numeric,
  float_pct numeric,
  carry_pct numeric,
  tasa_cetes_anual numeric,
  cambiado_por uuid references public.operadores(user_id),
  cambiado_en timestamptz not null default now()
);

alter table public.parametros_pricing_historial enable row level security;

create policy "operadores ven historial de pricing"
  on public.parametros_pricing_historial for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- Guarda el valor ANTERIOR justo antes de que se sobrescriba -- así el
-- historial responde "qué tenía antes de este cambio", no "qué tiene
-- ahora" (eso ya lo dice la fila viva de parametros_pricing).
create or replace function public.registrar_historial_pricing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.parametros_pricing_historial
    (ticket_demo_mxn, multiplicador_demo, float_pct, carry_pct, tasa_cetes_anual, cambiado_por)
  values (old.ticket_demo_mxn, old.multiplicador_demo, old.float_pct, old.carry_pct, old.tasa_cetes_anual, auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_historial_pricing on public.parametros_pricing;
create trigger trg_historial_pricing
  before update on public.parametros_pricing
  for each row execute function public.registrar_historial_pricing();
