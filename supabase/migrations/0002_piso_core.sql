-- PISO Core V1 — Event Manager + Resolution Engine + Ledger
-- =====================================================================
-- Correr esto en el SQL Editor de Supabase DESPUÉS de schema.sql.
-- Antes de correrlo: reemplaza 'TU_CORREO_AQUI@dominio.com' en la sección 6
-- por el correo con el que inicias sesión en PISO, para que te registres
-- como operador y puedas entrar a /admin.
--
-- Qué resuelve esta migración, en una frase: hoy el navegador del usuario
-- decide cuánto dinero tiene y si ganó un evento (ver posicion/page.tsx,
-- evento/[id]/page.tsx). Después de esto, esas decisiones las toma
-- Postgres, con autorización verificada explícitamente en cada función —
-- no porque "confiamos en el cliente", sino porque el cliente ya no puede.

-- ---------------------------------------------------------------------
-- 1. Operadores — quién puede administrar eventos
-- ---------------------------------------------------------------------
create table if not exists public.operadores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rol text not null default 'admin' check (rol in ('admin')),
  creado_en timestamptz not null default now()
);

alter table public.operadores enable row level security;

-- OJO: esta política NO debe consultar `operadores` dentro de su propia
-- condición (using (exists (select 1 from public.operadores ...))) -- eso
-- causa "infinite recursion detected in policy for relation operadores"
-- en Postgres, porque la subconsulta vuelve a evaluar la misma política.
-- Un usuario solo necesita ver SU PROPIA fila para que el layout de
-- /admin sepa si es operador -- no hace falta que vea la lista completa.
create policy "un usuario ve si el mismo es operador"
  on public.operadores for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 2. Eventos — se extiende, no se reemplaza (ya existe desde schema.sql)
-- ---------------------------------------------------------------------
alter table public.eventos
  add column if not exists categoria text not null default 'macro',
  add column if not exists descripcion text not null default '',
  add column if not exists pregunta text not null default '¿Sí o no?',
  add column if not exists opciones jsonb not null default '["si","no"]'::jsonb,
  -- V1 solo soporta eventos binarios (si/no) -- es lo único que Consumer
  -- sabe renderizar hoy. El campo queda en jsonb a propósito (regla de oro
  -- del brief: "cada evento es una entidad independiente") para no romper
  -- el esquema el día que se soporten opciones múltiples.
  add column if not exists imagen_url text,
  add column if not exists fuente_resolucion text not null default 'Por definir',
  add column if not exists estado text not null default 'borrador'
    check (estado in ('borrador','abierto','cerrado','resuelto')),
  add column if not exists fecha_apertura timestamptz,
  add column if not exists fecha_cierre timestamptz,
  add column if not exists fecha_resolucion timestamptz,
  add column if not exists explicacion_1 text not null default '',
  add column if not exists explicacion_2 text not null default '',
  add column if not exists fecha_texto text not null default '',
  add column if not exists fecha_contexto text not null default '',
  add column if not exists premio_override numeric,
  add column if not exists creado_por uuid references public.operadores(user_id),
  add column if not exists actualizado_en timestamptz not null default now();

-- Backfill de los dos eventos que ya existen y están activos, con el
-- contenido que hoy vive hardcodeado en src/types/index.ts -- para que en
-- cuanto Consumer se conecte a esta tabla, no pierda el copy que Behavioral
-- ya validó.
update public.eventos set
  categoria = 'macro',
  descripcion = 'Banxico decide si baja la tasa de interés del país.',
  pregunta = '¿Banxico baja la tasa?',
  fuente_resolucion = 'Banxico -- comunicado oficial de política monetaria',
  estado = 'abierto',
  fecha_apertura = now(),
  fecha_cierre = '2026-09-18 14:00:00-06',
  explicacion_1 = 'Banxico decide si baja la tasa de interés del país.',
  explicacion_2 = 'Si baja, pedir dinero prestado se vuelve más barato para todos.',
  fecha_texto = 'Se resuelve el 18 de septiembre',
  fecha_contexto = 'Decisión de política monetaria de Banxico',
  premio_override = 10919 -- Behavioral, Bloque 8, validado para d=$500. Ver
  -- RECONCILIACION_PENDIENTE en config.ts: sigue sin confirmar contra el
  -- $8,750 del memo original de DG -- este número puede cambiar.
where id = 'banxico_baja_tasas';

update public.eventos set
  categoria = 'macro',
  descripcion = 'El INPC mide qué tan rápido suben los precios en México.',
  pregunta = '¿La inflación de agosto cierra bajo 4%?',
  fuente_resolucion = 'INEGI -- publicación oficial del INPC',
  estado = 'abierto',
  fecha_apertura = now(),
  fecha_cierre = '2026-09-09 08:00:00-06',
  explicacion_1 = 'El INPC mide qué tan rápido suben los precios en México.',
  explicacion_2 = 'Si cierra bajo 4%, tu dinero pierde menos poder de compra.',
  fecha_texto = 'Se resuelve el 9 de septiembre',
  fecha_contexto = 'Publicación del INPC',
  premio_override = null -- sin validar todavía (RECONCILIACION_PENDIENTE.inpc)
  -- -- calcular_premio_potencial() cae a la fórmula placeholder mientras
  -- tanto, nunca a un número inventado a mano.
where id = 'inpc_bajo';

-- RLS de escritura: solo operadores pueden crear/editar/publicar eventos
-- desde el panel. La transición a estado='resuelto' NO pasa por aquí --
-- solo por resolver_evento() (sección 5), porque esa sí tiene consecuencia
-- financiera (liquida posiciones). Esta política es para lo administrativo
-- (contenido, fechas, categoría), no para la resolución.
create policy "operadores crean eventos"
  on public.eventos for insert
  with check (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores editan eventos"
  on public.eventos for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 3. Resoluciones — bitácora auditable (fuente + evidencia + quién + cuándo)
-- ---------------------------------------------------------------------
create table if not exists public.resoluciones (
  id uuid primary key default gen_random_uuid(),
  evento_id text not null references public.eventos(id),
  resultado text not null,
  fuente text not null,
  evidencia text,
  resuelto_por uuid not null references public.operadores(user_id),
  resuelto_en timestamptz not null default now()
);

alter table public.resoluciones enable row level security;

-- Lectura pública a propósito -- mismo espíritu que el Trust Center: la
-- bitácora de por qué se resolvió algo así no es información sensible, y
-- que sea visible es parte del sistema de confianza, no un riesgo.
create policy "resoluciones son de lectura pública"
  on public.resoluciones for select
  using (true);

-- Sin política de insert para el rol authenticated -- solo entra por
-- resolver_evento() (SECURITY DEFINER, sección 5), nunca por un insert
-- directo a la tabla así el llamante tenga sesión de operador.

-- ---------------------------------------------------------------------
-- 4. Ledger — doble entrada. Esta tabla es la única fuente de verdad del
-- dinero de un usuario; balances.demo_balance pasa a ser una caché que
-- SOLO actualiza el trigger de abajo, nunca un update directo.
-- ---------------------------------------------------------------------
create table if not exists public.ledger_movimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  monto numeric not null, -- positivo = a favor del usuario, negativo = en contra
  causa text not null,
  posicion_id uuid references public.posiciones(id),
  modo text not null default 'demo' check (modo in ('demo','real')),
  -- 'real' no se usa todavía -- se deja desde ahora para no rediseñar el
  -- esquema con datos ya cargados el día que exista dinero real (brief
  -- original, sección 3.3).
  creado_en timestamptz not null default now()
);

alter table public.ledger_movimientos enable row level security;

create policy "usuarios ven su propio ledger"
  on public.ledger_movimientos for select
  using (auth.uid() = user_id);

create policy "operadores ven todo el ledger"
  on public.ledger_movimientos for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- Sin política de insert para authenticated -- solo las funciones de la
-- sección 5 escriben aquí (SECURITY DEFINER). Un insert directo del
-- cliente, aunque tenga sesión válida, no tiene ninguna política que se lo
-- permita: RLS lo rechaza por default.

create or replace function public.aplicar_movimiento_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.modo = 'demo' then
    update public.balances
      set demo_balance = demo_balance + new.monto,
          actualizado_en = now()
      where user_id = new.user_id;
  end if;
  -- modo = 'real' no tiene columna de balance todavía -- se agrega cuando
  -- exista dinero real (ver nota en la definición de la tabla, arriba).
  return new;
end;
$$;

drop trigger if exists trg_aplicar_movimiento_ledger on public.ledger_movimientos;
create trigger trg_aplicar_movimiento_ledger
  after insert on public.ledger_movimientos
  for each row execute function public.aplicar_movimiento_ledger();

-- Retiramos la única forma que le quedaba al cliente de mover su propio
-- balance. De aquí en adelante, balances.demo_balance solo cambia por el
-- trigger de arriba.
drop policy if exists "usuarios actualizan su propio balance" on public.balances;

-- ---------------------------------------------------------------------
-- 5. Retirar la autoridad del cliente sobre posiciones.resultado/estado.
-- Se sustituye por confirmar_posicion(), simular_resultado_posicion_demo()
-- y resolver_evento() -- todas SECURITY DEFINER, todas verificando
-- explícitamente quién llama antes de escribir.
-- ---------------------------------------------------------------------
drop policy if exists "usuarios actualizan sus propias posiciones" on public.posiciones;
drop policy if exists "usuarios crean sus propias posiciones" on public.posiciones;
-- El insert también se retira: el premio potencial ya no lo calcula ni lo
-- manda el cliente (ver Migración 0003 de config.ts en el código) -- lo
-- calcula calcular_premio_potencial() del lado de Postgres, dentro de
-- confirmar_posicion().

-- ---------------------------------------------------------------------
-- 5a. calcular_premio_potencial -- lectura pura, sin efectos secundarios.
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
  v_ticket numeric;
  v_multiplicador numeric;
begin
  select premio_override, probabilidad into v_override, v_probabilidad
    from public.eventos where id = p_evento_id;

  if v_probabilidad is null then
    raise exception 'evento % no existe', p_evento_id;
  end if;

  if v_override is not null then
    return v_override;
  end if;

  select ticket_demo_mxn, multiplicador_demo into v_ticket, v_multiplicador
    from public.parametros_pricing limit 1;

  return round((v_ticket * v_multiplicador) / v_probabilidad);
end;
$$;

-- ---------------------------------------------------------------------
-- 5b. confirmar_posicion -- reemplaza el insert directo del cliente.
-- Autorización: requiere sesión (auth.uid() no nulo); el user_id de la
-- posición sale de auth.uid(), nunca de un parámetro que mande el cliente.
-- ---------------------------------------------------------------------
create or replace function public.confirmar_posicion(p_evento_id text, p_respuesta text)
returns public.posiciones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_evento text;
  v_premio numeric;
  v_posicion public.posiciones;
begin
  if auth.uid() is null then
    raise exception 'confirmar_posicion requiere sesión activa';
  end if;

  if p_respuesta not in ('si', 'no') then
    raise exception 'respuesta inválida: %', p_respuesta;
  end if;

  select estado into v_estado_evento from public.eventos where id = p_evento_id;
  if v_estado_evento is null then
    raise exception 'evento % no existe', p_evento_id;
  end if;
  if v_estado_evento <> 'abierto' then
    raise exception 'evento % no está abierto a nuevas posiciones (estado: %)', p_evento_id, v_estado_evento;
  end if;

  v_premio := public.calcular_premio_potencial(p_evento_id);

  insert into public.posiciones (user_id, evento_id, respuesta, premio_potencial, capital_en_riesgo, estado)
  values (auth.uid(), p_evento_id, p_respuesta, v_premio, 0, 'abierta')
  returning * into v_posicion;

  return v_posicion;
end;
$$;

-- ---------------------------------------------------------------------
-- 5c. simular_resultado_posicion_demo -- reemplaza el Math.random() del
-- cliente en posicion/page.tsx. Exclusivo de demo, igual que antes.
-- Autorización: la posición debe pertenecerle a quien llama. Idempotencia:
-- no se puede volver a resolver una posición que ya se resolvió.
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

  v_ocurrio := random() < v_probabilidad; -- server-side, no en el navegador
  v_acerto := (v_posicion.respuesta = 'si') = v_ocurrio;
  v_resultado := case when v_acerto then 'gano' else 'no_gano' end;

  update public.posiciones
    set estado = 'resuelta', resultado = v_resultado, resuelta_en = now()
    where id = p_posicion_id
    returning * into v_posicion;

  if v_resultado = 'gano' then
    insert into public.ledger_movimientos (user_id, monto, causa, posicion_id, modo)
    values (auth.uid(), v_posicion.premio_potencial, 'Premio de posición (demo)', p_posicion_id, 'demo');
  end if;

  return v_posicion;
end;
$$;

-- ---------------------------------------------------------------------
-- 5d. resolver_evento -- Resolution Engine real. Autorización: solo
-- operadores. Idempotencia: no se puede resolver un evento dos veces.
-- Cascada: liquida TODAS las posiciones abiertas de ese evento y escribe
-- el ledger de cada una -- resolver el evento sin esto sería un registro
-- de auditoría sin consecuencia, exactamente lo que se señaló como falla
-- en el checkpoint anterior.
-- ---------------------------------------------------------------------
create or replace function public.resolver_evento(
  p_evento_id text,
  p_resultado text,
  p_fuente text,
  p_evidencia text
)
returns integer -- número de posiciones liquidadas
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
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  if p_resultado not in ('si', 'no') then
    -- V1 solo soporta eventos binarios -- ver comentario en la columna
    -- eventos.opciones, arriba.
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
    end if;

    v_liquidadas := v_liquidadas + 1;
  end loop;

  return v_liquidadas;
end;
$$;

-- ---------------------------------------------------------------------
-- 5e. admin_resumen_usuarios -- User/Behavior Dashboard. auth.users no es
-- consultable desde el cliente (correcto -- ahí vive información de
-- autenticación), así que esta función, gateada por operadores, es la
-- única forma de que /admin/usuarios muestre el correo de alguien.
-- ---------------------------------------------------------------------
create or replace function public.admin_resumen_usuarios()
returns table (
  user_id uuid,
  email text,
  piso text,
  balance numeric,
  modo text,
  posiciones_totales bigint,
  wins bigint,
  losses bigint,
  creado_en timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  return query
  select
    u.id,
    u.email::text,
    p.piso,
    b.demo_balance,
    b.modo,
    count(pos.id) as posiciones_totales,
    count(pos.id) filter (where pos.resultado = 'gano') as wins,
    count(pos.id) filter (where pos.resultado = 'no_gano') as losses,
    u.created_at
  from auth.users u
  left join public.perfiles p on p.user_id = u.id
  left join public.balances b on b.user_id = u.id
  left join public.posiciones pos on pos.user_id = u.id
  group by u.id, u.email, p.piso, b.demo_balance, b.modo, u.created_at
  order by b.demo_balance desc nulls last;
end;
$$;

-- ---------------------------------------------------------------------
-- 5f. admin_analytics_resumen -- Analytics diario. D1/D7 retention: por
-- usuario, se toma su primera posición (t0) y se checa si abrió otra
-- entre t0+1 día y t0+2 días (D1) / entre t0+7 y t0+8 días (D7). Un
-- usuario cuyo t0 todavía no cumple esa ventana no cuenta ni a favor ni
-- en contra -- por eso el filtro `where p.t0 <= now() - interval`.
-- ---------------------------------------------------------------------
create or replace function public.admin_analytics_resumen()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuarios_totales integer;
  v_posiciones_totales integer;
  v_posiciones_hoy integer;
  v_repeat_rate numeric;
  v_d1 numeric;
  v_d7 numeric;
  v_por_evento json;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  select count(*) into v_usuarios_totales from public.perfiles;
  select count(*) into v_posiciones_totales from public.posiciones;
  select count(*) into v_posiciones_hoy from public.posiciones where creada_en >= date_trunc('day', now());

  select round(100.0 * count(*) filter (where n > 1) / nullif(count(*), 0), 1) into v_repeat_rate
  from (select user_id, count(*) as n from public.posiciones group by user_id) t;

  select round(100.0 * count(*) filter (where volvio) / nullif(count(*), 0), 1) into v_d1
  from (
    select p.user_id,
      exists (
        select 1 from public.posiciones pos2
        where pos2.user_id = p.user_id
          and pos2.creada_en >= p.t0 + interval '1 day'
          and pos2.creada_en < p.t0 + interval '2 days'
      ) as volvio
    from (select user_id, min(creada_en) as t0 from public.posiciones group by user_id) p
    where p.t0 <= now() - interval '1 day'
  ) d1;

  select round(100.0 * count(*) filter (where volvio) / nullif(count(*), 0), 1) into v_d7
  from (
    select p.user_id,
      exists (
        select 1 from public.posiciones pos2
        where pos2.user_id = p.user_id
          and pos2.creada_en >= p.t0 + interval '7 days'
          and pos2.creada_en < p.t0 + interval '8 days'
      ) as volvio
    from (select user_id, min(creada_en) as t0 from public.posiciones group by user_id) p
    where p.t0 <= now() - interval '7 days'
  ) d7;

  select json_agg(row_to_json(t)) into v_por_evento
  from (
    select e.id, e.nombre, count(pos.id) as participacion,
      count(pos.id) filter (where pos.resultado = 'gano') as ganadas
    from public.eventos e
    left join public.posiciones pos on pos.evento_id = e.id
    group by e.id, e.nombre
    order by count(pos.id) desc
  ) t;

  return json_build_object(
    'usuarios_totales', v_usuarios_totales,
    'posiciones_totales', v_posiciones_totales,
    'posiciones_hoy', v_posiciones_hoy,
    'repeat_rate', v_repeat_rate,
    'd1_retention', v_d1,
    'd7_retention', v_d7,
    'por_evento', coalesce(v_por_evento, '[]'::json)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Parámetros de pricing -- fila única, editable desde /admin/configuracion
-- ---------------------------------------------------------------------
create table if not exists public.parametros_pricing (
  id boolean primary key default true check (id),
  ticket_demo_mxn numeric not null default 500,
  multiplicador_demo numeric not null default 0.55,
  float_pct numeric, -- pendiente de Finanzas -- ver checkpoint del 3-sep
  carry_pct numeric, -- pendiente de Finanzas
  tasa_cetes_anual numeric, -- pendiente de Finanzas
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.operadores(user_id)
);

insert into public.parametros_pricing (id, ticket_demo_mxn, multiplicador_demo)
values (true, 500, 0.55)
on conflict (id) do nothing;

alter table public.parametros_pricing enable row level security;

create policy "parametros_pricing lectura pública"
  on public.parametros_pricing for select
  using (true); -- necesario para que calcular_premio_potencial() funcione
  -- para cualquier usuario, no solo operadores. No es información sensible.

create policy "operadores editan parametros_pricing"
  on public.parametros_pricing for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 7. Lectura para operadores -- Risk Dashboard y User Dashboard necesitan
-- ver filas de TODOS los usuarios, no solo las propias. Las políticas de
-- "usuarios ven lo suyo" siguen intactas -- en Postgres, varias políticas
-- permisivas de select en la misma tabla se combinan con OR, así que esto
-- solo agrega acceso, no quita el que ya existía.
-- ---------------------------------------------------------------------
create policy "operadores ven todos los balances"
  on public.balances for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores ven todas las posiciones"
  on public.posiciones for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores ven todos los perfiles"
  on public.perfiles for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 8. Regístrate como operador -- REEMPLAZA el correo antes de correr esto.
-- ---------------------------------------------------------------------
insert into public.operadores (user_id, rol)
select id, 'admin' from auth.users where email = 'TU_CORREO_AQUI@dominio.com'
on conflict do nothing;
