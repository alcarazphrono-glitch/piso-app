-- PISO Core -- Mejoras post-checkpoint (3-sep-2026)
-- =====================================================================
-- Pedido explícito de Beto tras el primer checkpoint: bajar la fricción
-- de conectar productos financieros reales después, sin perder precisión
-- hoy. Dos mejoras concretas de esta sesión:
--
-- 1. El premio potencial deja de vivir en TypeScript (config.ts) y pasa a
--    vivir en la tabla `eventos` (columna `premio_override`) + una función
--    de servidor. El día que Finanzas confirme una cifra real, un
--    operador la edita en Event Manager -- no hace falta tocar código ni
--    redesplegar. Un trigger fuerza que lo que se guarda en
--    posiciones.premio_potencial SIEMPRE salga de esa función, nunca de
--    lo que mande el cliente.
--
-- 2. ledger_movimientos gana una columna `modo` (mismo patrón que
--    balances.modo: 'demo' | 'real'), definida ANTES de que exista dinero
--    real -- así, cuando llegue, es una migración de agregar filas con
--    modo='real', no de rediseñar el esquema con datos ya cargados.

-- ---------------------------------------------------------------------
-- 1. Premio potencial: fuente única de verdad
-- ---------------------------------------------------------------------
alter table public.eventos
  add column if not exists premio_override numeric;
comment on column public.eventos.premio_override is
  'Cifra de premio validada (ej. por Finanzas) para depósito TICKET_DEMO_MXN.
   Si es NULL, calcular_premio_potencial() usa la fórmula placeholder.
   Editable desde Event Manager -- no requiere deploy de código.';

-- Backfill: preserva exactamente el comportamiento de hoy.
-- Banxico: Behavioral validó $10,919 (Bloque 8, ver src/lib/config.ts
-- histórico) -- se vuelve la cifra "oficial" editable, no un hardcode.
-- INPC: sigue sin validar -- se deja NULL a propósito, usa la fórmula.
update public.eventos set premio_override = 10919 where id = 'banxico_baja_tasas' and premio_override is null;

create or replace function public.calcular_premio_potencial(p_evento_id text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_evento record;
  -- Mismos valores que premioPotencialDemo() / premioPlaceholder() en el
  -- código anterior (src/types/index.ts, src/lib/config.ts) -- calibrados
  -- solo para el loop conductual, NO son cifra de negocio real (ver
  -- RECONCILIACION_PENDIENTE, memo de Finanzas).
  v_ticket_demo constant numeric := 500;
  v_multiplicador_demo constant numeric := 0.55;
begin
  select * into v_evento from public.eventos where id = p_evento_id;
  if not found then
    raise exception 'Evento no encontrado: %', p_evento_id;
  end if;

  if v_evento.premio_override is not null then
    return v_evento.premio_override;
  end if;

  return round((v_ticket_demo * v_multiplicador_demo) / coalesce(v_evento.probabilidad, 0.5));
end;
$$;
-- De lectura amplia a propósito: es una función pura, sin efectos
-- secundarios, y Consumer la necesita para mostrar el mismo número que
-- después se va a guardar (ver evento/[id]/page.tsx).
revoke all on function public.calcular_premio_potencial(text) from public;
grant execute on function public.calcular_premio_potencial(text) to authenticated;

-- El trigger es lo que de verdad cierra el hueco de confianza: pase lo
-- que pase en el cliente (incluso si alguien llama a la API de Supabase
-- directo, sin pasar por la app), el premio guardado siempre sale de
-- calcular_premio_potencial(), nunca del valor que mande el insert.
create or replace function public.forzar_premio_potencial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.premio_potencial := public.calcular_premio_potencial(new.evento_id);
  return new;
end;
$$;

drop trigger if exists trg_forzar_premio_potencial on public.posiciones;
create trigger trg_forzar_premio_potencial
  before insert on public.posiciones
  for each row execute function public.forzar_premio_potencial();

-- ---------------------------------------------------------------------
-- 2. Ledger: demo vs. real, definido desde antes de que exista dinero real
-- ---------------------------------------------------------------------
alter table public.ledger_movimientos
  add column if not exists modo text not null default 'demo' check (modo in ('demo','real'));
comment on column public.ledger_movimientos.modo is
  'Mismo patrón que balances.modo. Todo lo que existe hoy es demo -- esta
   columna es la que evita que, el día que haya modo real, haya que
   rediseñar el esquema con datos ya cargados encima.';

-- Las funciones que ya escriben al ledger se actualizan para declarar
-- modo='demo' explícitamente (antes quedaba implícito en el default).
create or replace function public.iniciar_balance_demo()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  insert into public.perfiles (user_id, piso) values (v_uid, 'tierra')
    on conflict (user_id) do nothing;

  insert into public.balances (user_id, demo_balance, modo) values (v_uid, 1000, 'demo')
    on conflict (user_id) do nothing;

  insert into public.ledger_movimientos (user_id, posicion_id, tipo, monto, saldo_resultante, modo)
    select v_uid, null, 'deposito_demo', 1000, 1000, 'demo'
    where not exists (
      select 1 from public.ledger_movimientos
      where user_id = v_uid and tipo = 'deposito_demo'
    );

  return (select demo_balance from public.balances where user_id = v_uid);
end;
$$;

create or replace function public.simular_resultado_posicion_demo(p_posicion_id uuid)
returns table (resultado text, nuevo_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pos record;
  v_prob numeric;
  v_ocurrio boolean;
  v_resultado text;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_pos from public.posiciones where id = p_posicion_id for update;
  if not found then
    raise exception 'Posición no encontrada';
  end if;
  if v_pos.user_id <> v_uid then
    raise exception 'Esta posición no te pertenece';
  end if;
  if v_pos.estado <> 'abierta' then
    raise exception 'Esta posición ya está resuelta';
  end if;

  select probabilidad into v_prob from public.eventos where id = v_pos.evento_id;

  v_ocurrio := random() < coalesce(v_prob, 0.5);
  v_resultado := case when (v_pos.respuesta = 'si') = v_ocurrio then 'gano' else 'no_gano' end;

  update public.posiciones
    set estado = 'resuelta', resultado = v_resultado, resuelta_en = now()
    where id = p_posicion_id;

  select demo_balance into v_balance from public.balances where user_id = v_uid for update;

  if v_resultado = 'gano' then
    v_balance := v_balance + v_pos.premio_potencial;
    update public.balances set demo_balance = v_balance, actualizado_en = now() where user_id = v_uid;
    insert into public.ledger_movimientos (user_id, posicion_id, tipo, monto, saldo_resultante, modo)
      values (v_uid, p_posicion_id, 'premio', v_pos.premio_potencial, v_balance, 'demo');
  end if;

  return query select v_resultado, v_balance;
end;
$$;

create or replace function public.resolver_evento(
  p_evento_id text,
  p_resultado text,
  p_fuente text,
  p_evidencia text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int := 0;
  v_pos record;
  v_gano boolean;
  v_balance numeric;
begin
  if not exists (select 1 from public.operadores o where o.user_id = v_uid) then
    raise exception 'No autorizado: se requiere rol de operador';
  end if;

  if not exists (select 1 from public.eventos where id = p_evento_id) then
    raise exception 'Evento no encontrado';
  end if;

  update public.eventos
    set estado = 'resuelto', resultado_oficial = p_resultado
    where id = p_evento_id;

  insert into public.resoluciones (evento_id, fuente, resultado, evidencia, resuelto_por, es_demo)
    values (p_evento_id, p_fuente, p_resultado, p_evidencia, v_uid, true);

  for v_pos in
    select * from public.posiciones
    where evento_id = p_evento_id and estado = 'abierta'
    for update
  loop
    v_gano := (v_pos.respuesta = 'si' and p_resultado = 'si')
           or (v_pos.respuesta = 'no' and p_resultado <> 'si');

    update public.posiciones
      set estado = 'resuelta',
          resultado = case when v_gano then 'gano' else 'no_gano' end,
          resuelta_en = now()
      where id = v_pos.id;

    if v_gano then
      select demo_balance into v_balance from public.balances where user_id = v_pos.user_id for update;
      v_balance := v_balance + v_pos.premio_potencial;
      update public.balances set demo_balance = v_balance, actualizado_en = now() where user_id = v_pos.user_id;
      insert into public.ledger_movimientos (user_id, posicion_id, tipo, monto, saldo_resultante, modo)
        values (v_pos.user_id, v_pos.id, 'premio', v_pos.premio_potencial, v_balance, 'demo');
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
