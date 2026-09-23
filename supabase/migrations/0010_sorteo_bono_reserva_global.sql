-- PISO -- Resolución con sorteo, bono de respaldo (Entrada) y reserva/
-- kill-switch GLOBAL. Segunda mitad de la especificación de Finanzas
-- (23-sep-2026), sobre las tablas de 0009_sistema_boletos_por_nivel.sql.
-- Correr DESPUÉS de esa migración.

-- =======================================================================
-- 1. Fórmula real del premio -- N × depósito × (e^(tasa×días/365) − 1) ×
-- (1 − alpha_em) / p_evento, menos el carry escalonado. Falla segura al
-- premio_estatico de la tabla de Finanzas mientras falte tasa_cetes_anual
-- (parametros_pricing, ya existente) o productos.alpha_em -- mismo
-- patrón que calcular_premio_detalle() de las posiciones clásicas.
-- =======================================================================
create or replace function public.calcular_premio_ciclo(p_ciclo_id uuid)
returns table (premio numeric, premio_bruto numeric, carry_pct numeric, motor text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo public.ciclos;
  v_producto public.productos;
  v_tasa_cetes numeric;
  v_probabilidad numeric;
  v_dias numeric;
  v_bruto numeric;
  v_carry numeric;
  v_neto numeric;
begin
  select * into v_ciclo from public.ciclos where id = p_ciclo_id;
  if v_ciclo.id is null then
    raise exception 'ciclo % no existe', p_ciclo_id;
  end if;

  select * into v_producto from public.productos where clave = v_ciclo.producto_clave;
  select probabilidad into v_probabilidad from public.eventos where id = v_ciclo.evento_id;
  select tasa_cetes_anual into v_tasa_cetes from public.parametros_pricing limit 1;

  if v_tasa_cetes is not null and v_producto.alpha_em is not null then
    v_dias := extract(epoch from (v_ciclo.fecha_resolucion - v_ciclo.fecha_inicio)) / 86400.0;
    -- Fórmula confirmada por Finanzas, interés compuesto continuo:
    v_bruto := v_producto.gente_requerida * v_producto.precio
               * (exp((v_tasa_cetes / 100.0) * (v_dias / 365.0)) - 1)
               * (1 - v_producto.alpha_em) / v_probabilidad;

    select coalesce(t.carry_pct, 30) into v_carry
      from public.producto_carry_tramos t
      where t.producto_clave = v_producto.clave
        and (t.premio_hasta is null or v_bruto <= t.premio_hasta)
      order by t.orden asc
      limit 1;

    v_neto := round(v_bruto * (1 - v_carry / 100.0));
  else
    v_bruto := v_producto.premio_estatico;
    v_carry := null;
    v_neto := v_producto.premio_estatico;
  end if;

  -- Bono de respaldo (sección 3, solo Entrada) -- ver activar_bono_bienvenida()
  -- más abajo. Interpretación pragmática, documentada: el memo pide
  -- "asegurar que el premio no caiga por debajo de un piso aceptable de
  -- ~$20,000" -- se implementa como un PISO directo sobre el premio neto
  -- cuando el bono está activo, no como una simulación completa de cómo
  -- el subsidio de adquisición se traduce en rendimiento -- el memo no da
  -- esa mecánica con suficiente detalle para modelarla sin inventar.
  if v_ciclo.bono_bienvenida_activado and v_neto < 20000 then
    v_neto := 20000;
  end if;

  return query select v_neto, v_bruto, v_carry, case when v_tasa_cetes is not null and v_producto.alpha_em is not null then 'real' else 'estatico' end;
end;
$$;

-- =======================================================================
-- 2. Bitácora de resoluciones de ciclo -- espejo de `resoluciones`
-- (0002) pero scoped a ciclos, no a eventos: un mismo evento real puede
-- tener varios ciclos (de distintos niveles) resolviéndose por separado,
-- así que resolver un ciclo NO toca eventos.estado.
-- =======================================================================
create table if not exists public.ciclo_resoluciones (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references public.ciclos(id),
  resultado text not null,
  fuente text not null,
  evidencia text,
  ganador_boleto_id uuid references public.boletos(id), -- null si nadie acertó
  premio_pagado numeric,
  resuelto_por uuid not null references public.operadores(user_id),
  resuelto_en timestamptz not null default now()
);

alter table public.ciclo_resoluciones enable row level security;

create policy "ciclo_resoluciones lectura pública"
  on public.ciclo_resoluciones for select
  using (true); -- misma transparencia que `resoluciones`

-- =======================================================================
-- 3. resolver_ciclo -- D2-compliant en la parte que puede serlo: el
-- RESULTADO del evento real lo confirma un operador a mano, con fuente y
-- evidencia, igual que resolver_evento(). El sorteo (random() server-side)
-- SOLO decide quién, entre los que acertaron ese resultado real, se lleva
-- el premio -- nunca decide el resultado en sí. Devuelve el capital al
-- 100% a TODOS los boletos del ciclo, ganen o no (memo, sección 1).
-- =======================================================================
create or replace function public.resolver_ciclo(
  p_ciclo_id uuid,
  p_resultado text,
  p_fuente text,
  p_evidencia text
)
returns public.ciclo_resoluciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo public.ciclos;
  v_detalle record;
  v_ganador public.boletos;
  v_boleto record;
  v_usuarios_afectados uuid[] := '{}';
  v_violaciones integer;
  v_resolucion public.ciclo_resoluciones;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;
  if p_resultado not in ('si','no') then
    raise exception 'resultado inválido: %', p_resultado;
  end if;

  -- FOR UPDATE: sin este lock, dos operadores resolviendo el mismo ciclo
  -- casi al mismo tiempo podrían ambos pasar el chequeo de estado='lleno'
  -- y pagar el premio dos veces. Con el lock, el segundo espera a que el
  -- primero termine (y su UPDATE a 'resuelto' haga commit); al continuar,
  -- ve estado='resuelto' y la siguiente condición lo detiene con un error
  -- claro en vez de resolver dos veces.
  select * into v_ciclo from public.ciclos where id = p_ciclo_id for update;
  if v_ciclo.id is null then
    raise exception 'ciclo % no existe', p_ciclo_id;
  end if;
  if v_ciclo.estado <> 'lleno' then
    raise exception 'el ciclo % no está listo para resolverse (estado: %) -- debe estar "lleno"', p_ciclo_id, v_ciclo.estado;
  end if;

  select * into v_detalle from public.calcular_premio_ciclo(p_ciclo_id);

  -- Marca acierto en todos los boletos + devuelve capital a TODOS,
  -- ganen o no -- esto es lo que sostiene "tu capital nunca se pierde"
  -- en este modelo (a diferencia de posiciones, donde nunca se tocaba).
  for v_boleto in select * from public.boletos where ciclo_id = p_ciclo_id loop
    update public.boletos
      set acerto = (respuesta = p_resultado), resuelto_en = now()
      where id = v_boleto.id;

    insert into public.ledger_movimientos (user_id, monto, causa, modo)
    values (v_boleto.user_id, v_boleto.monto, 'Devolución de capital -- ciclo resuelto', 'demo');

    if v_boleto.respuesta = p_resultado then
      update public.perfiles set aciertos_acumulados = aciertos_acumulados + 1 where user_id = v_boleto.user_id;
    end if;

    v_usuarios_afectados := array_append(v_usuarios_afectados, v_boleto.user_id);
  end loop;

  -- Sorteo: UN ganador, elegido al azar SOLO entre quienes acertaron. Si
  -- nadie acertó, no hay ganador y el premio no se paga -- el memo no
  -- dice qué pasa con ese premio no pagado (¿se acumula al siguiente
  -- ciclo del mismo nivel? ¿se queda en la reserva?) -- se deja como
  -- pregunta abierta, documentada, no inventada (ver README).
  select b.* into v_ganador
    from public.boletos b
    where b.ciclo_id = p_ciclo_id and b.respuesta = p_resultado
    order by random()
    limit 1;

  if v_ganador.id is not null then
    update public.boletos set ganador = true where id = v_ganador.id;

    insert into public.ledger_movimientos (user_id, monto, causa, modo)
    values (v_ganador.user_id, v_detalle.premio, 'Premio de sorteo -- ciclo ' || p_ciclo_id, 'demo');
  end if;

  update public.ciclos set estado = 'resuelto', actualizado_en = now() where id = p_ciclo_id;

  insert into public.ciclo_resoluciones (ciclo_id, resultado, fuente, evidencia, ganador_boleto_id, premio_pagado, resuelto_por)
  values (p_ciclo_id, p_resultado, p_fuente, p_evidencia, v_ganador.id, case when v_ganador.id is not null then v_detalle.premio else null end, auth.uid())
  returning * into v_resolucion;

  -- D1, igual que resolver_evento(): si algún usuario liquidado queda
  -- fuera de reconciliación de capital, toda la resolución se revierte.
  -- verificar_integridad_capital() ya generaliza sin cambios -- funciona
  -- igual con movimientos negativos (depósito) que solo con positivos.
  if array_length(v_usuarios_afectados, 1) > 0 then
    select count(*) into v_violaciones
    from public.verificar_integridad_capital()
    where user_id = any(v_usuarios_afectados);

    if v_violaciones > 0 then
      raise exception 'D1: % usuario(s) quedaron fuera de reconciliación de capital tras resolver el ciclo % -- resolución revertida',
        v_violaciones, p_ciclo_id;
    end if;
  end if;

  return v_resolucion;
end;
$$;

-- =======================================================================
-- 4. Bono de bienvenida (Entrada, día 15/20, umbral 70%, tope $10,000).
-- Sin cron real -- invocable por un operador; también segura de llamar de
-- más (revisa la condición cada vez, no se puede activar dos veces por el
-- mismo ciclo).
-- =======================================================================
create table if not exists public.bonos_bienvenida (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references public.ciclos(id) unique,
  monto numeric not null,
  activado_por uuid references public.operadores(user_id),
  activado_en timestamptz not null default now()
);

alter table public.bonos_bienvenida enable row level security;

create policy "operadores ven bonos_bienvenida"
  on public.bonos_bienvenida for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create or replace function public.activar_bono_bienvenida(p_ciclo_id uuid, p_monto numeric default 10000)
returns public.bonos_bienvenida
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo public.ciclos;
  v_producto public.productos;
  v_dia_actual numeric;
  v_bono public.bonos_bienvenida;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  select * into v_ciclo from public.ciclos where id = p_ciclo_id;
  if v_ciclo.id is null then
    raise exception 'ciclo % no existe', p_ciclo_id;
  end if;
  select * into v_producto from public.productos where clave = v_ciclo.producto_clave;

  if v_producto.clave <> 'entrada' then
    raise exception 'el bono de bienvenida solo aplica al nivel Entrada (memo, sección 3)';
  end if;
  if v_ciclo.estado <> 'llenando' then
    raise exception 'el ciclo % ya no está llenando (estado: %)', p_ciclo_id, v_ciclo.estado;
  end if;
  if v_ciclo.bono_bienvenida_activado then
    raise exception 'el bono ya fue activado para el ciclo %', p_ciclo_id;
  end if;

  v_dia_actual := extract(epoch from (now() - v_ciclo.fecha_inicio)) / 86400.0;
  if v_dia_actual < 15 then
    -- RAISE de plpgsql solo soporta "%" plano, no especificadores tipo
    -- printf (%.1f) -- eso se quedaba pegado como texto literal. Se
    -- redondea el valor antes de pasarlo en vez de intentar formatearlo
    -- dentro del mensaje.
    raise exception 'todavía no es el día 15 del ciclo (va en el día %)', round(v_dia_actual, 1);
  end if;
  if v_ciclo.lugares_ocupados >= (v_producto.gente_requerida * 0.7) then
    raise exception 'el ciclo ya alcanzó el 70%% de la meta (%/% lugares) -- no aplica el bono', v_ciclo.lugares_ocupados, v_producto.gente_requerida;
  end if;
  if p_monto > 10000 then
    raise exception 'el bono no puede exceder $10,000 por ciclo (memo, sección 3)';
  end if;

  update public.ciclos set bono_bienvenida_activado = true, actualizado_en = now() where id = p_ciclo_id;

  insert into public.bonos_bienvenida (ciclo_id, monto, activado_por)
  values (p_ciclo_id, p_monto, auth.uid())
  returning * into v_bono;

  return v_bono;
end;
$$;

-- =======================================================================
-- 5. Reserva de capital + kill-switch GLOBAL. Distinto del kill-switch
-- por evento de D5 (eventos.exposure_limite_mxn, migración 0005) -- este
-- opera sobre TODOS los ciclos activos de TODOS los niveles a la vez,
-- comparando la exposición agregada contra una reserva realmente fondeada
-- por Tesorería (no solo un cálculo de cuánto SE RECOMIENDA tener).
-- =======================================================================
create table if not exists public.reserva_config (
  id boolean primary key default true check (id),
  factor_premios numeric not null default 1.5, -- colchón por escenarios correlacionados
  factor_liquidez_pct numeric not null default 5, -- colchón de liquidez sobre el capital en pool
  kill_switch_umbral_pct numeric not null default 80,
  reserva_fondeada numeric, -- null = sin fondear todavía -- pendiente de Tesorería, kill switch inactivo mientras tanto
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.operadores(user_id)
);

insert into public.reserva_config (id) values (true) on conflict (id) do nothing;

alter table public.reserva_config enable row level security;

create policy "reserva_config lectura para operadores"
  on public.reserva_config for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores editan reserva_config"
  on public.reserva_config for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create or replace function public.calcular_exposicion_global()
returns table (
  capital_en_pool numeric,
  premios_en_riesgo numeric,
  reserva_minima numeric,
  reserva_fondeada numeric,
  kill_switch_activo boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capital numeric;
  v_premios numeric;
  v_cfg public.reserva_config;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  select * into v_cfg from public.reserva_config limit 1;

  select coalesce(sum(p.precio * c.lugares_ocupados), 0) into v_capital
    from public.ciclos c join public.productos p on p.clave = c.producto_clave
    where c.estado in ('llenando','lleno');

  select coalesce(sum(d.premio), 0) into v_premios
    from public.ciclos c
    cross join lateral public.calcular_premio_ciclo(c.id) d
    where c.estado in ('llenando','lleno');

  return query select
    v_capital,
    v_premios,
    round(v_cfg.factor_premios * v_premios + (v_cfg.factor_liquidez_pct / 100.0) * v_capital),
    v_cfg.reserva_fondeada,
    (v_cfg.reserva_fondeada is not null and v_premios > (v_cfg.kill_switch_umbral_pct / 100.0) * v_cfg.reserva_fondeada);
end;
$$;

-- comprar_boleto se reemplaza una vez más solo para agregar el chequeo
-- del kill-switch global antes de aceptar un boleto nuevo -- mismo cuerpo
-- que 0009, con un chequeo extra al principio.
create or replace function public.comprar_boleto(p_ciclo_id uuid, p_respuesta text)
returns public.boletos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo public.ciclos;
  v_producto public.productos;
  v_balance numeric;
  v_boleto public.boletos;
  v_cfg public.reserva_config;
  v_premios numeric;
begin
  if auth.uid() is null then
    raise exception 'comprar_boleto requiere sesión activa';
  end if;
  if p_respuesta not in ('si','no') then
    raise exception 'respuesta inválida: %', p_respuesta;
  end if;

  select * into v_cfg from public.reserva_config limit 1;
  if v_cfg.reserva_fondeada is not null then
    select coalesce(sum(d.premio), 0) into v_premios
      from public.ciclos c
      cross join lateral public.calcular_premio_ciclo(c.id) d
      where c.estado in ('llenando','lleno');
    if v_premios > (v_cfg.kill_switch_umbral_pct / 100.0) * v_cfg.reserva_fondeada then
      raise exception 'kill switch global: la exposición de premios ($%) superó el % %% de la reserva fondeada ($%) -- ventas pausadas en todos los niveles',
        v_premios, v_cfg.kill_switch_umbral_pct, v_cfg.reserva_fondeada;
    end if;
  end if;

  select * into v_ciclo from public.ciclos where id = p_ciclo_id for update;
  if v_ciclo.id is null then
    raise exception 'ciclo % no existe', p_ciclo_id;
  end if;
  if v_ciclo.estado <> 'llenando' then
    raise exception 'el ciclo % no está aceptando boletos (estado: %)', p_ciclo_id, v_ciclo.estado;
  end if;
  if now() > v_ciclo.fecha_resolucion then
    raise exception 'el ciclo % ya pasó su fecha límite de llenado', p_ciclo_id;
  end if;

  select * into v_producto from public.productos where clave = v_ciclo.producto_clave;

  -- Mismo fix que en 0009: lock de fila para evitar doble gasto entre
  -- compras concurrentes en ciclos distintos.
  select demo_balance into v_balance from public.balances where user_id = auth.uid() for update;
  if v_balance is null or v_balance < v_producto.precio then
    raise exception 'saldo insuficiente -- necesitas $% para este boleto', v_producto.precio;
  end if;

  insert into public.ledger_movimientos (user_id, monto, causa, modo)
  values (auth.uid(), -v_producto.precio, 'Depósito -- boleto ' || v_producto.nombre || ' (ciclo ' || p_ciclo_id || ')', 'demo');

  insert into public.boletos (ciclo_id, user_id, respuesta, monto)
  values (p_ciclo_id, auth.uid(), p_respuesta, v_producto.precio)
  returning * into v_boleto;

  update public.ciclos
    set lugares_ocupados = lugares_ocupados + 1,
        actualizado_en = now(),
        estado = case when lugares_ocupados + 1 >= v_producto.gente_requerida then 'lleno' else estado end,
        fecha_llenado = case when lugares_ocupados + 1 >= v_producto.gente_requerida then now() else fecha_llenado end
    where id = p_ciclo_id;

  update public.perfiles
    set racha_actual = racha_actual + 1,
        racha_actualizada_en = now(),
        volumen_depositado_acumulado = volumen_depositado_acumulado + v_producto.precio
    where user_id = auth.uid();

  perform public.recalcular_piso(auth.uid());
  perform public.procesar_recompensa_referido(auth.uid());

  return v_boleto;
end;
$$;

-- ---------------------------------------------------------------------
-- procesar_recompensa_referido -- se reemplaza para contar el primer
-- evento del referido sobre `posiciones` Y `boletos` juntos -- D8 dice
-- "primer evento", no "primera posición clásica" -- un usuario que llega
-- por referido y su primera acción es comprar un boleto debe generar la
-- recompensa igual que si hubiera confirmado una posición.
-- ---------------------------------------------------------------------
create or replace function public.procesar_recompensa_referido(p_nuevo_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referidor uuid;
  v_total_eventos integer;
  v_monto numeric;
  v_cap integer;
  v_recompensas_este_mes integer;
begin
  select referido_por into v_referidor from public.perfiles where user_id = p_nuevo_usuario_id;
  if v_referidor is null then
    return;
  end if;

  select
    (select count(*) from public.posiciones where user_id = p_nuevo_usuario_id)
    + (select count(*) from public.boletos where user_id = p_nuevo_usuario_id)
    into v_total_eventos;
  if v_total_eventos <> 1 then
    return;
  end if;

  if exists (select 1 from public.referidos_recompensas where referido_id = p_nuevo_usuario_id) then
    return;
  end if;

  select monto_recompensa, cap_mensual_por_referidor into v_monto, v_cap from public.referidos_config limit 1;

  select count(*) into v_recompensas_este_mes
  from public.referidos_recompensas
  where referidor_id = v_referidor and creado_en >= date_trunc('month', now());

  if v_recompensas_este_mes >= v_cap then
    return;
  end if;

  insert into public.referidos_recompensas (referidor_id, referido_id, monto)
  values (v_referidor, p_nuevo_usuario_id, v_monto);

  insert into public.ledger_movimientos (user_id, monto, causa, modo)
  values (v_referidor, v_monto, 'Recompensa por referido -- primer evento completado', 'demo');
end;
$$;
