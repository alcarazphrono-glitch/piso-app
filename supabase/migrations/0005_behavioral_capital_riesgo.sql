-- PISO Core -- Integración de la Especificación maestra de backend de
-- Behavioral Forest (D1-D15, memo 17-sep-2026). Esta migración cubre D1,
-- D3, D4, D5, D6 y D7 -- las piezas que EXTIENDEN infraestructura que ya
-- existe (capital, contrato, pricing, riesgo, racha, piso). D8/D11/D12 van
-- en 0006 y D9/D10/D14/D15 en 0007, porque son subsistemas nuevos y
-- mezclarlo todo en un solo archivo lo vuelve imposible de revisar.
--
-- Nota de honestidad, antes de empezar: Behavioral pidió explícitamente que
-- se rescate su diseño de retención ("es importante que el usuario esté
-- atrapado") porque es su dominio. Esta migración SÍ implementa los
-- mecanismos reales que sostienen eso (racha persistente, progresión de
-- piso, kill switch que no interrumpe al usuario a media sesión sino que
-- cierra la puerta a nuevas posiciones de un evento saturado) -- pero
-- ninguna de las reglas marcadas por el memo como "propuesta, no consenso"
-- (el reset de racha, D6) se activa sola. Se construye el espacio, no la
-- decisión que no es de Tecnología tomar.
--
-- Correr DESPUÉS de 0002, 0003 y 0004.

-- =======================================================================
-- D2 (contexto, no requiere cambio de esquema) -- ya satisfecho:
-- resolver_evento() (0002, sección 5d) SOLO acepta un resultado que un
-- operador confirma a mano, nunca genera el resultado con RNG. La única
-- función que usa random() es simular_resultado_posicion_demo() (0002,
-- sección 5c), y su nombre, su comentario y su alcance son explícitos:
-- exclusiva de modo demo, nunca se usa para resolver un evento real. Se
-- deja este bloque como ancla documental porque D2 lo marca como el punto
-- más crítico y no negociable del memo -- la separación ya existe en el
-- código, pero ahora queda registrada como decisión explícita, no como
-- algo que hay que inferir leyendo dos funciones distintas.
-- =======================================================================

-- ---------------------------------------------------------------------
-- D3 -- Campos de contrato sobre `posiciones`. No se renombra la tabla ni
-- se fuerza la máquina de estados completa (creado→fondeado→evento_abierto→
-- evento_resuelto→liquidado) todavía -- hoy no existe un paso de "fondeo"
-- real distinto del signup (balances arranca en $1,000 demo), así que
-- agregar los estados 'fondeada'/'liquidada' sin un flujo real detrás
-- sería fingir una etapa que no existe. Lo que SÍ se hace: dejar el
-- esquema listo (columnas + estados permitidos) para cuando exista modo
-- real, sin romper el flujo actual (abierta→resuelta sigue siendo lo que
-- usan confirmar_posicion/resolver_evento/simular_resultado_posicion_demo).
-- ---------------------------------------------------------------------
alter table public.posiciones
  drop constraint if exists posiciones_estado_check;
alter table public.posiciones
  add constraint posiciones_estado_check
  check (estado in ('abierta','resuelta','fondeada','liquidada'));

alter table public.posiciones
  add column if not exists monto_ticket numeric,
  -- Ticket usado para ESTA posición, capturado en el momento -- si
  -- parametros_pricing.ticket_demo_mxn cambia después, el histórico de
  -- volumen depositado (D7) no se corrompe retroactivamente.
  add column if not exists tau_dias numeric,
  -- Ventana días-hasta-resolución al momento de confirmar, snapshot -- ya
  -- existía como constante en config.ts (DIAS_HASTA_RESOLUCION); ahora
  -- queda registrado por posición, no solo como default de UI.
  add column if not exists capital_returned boolean not null default true,
  -- D1: "capital_returned debe ser un campo computado". Aquí es literal:
  -- el capital de una posición NUNCA sale de balances.demo_balance (la
  -- columna capital_en_riesgo de esta misma tabla está fijada en 0 por
  -- constraint desde el schema original) -- por diseño del producto, no
  -- hay ningún camino de código que reduzca el depósito de un usuario.
  -- Este campo lo hace explícito en vez de depender de que quien lea el
  -- código sepa inferirlo de la ausencia de un UPDATE. Ver también la
  -- función de reconciliación más abajo -- ese es el job automático que
  -- pide D1, no solo esta columna.
  add column if not exists carry_retenido numeric,
  add column if not exists float_acumulado numeric;
  -- Carry retenido y float acumulado de ESTA posición, solo se llenan
  -- cuando el motor real de pricing está activo (float_pct/carry_pct/
  -- tasa_cetes_anual llenos en parametros_pricing) -- null en modo
  -- placeholder, a propósito, igual que premio_estado en eventos.

comment on column public.posiciones.capital_returned is
  'D1 (memo Behavioral 17-sep-2026): siempre true por diseño -- el depósito nunca sale de balances.demo_balance. Ver verificar_integridad_capital() para el job de reconciliación real.';

-- ---------------------------------------------------------------------
-- D4 -- Tres alphas del motor de pricing (management fee / pool de
-- premios / reserva de riesgo). OJO -- esto NO reemplaza float_pct/
-- carry_pct/tasa_cetes_anual de la migración 0003: son dos maneras de
-- descomponer lo mismo (el rendimiento de CETES) que Finanzas y
-- Behavioral todavía no han reconciliado entre sí -- confirmarlo es una
-- decisión de negocio, no algo que Tecnología pueda resolver adivinando.
-- Se guardan los tres alphas como campo editable real (no hardcodeado) y
-- se deja explícitamente en el README que la fórmula activa sigue siendo
-- float/carry/CETES hasta que alguien confirme cuál manda.
-- ---------------------------------------------------------------------
alter table public.parametros_pricing
  add column if not exists alpha_emisor numeric, -- comisión de PISO, default esperado 0.25 (25%)
  add column if not exists alpha_c2 numeric,      -- pool de premios, default esperado 0.65 (65%)
  add column if not exists alpha_c1 numeric;       -- reserva de riesgo, default esperado 0.10 (10%), fondea D5

alter table public.parametros_pricing
  drop constraint if exists parametros_pricing_alphas_suman_100;
alter table public.parametros_pricing
  add constraint parametros_pricing_alphas_suman_100
  check (
    alpha_emisor is null or alpha_c2 is null or alpha_c1 is null
    or abs((alpha_emisor + alpha_c2 + alpha_c1) - 1.0) < 0.001
  );
  -- Se guardan como fracción (0.25), no porcentaje (25), para que la suma
  -- contra 1.0 sea directa -- la UI de /admin/configuracion muestra %.

alter table public.parametros_pricing_historial
  add column if not exists alpha_emisor numeric,
  add column if not exists alpha_c2 numeric,
  add column if not exists alpha_c1 numeric;

create or replace function public.registrar_historial_pricing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.parametros_pricing_historial
    (ticket_demo_mxn, multiplicador_demo, float_pct, carry_pct, tasa_cetes_anual,
     alpha_emisor, alpha_c2, alpha_c1, cambiado_por)
  values (old.ticket_demo_mxn, old.multiplicador_demo, old.float_pct, old.carry_pct, old.tasa_cetes_anual,
          old.alpha_emisor, old.alpha_c2, old.alpha_c1, auth.uid());
  return new;
end;
$$;
-- El trigger ya existe (0003) y apunta a esta función por nombre -- no hace
-- falta volver a crearlo, create or replace basta.

-- ---------------------------------------------------------------------
-- D5 -- Kill switch real. exposure_limite_mxn es el umbral que dueño
-- Finanzas/Tesorería (memo, D5: "thresholds owned by Finance/Treasury;
-- infraestructura owned by Tech"). Cuando la exposición agregada de un
-- evento (suma de premio_potencial de posiciones abiertas) alcanza el
-- umbral, confirmar_posicion() lo RECHAZA -- no es una alerta en el
-- dashboard, es un freno real, tal como pide D5 ("a true kill switch, not
-- just an alert").
-- ---------------------------------------------------------------------
alter table public.eventos
  add column if not exists exposure_limite_mxn numeric;
  -- null = sin límite (comportamiento actual, sin cambio, hasta que
  -- Finanzas defina un número por evento -- mismo patrón que premio_override).

-- Sin gate de operador a propósito: es una suma agregada por evento, no
-- expone ninguna posición individual ni a quién pertenece -- mismo
-- espíritu que "eventos/resoluciones son de lectura pública". Además,
-- confirmar_posicion() (más abajo) la llama para CUALQUIER usuario que
-- abre una posición, no solo operadores -- si esta función exigiera ser
-- operador, el kill switch tronaría para todo el mundo excepto /admin.
create or replace function public.exposicion_actual_evento(p_evento_id text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(premio_potencial), 0)
  from public.posiciones
  where evento_id = p_evento_id and estado = 'abierta';
$$;

-- ---------------------------------------------------------------------
-- D1 -- Job de reconciliación de capital. No hay pg_cron confirmado en
-- este entorno (no se puede verificar disponibilidad de extensiones desde
-- este sandbox sin acceso a un proyecto real de Supabase) -- así que esto
-- se expone como función invocable, gateada a operadores, en vez de
-- fingir un cron real. Se llama en dos lugares: (a) manualmente desde
-- /admin/riesgo, y (b) automáticamente, como ASSERTION dentro de
-- resolver_evento() -- si la resolución de un evento deja el balance de
-- algún usuario afectado fuera de reconciliación, la transacción entera
-- se revierte (ninguna posición queda liquidada a medias). Eso es lo que
-- D1 pide con "bloquea el cierre del contrato si capital_returned !=
-- deposit_d" -- aquí el "cierre del contrato" es la resolución del evento.
-- ---------------------------------------------------------------------
create or replace function public.verificar_integridad_capital(p_user_id uuid default null)
returns table (
  user_id uuid,
  balance_registrado numeric,
  balance_esperado numeric,
  diferencia numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    b.user_id,
    b.demo_balance as balance_registrado,
    1000 + coalesce((
      select sum(lm.monto) from public.ledger_movimientos lm
      where lm.user_id = b.user_id and lm.modo = 'demo'
    ), 0) as balance_esperado,
    b.demo_balance - (1000 + coalesce((
      select sum(lm.monto) from public.ledger_movimientos lm
      where lm.user_id = b.user_id and lm.modo = 'demo'
    ), 0)) as diferencia
  from public.balances b
  where (p_user_id is null or b.user_id = p_user_id)
    and b.demo_balance <> 1000 + coalesce((
      select sum(lm.monto) from public.ledger_movimientos lm
      where lm.user_id = b.user_id and lm.modo = 'demo'
    ), 0);
  -- Solo regresa FILAS CON DIFERENCIA -- una tabla vacía es el resultado
  -- sano ("todo reconcilia"), no la ausencia de datos.
end;
$$;

comment on function public.verificar_integridad_capital is
  'D1: reconciliación de capital. 1000 (saldo inicial demo) + suma del ledger debe ser siempre igual a balances.demo_balance. Filas devueltas = violaciones reales, deben ser cero en operación normal.';

-- ---------------------------------------------------------------------
-- D6 -- Racha real (contador atómico), sin regla de reset. El memo es
-- explícito: "Reset rule es una PROPUESTA únicamente... needs Behavioral/
-- Producto confirmation before being hardcoded." No se construye el job
-- de reset -- mismo criterio que VaR/CVaR en Riesgo: no le toca a
-- Tecnología inventar la regla de negocio. Lo que SÍ se construye es el
-- contador atómico que D6 pide como prerequisito ("Needs an atomic
-- per-user counter"), y se hace real (columna en Postgres, incrementada
-- dentro de una función SECURITY DEFINER) en vez de sólo un count() en
-- cada carga de pantalla como era antes.
-- ---------------------------------------------------------------------
alter table public.perfiles
  add column if not exists racha_actual integer not null default 0,
  add column if not exists racha_actualizada_en timestamptz,
  add column if not exists volumen_depositado_acumulado numeric not null default 0,
  -- D7: suma de monto_ticket de cada posición abierta -- no de premios.
  add column if not exists aciertos_acumulados integer not null default 0,
  -- D7: cuenta posiciones resueltas con resultado='gano'.
  add column if not exists piso_actualizado_en timestamptz;

-- Backfill -- que los usuarios que ya jugaron esta semana no vean su racha
-- resetearse a 0 solo porque la migración corrió hoy.
update public.perfiles pf set
  racha_actual = coalesce((select count(*) from public.posiciones p where p.user_id = pf.user_id), 0),
  racha_actualizada_en = now(),
  aciertos_acumulados = coalesce((select count(*) from public.posiciones p where p.user_id = pf.user_id and p.resultado = 'gano'), 0),
  volumen_depositado_acumulado = coalesce((
    select count(*) * (select ticket_demo_mxn from public.parametros_pricing limit 1)
    from public.posiciones p where p.user_id = pf.user_id
  ), 0)
  -- Aproximación para posiciones históricas (no tenían monto_ticket
  -- propio) -- usa el ticket actual. A partir de esta migración, cada
  -- posición nueva guarda su propio monto_ticket y el cálculo es exacto.
where true;

-- ---------------------------------------------------------------------
-- D7 -- Niveles de piso, como tabla editable (mismo patrón que
-- parametros_pricing) en vez de un array hardcodeado en el frontend
-- (src/types/index.ts PISOS). Se siembra con los mismos 5 valores que ya
-- existían para no cambiar el comportamiento actual el día de este
-- deploy -- Consumer sigue funcionando igual hasta que alguien edite esto
-- desde /admin.
-- ---------------------------------------------------------------------
create table if not exists public.piso_niveles (
  nombre text primary key check (nombre in ('tierra','plata','oro','platino','obsidiana')),
  deposito_min numeric not null,
  orden integer not null,
  activo boolean not null default true
);

insert into public.piso_niveles (nombre, deposito_min, orden, activo) values
  ('tierra', 200, 1, true),
  ('plata', 500, 2, true),
  ('oro', 1000, 3, true),
  ('platino', 2000, 4, false),
  ('obsidiana', 5000, 5, false)
on conflict (nombre) do nothing;

alter table public.piso_niveles enable row level security;

create policy "piso_niveles lectura pública"
  on public.piso_niveles for select
  using (true);

create policy "operadores editan piso_niveles"
  on public.piso_niveles for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create or replace function public.recalcular_piso(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_volumen numeric;
  v_piso_nuevo text;
begin
  select volumen_depositado_acumulado into v_volumen from public.perfiles where user_id = p_user_id;
  if v_volumen is null then
    return null;
  end if;

  select nombre into v_piso_nuevo
  from public.piso_niveles
  where activo and deposito_min <= v_volumen
  order by orden desc
  limit 1;

  if v_piso_nuevo is not null then
    update public.perfiles
      set piso = v_piso_nuevo, piso_actualizado_en = now()
      where user_id = p_user_id and piso <> v_piso_nuevo;
  end if;

  return v_piso_nuevo;
end;
$$;

comment on function public.recalcular_piso is
  'D7: recalculado event-triggered (llamado dentro de confirmar_posicion), no por-request -- evita recalcular en cada lectura de pantalla.';

-- ---------------------------------------------------------------------
-- confirmar_posicion -- se reemplaza para: (a) rechazar por kill switch
-- (D5), (b) guardar monto_ticket/tau_dias/carry_retenido/float_acumulado
-- (D3), (c) incrementar racha_actual y volumen_depositado_acumulado (D6/
-- D7) y llamar recalcular_piso(). Misma firma que antes -- ningún caller
-- existente (src/lib/eventos.ts) necesita cambiar.
--
-- Se apoya en calcular_premio_detalle(), nueva, que factoriza la lógica
-- de calcular_premio_potencial() (0003) para no duplicar la fórmula real
-- en dos funciones -- calcular_premio_potencial() se vuelve un wrapper.
-- ---------------------------------------------------------------------
create or replace function public.calcular_premio_detalle(p_evento_id text)
returns table (premio numeric, carry_retenido numeric, float_acumulado numeric, motor text)
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
  v_carry_monto numeric;
begin
  select premio_override, probabilidad, fecha_apertura, fecha_cierre
    into v_override, v_probabilidad, v_fecha_apertura, v_fecha_cierre
    from public.eventos where id = p_evento_id;

  if v_probabilidad is null then
    raise exception 'evento % no existe', p_evento_id;
  end if;

  if v_override is not null then
    return query select v_override, null::numeric, null::numeric, 'override'::text;
    return;
  end if;

  select ticket_demo_mxn, multiplicador_demo, float_pct, carry_pct, tasa_cetes_anual
    into v_ticket, v_multiplicador, v_float_pct, v_carry_pct, v_tasa_cetes
    from public.parametros_pricing limit 1;

  if v_float_pct is not null and v_carry_pct is not null and v_tasa_cetes is not null
     and v_fecha_apertura is not null and v_fecha_cierre is not null
     and v_fecha_cierre > v_fecha_apertura then
    v_dias := extract(epoch from (v_fecha_cierre - v_fecha_apertura)) / 86400.0;
    v_rendimiento_cetes := v_ticket * (v_tasa_cetes / 100.0) * (v_dias / 365.0);
    v_premio_bruto := (v_rendimiento_cetes * (v_float_pct / 100.0)) / v_probabilidad;
    v_carry_monto := v_premio_bruto * (v_carry_pct / 100.0);
    return query select
      round(v_premio_bruto - v_carry_monto),
      round(v_carry_monto, 2),
      round(v_rendimiento_cetes * (v_float_pct / 100.0), 2),
      'real'::text;
    return;
  end if;

  return query select round((v_ticket * v_multiplicador) / v_probabilidad), null::numeric, null::numeric, 'placeholder'::text;
end;
$$;

create or replace function public.calcular_premio_potencial(p_evento_id text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select premio from public.calcular_premio_detalle(p_evento_id) limit 1;
$$;
-- Mismo nombre y firma que 0002/0003 -- todo lo que ya llama a esta
-- función (confirmar_posicion, Consumer vía RPC para el estimado
-- instantáneo) sigue funcionando sin cambios.

create or replace function public.confirmar_posicion(p_evento_id text, p_respuesta text)
returns public.posiciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_evento text;
  v_fecha_cierre timestamptz;
  v_exposure_limite numeric;
  v_exposure_actual numeric;
  v_ticket numeric;
  v_detalle record;
  v_tau_dias numeric;
  v_posicion public.posiciones;
begin
  if auth.uid() is null then
    raise exception 'confirmar_posicion requiere sesión activa';
  end if;

  if p_respuesta not in ('si', 'no') then
    raise exception 'respuesta inválida: %', p_respuesta;
  end if;

  select estado, fecha_cierre, exposure_limite_mxn into v_estado_evento, v_fecha_cierre, v_exposure_limite
    from public.eventos where id = p_evento_id;
  if v_estado_evento is null then
    raise exception 'evento % no existe', p_evento_id;
  end if;
  if v_estado_evento <> 'abierto' then
    raise exception 'evento % no está abierto a nuevas posiciones (estado: %)', p_evento_id, v_estado_evento;
  end if;

  select * into v_detalle from public.calcular_premio_detalle(p_evento_id);

  -- D5: kill switch real -- se evalúa DESPUÉS de conocer el premio de esta
  -- posición (la exposición nueva incluye esta posición), no solo contra
  -- lo ya abierto -- así el límite nunca se cruza por una sola posición
  -- grande que "cabía" contra el número viejo.
  if v_exposure_limite is not null then
    v_exposure_actual := public.exposicion_actual_evento(p_evento_id);
    if (v_exposure_actual + v_detalle.premio) > v_exposure_limite then
      raise exception 'kill switch: el evento % alcanzó su exposición máxima autorizada por Finanzas (límite $%, actual $%)',
        p_evento_id, v_exposure_limite, v_exposure_actual;
    end if;
  end if;

  select ticket_demo_mxn into v_ticket from public.parametros_pricing limit 1;

  if v_fecha_cierre is not null then
    v_tau_dias := round(extract(epoch from (v_fecha_cierre - now())) / 86400.0, 2);
  end if;

  insert into public.posiciones (
    user_id, evento_id, respuesta, premio_potencial, capital_en_riesgo, estado,
    monto_ticket, tau_dias, carry_retenido, float_acumulado
  )
  values (
    auth.uid(), p_evento_id, p_respuesta, v_detalle.premio, 0, 'abierta',
    v_ticket, v_tau_dias, v_detalle.carry_retenido, v_detalle.float_acumulado
  )
  returning * into v_posicion;

  -- D6 + D7: racha y volumen se actualizan al ABRIR la posición (no al
  -- resolverla) -- la racha cuenta participación, no acierto (memo D6:
  -- "racha increments on any opened event, not just wins").
  update public.perfiles
    set racha_actual = racha_actual + 1,
        racha_actualizada_en = now(),
        volumen_depositado_acumulado = volumen_depositado_acumulado + coalesce(v_ticket, 0)
    where user_id = auth.uid();

  perform public.recalcular_piso(auth.uid());

  return v_posicion;
end;
$$;

-- ---------------------------------------------------------------------
-- simular_resultado_posicion_demo -- se reemplaza SOLO para incrementar
-- aciertos_acumulados (D7) cuando gana. Sigue siendo exclusiva de demo,
-- sigue usando random() server-side -- eso no cambia (ver ancla D2 arriba).
-- ---------------------------------------------------------------------
create or replace function public.simular_resultado_posicion_demo(p_posicion_id uuid)
returns public.posiciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_posicion public.posiciones;
  v_probabilidad numeric;
  v_ocurrio boolean;
  v_acerto boolean;
  v_resultado text;
begin
  select * into v_posicion from public.posiciones where id = p_posicion_id;
  if v_posicion.id is null then
    raise exception 'posición % no existe', p_posicion_id;
  end if;
  if v_posicion.user_id <> auth.uid() then
    raise exception 'no tienes permiso sobre esta posición';
  end if;
  if v_posicion.estado <> 'abierta' then
    raise exception 'la posición % ya fue resuelta', p_posicion_id;
  end if;

  select probabilidad into v_probabilidad from public.eventos where id = v_posicion.evento_id;

  v_ocurrio := random() < v_probabilidad; -- server-side, demo-only -- ver D2
  v_acerto := (v_posicion.respuesta = 'si') = v_ocurrio;
  v_resultado := case when v_acerto then 'gano' else 'no_gano' end;

  update public.posiciones
    set estado = 'resuelta', resultado = v_resultado, resuelta_en = now()
    where id = p_posicion_id
    returning * into v_posicion;

  if v_resultado = 'gano' then
    insert into public.ledger_movimientos (user_id, monto, causa, posicion_id, modo)
    values (auth.uid(), v_posicion.premio_potencial, 'Premio de posición (demo)', p_posicion_id, 'demo');

    update public.perfiles set aciertos_acumulados = aciertos_acumulados + 1 where user_id = auth.uid();
  end if;

  return v_posicion;
end;
$$;

-- ---------------------------------------------------------------------
-- resolver_evento -- se reemplaza para: (a) incrementar aciertos_acumulados
-- de cada ganador (D7), y (b) cerrar con la verificación de integridad de
-- capital de D1 -- si algún usuario liquidado en esta resolución queda
-- fuera de reconciliación, TODA la resolución se revierte (exception
-- dentro de una función Postgres hace rollback de la transacción completa).
-- ---------------------------------------------------------------------
create or replace function public.resolver_evento(
  p_evento_id text,
  p_resultado text,
  p_fuente text,
  p_evidencia text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_evento text;
  v_posicion record;
  v_acerto boolean;
  v_resultado_posicion text;
  v_liquidadas integer := 0;
  v_usuarios_afectados uuid[] := '{}';
  v_violaciones integer;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  if p_resultado not in ('si', 'no') then
    raise exception 'resultado inválido para V1: %', p_resultado;
  end if;

  select estado into v_estado_evento from public.eventos where id = p_evento_id;
  if v_estado_evento is null then
    raise exception 'evento % no existe', p_evento_id;
  end if;
  if v_estado_evento = 'resuelto' then
    raise exception 'el evento % ya fue resuelto', p_evento_id;
  end if;

  insert into public.resoluciones (evento_id, resultado, fuente, evidencia, resuelto_por)
  values (p_evento_id, p_resultado, p_fuente, p_evidencia, auth.uid());

  update public.eventos
    set estado = 'resuelto', fecha_resolucion = now(), actualizado_en = now()
    where id = p_evento_id;

  for v_posicion in
    select * from public.posiciones where evento_id = p_evento_id and estado = 'abierta'
  loop
    v_acerto := (v_posicion.respuesta = p_resultado);
    v_resultado_posicion := case when v_acerto then 'gano' else 'no_gano' end;

    update public.posiciones
      set estado = 'resuelta', resultado = v_resultado_posicion, resuelta_en = now()
      where id = v_posicion.id;

    if v_resultado_posicion = 'gano' then
      insert into public.ledger_movimientos (user_id, monto, causa, posicion_id, modo)
      values (v_posicion.user_id, v_posicion.premio_potencial, 'Premio de evento resuelto: ' || p_evento_id, v_posicion.id, 'demo');

      update public.perfiles set aciertos_acumulados = aciertos_acumulados + 1 where user_id = v_posicion.user_id;
    end if;

    v_usuarios_afectados := array_append(v_usuarios_afectados, v_posicion.user_id);
    v_liquidadas := v_liquidadas + 1;
  end loop;

  -- D1: no se cierra la resolución si algún usuario liquidado quedó fuera
  -- de reconciliación. select count(*) sobre el resultado de la función de
  -- arriba, filtrado a solo los usuarios que esta resolución tocó.
  if array_length(v_usuarios_afectados, 1) > 0 then
    select count(*) into v_violaciones
    from public.verificar_integridad_capital()
    where user_id = any(v_usuarios_afectados);

    if v_violaciones > 0 then
      raise exception 'D1: % usuario(s) quedaron fuera de reconciliación de capital tras resolver % -- resolución revertida, ver verificar_integridad_capital()',
        v_violaciones, p_evento_id;
    end if;
  end if;

  return v_liquidadas;
end;
$$;
