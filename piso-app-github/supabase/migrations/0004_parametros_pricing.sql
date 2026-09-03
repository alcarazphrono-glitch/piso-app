-- PISO Core -- Configuración: parámetros del modelo (3-sep-2026)
-- =====================================================================
-- Pedido de Beto después de ver el Event Manager funcionando: no solo
-- eventos individuales -- un panel donde vivan las variables que
-- alimentan el modelo, editable sin tocar código ni pasar por el SQL
-- Editor. Fila única (id=1) a propósito -- es UN estado vigente del
-- modelo, no varias configuraciones que coexisten.
--
-- float_pct / carry_pct / cetes_rate_anual se agregan ya, vacíos, como
-- los campos que va a necesitar el motor real de Finanzas
-- (piso_fase0/pricing_engine.py, float 25% / carry 12% sobre CETES, ver
-- brief de arranque) el día que llegue -- así conectar eso después es
-- llenar un formulario, no una migración nueva.

create table if not exists public.parametros_pricing (
  id smallint primary key default 1,
  ticket_demo_mxn numeric not null default 500,
  multiplicador_demo numeric not null default 0.55,
  float_pct numeric,
  carry_pct numeric,
  cetes_rate_anual numeric,
  actualizado_por uuid references auth.users(id),
  actualizado_en timestamptz not null default now(),
  constraint parametros_pricing_singleton check (id = 1)
);

insert into public.parametros_pricing (id)
  values (1)
  on conflict (id) do nothing;

alter table public.parametros_pricing enable row level security;

drop policy if exists "operadores ven parametros" on public.parametros_pricing;
create policy "operadores ven parametros" on public.parametros_pricing
  for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));
-- Sin policy de insert/update -- se escribe solo vía
-- actualizar_parametros_pricing() (SECURITY DEFINER), mismo patrón que
-- resolver_evento() en 0002.

create or replace function public.actualizar_parametros_pricing(
  p_ticket_demo_mxn numeric,
  p_multiplicador_demo numeric,
  p_float_pct numeric default null,
  p_carry_pct numeric default null,
  p_cetes_rate_anual numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.operadores o where o.user_id = auth.uid()) then
    raise exception 'No autorizado: se requiere rol de operador';
  end if;

  update public.parametros_pricing
    set ticket_demo_mxn = p_ticket_demo_mxn,
        multiplicador_demo = p_multiplicador_demo,
        float_pct = p_float_pct,
        carry_pct = p_carry_pct,
        cetes_rate_anual = p_cetes_rate_anual,
        actualizado_por = auth.uid(),
        actualizado_en = now()
    where id = 1;
end;
$$;
revoke all on function public.actualizar_parametros_pricing(numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function public.actualizar_parametros_pricing(numeric, numeric, numeric, numeric, numeric) to authenticated;

-- calcular_premio_potencial() deja de traer 500 / 0.55 hardcodeados en el
-- cuerpo de la función -- los lee de aquí. Esto es lo que de verdad
-- mueve la fricción: cambiar el multiplicador deja de ser un deploy de
-- código y pasa a ser un campo en Configuración.
create or replace function public.calcular_premio_potencial(p_evento_id text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_evento record;
  v_ticket_demo numeric;
  v_multiplicador_demo numeric;
begin
  select * into v_evento from public.eventos where id = p_evento_id;
  if not found then
    raise exception 'Evento no encontrado: %', p_evento_id;
  end if;

  if v_evento.premio_override is not null then
    return v_evento.premio_override;
  end if;

  select ticket_demo_mxn, multiplicador_demo
    into v_ticket_demo, v_multiplicador_demo
    from public.parametros_pricing where id = 1;

  return round(
    (coalesce(v_ticket_demo, 500) * coalesce(v_multiplicador_demo, 0.55))
    / coalesce(v_evento.probabilidad, 0.5)
  );
end;
$$;
