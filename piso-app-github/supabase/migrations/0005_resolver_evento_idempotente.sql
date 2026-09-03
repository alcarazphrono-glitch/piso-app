-- Fix: resolver_evento() no revisaba si el evento ya estaba resuelto
-- antes de proceder (3-sep-2026).
-- =====================================================================
-- Encontrado en la revisión pedida por Dirección (memo "Retroalimentación
-- al checkpoint post-arquitectura", Falla 5, "qué pasa si se llama dos
-- veces"). Una segunda llamada NO duplicaba pagos -- el loop solo toma
-- posiciones en estado 'abierta', y la primera llamada ya las deja en
-- 'resuelta'. Pero SÍ podía sobreescribir eventos.resultado_oficial con
-- un valor distinto al de la primera llamada, sin que nada lo impidiera
-- -- dejando un evento marcado oficialmente con un resultado que no
-- corresponde a lo que de verdad se le pagó a nadie. Esta versión corta
-- eso de raíz: si el evento ya está 'resuelto', la función falla antes
-- de tocar nada.

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
  v_estado_actual text;
begin
  if not exists (select 1 from public.operadores o where o.user_id = v_uid) then
    raise exception 'No autorizado: se requiere rol de operador';
  end if;

  select estado into v_estado_actual from public.eventos where id = p_evento_id;
  if v_estado_actual is null then
    raise exception 'Evento no encontrado';
  end if;
  if v_estado_actual = 'resuelto' then
    raise exception 'Este evento ya fue resuelto -- no se puede resolver de nuevo';
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
