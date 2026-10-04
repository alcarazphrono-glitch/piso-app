-- =====================================================================
-- 0015 -- El premio usa las palancas de Finanzas (0014)
-- =====================================================================
-- Corre DESPUÉS de 0014 (economia_parametros, productos.cuota_evento).
--
-- calcular_premio_ciclo() sigue siendo el ÚNICO punto del premio en la
-- base, y ahora dice exactamente lo mismo que premioCiclo() en
-- src/lib/economia/modelo.ts:
--
--   tasa        = CETES - spread_reporto
--   rendimiento = N * boleto * (e^(tasa * días/365) - 1)
--   bruto       = rendimiento * (1 - alpha_em - alpha_c1)
--                 + N * (cuota / (1 + IVA)) * cuota_al_premio
--   premio      = round(bruto * (1 - carry del tramo)) + bote
--
-- Con los valores sembrados en 0014 (alpha_c1 0, cuota 0, spread 0) el
-- premio no cambia ni un peso.
--
-- comprar_boleto() cobra productos.cuota_evento solo si es > 0 (hoy es 0:
-- Beto no ha aprobado la cuota). La cuota no es capital: no regresa al
-- resolver el ciclo, pero sí regresa si el ciclo se cancela por no
-- llenarse.
-- =====================================================================

-- Lo que pagó cada boleto de cuota, para devolverla si el ciclo se cancela
-- y para que el premio use lo que de verdad se cobró.
alter table public.boletos
  add column if not exists cuota numeric not null default 0 check (cuota >= 0);

-- ---------------------------------------------------------------------
-- calcular_premio_ciclo
-- ---------------------------------------------------------------------
create or replace function public.calcular_premio_ciclo(p_ciclo_id uuid)
returns table (premio numeric, premio_bruto numeric, carry_pct numeric, motor text, premio_base numeric, bote numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo public.ciclos;
  v_producto public.productos;
  v_eco public.economia_parametros;
  v_tasa_cetes numeric;
  v_tasa numeric;
  v_alpha_em numeric;
  v_alpha_c1 numeric;
  v_cuota_al_premio numeric;
  v_iva numeric;
  v_dias numeric;
  v_rendimiento numeric;
  v_cuotas numeric;
  v_bruto numeric;
  v_carry numeric;
  v_neto numeric;
  v_bote numeric;
  v_supuestos boolean;
begin
  select * into v_ciclo from public.ciclos where id = p_ciclo_id;
  if v_ciclo.id is null then
    raise exception 'ciclo % no existe', p_ciclo_id;
  end if;

  select * into v_producto from public.productos where clave = v_ciclo.producto_clave;
  select tasa_cetes_anual into v_tasa_cetes from public.parametros_pricing limit 1;
  select * into v_eco from public.economia_parametros limit 1;

  -- ---- premio base ----
  -- Mismos supuestos que cargar.ts: sin dato en la base, CETES 10% y
  -- alpha_em 25%, y motor = 'pool_supuestos' (visible en /admin).
  v_supuestos := v_tasa_cetes is null or v_producto.alpha_em is null;
  v_tasa_cetes := coalesce(v_tasa_cetes, 10);
  v_alpha_em := coalesce(v_producto.alpha_em, 0.25);
  v_alpha_c1 := coalesce(v_eco.alpha_c1, 0);
  v_cuota_al_premio := coalesce(v_eco.cuota_al_premio, 0);
  v_iva := coalesce(v_eco.iva, 0.16);
  v_tasa := greatest(0, v_tasa_cetes / 100.0 - coalesce(v_eco.spread_reporto, 0));
  v_dias := extract(epoch from (v_ciclo.fecha_resolucion - v_ciclo.fecha_inicio)) / 86400.0;

  v_rendimiento := v_producto.gente_requerida * v_producto.precio
                   * (exp(v_tasa * (v_dias / 365.0)) - 1);

  -- Cuotas del ciclo: lo que ya pagaron los boletos vendidos más la cuota
  -- vigente por cada lugar libre. Con el ciclo lleno es exactamente lo que
  -- se cobró, así que si Finanzas cambia la cuota a medio ciclo el premio
  -- nunca promete dinero que no entró.
  select coalesce(sum(b.cuota), 0) into v_cuotas from public.boletos b where b.ciclo_id = p_ciclo_id;
  v_cuotas := v_cuotas + greatest(0, v_producto.gente_requerida - v_ciclo.lugares_ocupados) * v_producto.cuota_evento;

  v_bruto := v_rendimiento * greatest(0, 1 - v_alpha_em - v_alpha_c1)
             + (v_cuotas / (1 + v_iva)) * v_cuota_al_premio;

  select coalesce(t.carry_pct, 30) into v_carry
    from public.producto_carry_tramos t
    where t.producto_clave = v_producto.clave
      and (t.premio_hasta is null or v_bruto <= t.premio_hasta)
    order by t.orden asc
    limit 1;
  -- Sin tramo que aplique, 30% (igual que modelo.ts y payoff.ts).
  v_carry := coalesce(v_carry, 30);

  v_neto := round(v_bruto * (1 - v_carry / 100.0));

  if v_ciclo.bono_bienvenida_activado and v_neto < 20000 then
    v_neto := 20000;
  end if;
  -- ---- fin premio base ----

  if v_ciclo.estado in ('llenando','lleno') then
    select coalesce(b.monto, 0) into v_bote from public.botes b where b.producto_clave = v_producto.clave;
  end if;
  v_bote := coalesce(v_bote, 0);

  return query select
    v_neto + v_bote,
    round(v_bruto),
    v_carry,
    case when v_supuestos then 'pool_supuestos' else 'pool' end,
    v_neto,
    v_bote;
end;
$$;

-- ---------------------------------------------------------------------
-- comprar_boleto -- igual que 0010, más la cuota cuando es > 0.
-- ---------------------------------------------------------------------
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
  v_cuota numeric;
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
  v_cuota := greatest(0, coalesce(v_producto.cuota_evento, 0));

  select demo_balance into v_balance from public.balances where user_id = auth.uid() for update;
  if v_balance is null or v_balance < v_producto.precio + v_cuota then
    raise exception 'saldo insuficiente -- necesitas $% para este boleto', v_producto.precio + v_cuota;
  end if;

  insert into public.ledger_movimientos (user_id, monto, causa, modo)
  values (auth.uid(), -v_producto.precio, 'Depósito -- boleto ' || v_producto.nombre || ' (ciclo ' || p_ciclo_id || ')', 'demo');

  if v_cuota > 0 then
    insert into public.ledger_movimientos (user_id, monto, causa, modo)
    values (auth.uid(), -v_cuota, 'Cuota de participación -- boleto ' || v_producto.nombre || ' (ciclo ' || p_ciclo_id || ')', 'demo');
  end if;

  insert into public.boletos (ciclo_id, user_id, respuesta, monto, cuota)
  values (p_ciclo_id, auth.uid(), p_respuesta, v_producto.precio, v_cuota)
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
-- cancelar_ciclos_vencidos -- igual que 0009, y si el ciclo no se llenó
-- también regresa la cuota.
-- ---------------------------------------------------------------------
create or replace function public.cancelar_ciclos_vencidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo record;
  v_cancelados integer := 0;
begin
  for v_ciclo in
    select * from public.ciclos where estado = 'llenando' and now() > fecha_resolucion for update
  loop
    update public.ciclos set estado = 'cancelado', actualizado_en = now() where id = v_ciclo.id;

    insert into public.ledger_movimientos (user_id, monto, causa, modo)
    select b.user_id, b.monto, 'Devolución -- ciclo cancelado (no se llenó a tiempo)', 'demo'
    from public.boletos b
    where b.ciclo_id = v_ciclo.id;

    insert into public.ledger_movimientos (user_id, monto, causa, modo)
    select b.user_id, b.cuota, 'Devolución de cuota -- ciclo cancelado (no se llenó a tiempo)', 'demo'
    from public.boletos b
    where b.ciclo_id = v_ciclo.id and b.cuota > 0;

    v_cancelados := v_cancelados + 1;
  end loop;

  return v_cancelados;
end;
$$;
