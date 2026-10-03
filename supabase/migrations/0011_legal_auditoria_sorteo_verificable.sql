-- =======================================================================
-- 0011 -- Infraestructura que pidió Legal (reporte-legal-01, sección 6,
-- piezas 2-5): "baratas ahora, caras cuando ya hay datos".
--
--   1. Ledger inmutable: nadie (ni un operador ni el service_role desde
--      el SQL Editor por accidente) puede hacer UPDATE/DELETE de un
--      movimiento. Una corrección es un movimiento contrario. Y borrar un
--      usuario ya NO borra en cascada su historia financiera.
--   2. Bitácora de auditoría append-only de toda acción sobre las tablas
--      que se editan desde /admin.
--   3. Consentimientos: qué versión de términos / aviso de privacidad /
--      bases del sorteo aceptó cada usuario, cuándo y desde qué IP.
--   4. Sorteo verificable (commit-reveal): reemplaza el `order by random()`
--      de resolver_ciclo(). Al llenarse un ciclo se publica el hash de una
--      semilla secreta y la lista de participantes; al resolver se publica
--      la semilla, y cualquiera puede recalcular el ganador con
--      verificar_sorteo().
--
-- Correr después de 0010. Solo usa funciones nativas de Postgres
-- (sha256, gen_random_uuid) -- no depende de en qué schema viva pgcrypto
-- en Supabase.
-- =======================================================================


-- =======================================================================
-- 1. Ledger inmutable
-- =======================================================================
create or replace function public.rechazar_cambio_ledger()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger_movimientos es inmutable: no se permite % -- registra un movimiento contrario', tg_op;
end;
$$;

drop trigger if exists trg_ledger_inmutable on public.ledger_movimientos;
create trigger trg_ledger_inmutable
  before update or delete on public.ledger_movimientos
  for each row execute function public.rechazar_cambio_ledger();

-- TRUNCATE no dispara triggers de fila -- se bloquea aparte.
drop trigger if exists trg_ledger_sin_truncate on public.ledger_movimientos;
create trigger trg_ledger_sin_truncate
  before truncate on public.ledger_movimientos
  for each statement execute function public.rechazar_cambio_ledger();

-- Sin cascada: borrar un usuario de auth.users ahora falla si tiene
-- movimientos o boletos. La baja de un usuario se hace anonimizando sus
-- datos personales, no borrando su historia (Legal pide conservar 5 años).
alter table public.ledger_movimientos drop constraint if exists ledger_movimientos_user_id_fkey;
alter table public.ledger_movimientos
  add constraint ledger_movimientos_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;

alter table public.boletos drop constraint if exists boletos_user_id_fkey;
alter table public.boletos
  add constraint boletos_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;


-- =======================================================================
-- 2. Bitácora de auditoría (append-only)
-- =======================================================================
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  actor uuid,                    -- auth.uid() de quien hizo el cambio; null = SQL directo / sistema
  tabla text not null,
  operacion text not null check (operacion in ('INSERT','UPDATE','DELETE')),
  registro_id text,
  antes jsonb,
  despues jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists auditoria_tabla_creado_idx on public.auditoria (tabla, creado_en desc);

alter table public.auditoria enable row level security;

drop policy if exists "operadores leen auditoria" on public.auditoria;
create policy "operadores leen auditoria"
  on public.auditoria for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));
-- Sin políticas de insert/update/delete: solo escribe el trigger de abajo
-- (SECURITY DEFINER).

drop trigger if exists trg_auditoria_inmutable on public.auditoria;
create trigger trg_auditoria_inmutable
  before update or delete on public.auditoria
  for each row execute function public.rechazar_cambio_ledger();

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_despues jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_id text := coalesce(v_despues, v_antes) ->> coalesce(tg_argv[0], 'id');
begin
  insert into public.auditoria (actor, tabla, operacion, registro_id, antes, despues)
  values (auth.uid(), tg_table_name, tg_op, v_id, v_antes, v_despues);
  return coalesce(new, old);
end;
$$;

-- Tablas que se editan desde /admin. Ciclos/boletos/ledger no van aquí:
-- cambian con cada compra (50,000 usuarios) y ya tienen su propio rastro
-- (ledger inmutable + ciclo_resoluciones + sorteos).
do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('eventos', 'id'),
      ('productos', 'clave'),
      ('producto_carry_tramos', 'id'),
      ('parametros_pricing', 'id'),
      ('operadores', 'user_id'),
      ('contenido_versionado', 'id'),
      ('reserva_config', 'id'),
      ('referidos_config', 'id'),
      ('tratamientos', 'id'),
      ('piso_niveles', 'nombre')
    ) as t(tabla, pk)
  loop
    if to_regclass('public.' || v.tabla) is not null then
      execute format('drop trigger if exists trg_auditoria on public.%I', v.tabla);
      execute format(
        'create trigger trg_auditoria after insert or update or delete on public.%I
           for each row execute function public.registrar_auditoria(%L)',
        v.tabla, v.pk);
    end if;
  end loop;
end $$;


-- =======================================================================
-- 3. Consentimientos
-- =======================================================================
create table if not exists public.consentimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  documento text not null check (documento in ('terminos','aviso_privacidad','bases_sorteo')),
  version text not null,
  ip text,
  user_agent text,
  aceptado_en timestamptz not null default now(),
  unique (user_id, documento, version)
);

alter table public.consentimientos enable row level security;

drop policy if exists "usuarios ven sus consentimientos" on public.consentimientos;
create policy "usuarios ven sus consentimientos"
  on public.consentimientos for select
  using (auth.uid() = user_id);

drop policy if exists "operadores ven consentimientos" on public.consentimientos;
create policy "operadores ven consentimientos"
  on public.consentimientos for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

drop trigger if exists trg_consentimientos_inmutable on public.consentimientos;
create trigger trg_consentimientos_inmutable
  before update or delete on public.consentimientos
  for each row execute function public.rechazar_cambio_ledger();

-- La IP y el user agent salen de los headers que PostgREST pone en la
-- sesión -- el cliente no los puede falsear mandándolos como parámetro.
create or replace function public.registrar_consentimiento(p_documento text, p_version text)
returns public.consentimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_fila public.consentimientos;
begin
  if auth.uid() is null then
    raise exception 'registrar_consentimiento requiere sesión activa';
  end if;

  insert into public.consentimientos (user_id, documento, version, ip, user_agent)
  values (
    auth.uid(),
    p_documento,
    p_version,
    split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', ''), ',', 1),
    v_headers ->> 'user-agent'
  )
  on conflict (user_id, documento, version) do nothing
  returning * into v_fila;

  if v_fila.id is null then
    select * into v_fila from public.consentimientos
      where user_id = auth.uid() and documento = p_documento and version = p_version;
  end if;
  return v_fila;
end;
$$;


-- =======================================================================
-- 4. Sorteo verificable (commit-reveal)
--
-- Cómo verifica un tercero que el sorteo fue justo:
--   a) Antes del resultado real, `sorteos` ya muestra semilla_hash y la
--      lista de participantes (boletos ordenados por id). La semilla
--      queda guardada en `sorteo_semillas`, que nadie puede leer.
--   b) Al resolver, se publica la semilla. Cualquiera comprueba
--      sha256(semilla) = semilla_hash, filtra los participantes que
--      acertaron (en el mismo orden) y calcula:
--        h = sha256(semilla || ':' || ciclo_id)
--        indice = (primeros 15 dígitos hex de h, como entero) mod (# acertantes)
--      El ganador es acertantes[indice] (base 0). verificar_sorteo() hace
--      exactamente eso.
-- Como la semilla se fija ANTES de que se conozca el resultado y antes de
-- saber quién acertó, ni PISO ni un operador pueden elegir al ganador.
-- =======================================================================
create table if not exists public.sorteos (
  ciclo_id uuid primary key references public.ciclos(id),
  semilla_hash text not null,
  participantes uuid[] not null,          -- boleto ids, orden ascendente
  comprometido_en timestamptz not null default now(),
  semilla text,                           -- null hasta que se revela
  revelado_en timestamptz,
  acertantes uuid[],                      -- subconjunto de participantes, mismo orden
  ganador_boleto_id uuid references public.boletos(id),
  compromiso_tardio boolean not null default false -- true si el compromiso se hizo al resolver (ciclos llenos antes de 0011)
);

alter table public.sorteos enable row level security;

drop policy if exists "sorteos lectura pública" on public.sorteos;
create policy "sorteos lectura pública"
  on public.sorteos for select
  using (true);

create table if not exists public.sorteo_semillas (
  ciclo_id uuid primary key references public.ciclos(id),
  semilla text not null
);

alter table public.sorteo_semillas enable row level security;
-- Sin ninguna política: ni anon, ni usuarios, ni operadores la leen.
-- Solo las funciones SECURITY DEFINER de abajo.

create or replace function public.hash_semilla(p_semilla text)
returns text
language sql
immutable
as $$ select encode(sha256(convert_to(p_semilla, 'UTF8')), 'hex') $$;

create or replace function public.indice_sorteo(p_semilla text, p_ciclo_id uuid, p_n integer)
returns integer
language sql
immutable
as $$
  select (('x' || substr(encode(sha256(convert_to(p_semilla || ':' || p_ciclo_id::text, 'UTF8')), 'hex'), 1, 15))::bit(60)::bigint % p_n)::integer
$$;

create or replace function public.comprometer_sorteo(p_ciclo_id uuid, p_tardio boolean default false)
returns public.sorteos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_semilla text;
  v_sorteo public.sorteos;
begin
  select * into v_sorteo from public.sorteos where ciclo_id = p_ciclo_id;
  if v_sorteo.ciclo_id is not null then
    return v_sorteo; -- idempotente: nunca se reemplaza un compromiso
  end if;

  -- 2 UUID v4 = 244 bits aleatorios del generador criptográfico de Postgres.
  v_semilla := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.sorteo_semillas (ciclo_id, semilla) values (p_ciclo_id, v_semilla);

  insert into public.sorteos (ciclo_id, semilla_hash, participantes, compromiso_tardio)
  values (
    p_ciclo_id,
    public.hash_semilla(v_semilla),
    coalesce((select array_agg(b.id order by b.id) from public.boletos b where b.ciclo_id = p_ciclo_id), '{}'),
    p_tardio
  )
  returning * into v_sorteo;
  return v_sorteo;
end;
$$;

-- El compromiso se hace solo, en el instante en que el ciclo pasa a
-- 'lleno' (comprar_boleto() hace ese UPDATE) -- sin tocar comprar_boleto.
create or replace function public.trg_comprometer_sorteo_al_llenar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'lleno' and old.estado is distinct from 'lleno' then
    perform public.comprometer_sorteo(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ciclo_lleno_sorteo on public.ciclos;
create trigger trg_ciclo_lleno_sorteo
  after update of estado on public.ciclos
  for each row execute function public.trg_comprometer_sorteo_al_llenar();

-- Ciclos que ya estaban llenos antes de esta migración: se comprometen
-- ahora (antes de que se resuelvan), no al resolver.
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.ciclos where estado = 'lleno' loop
    perform public.comprometer_sorteo(v_id);
  end loop;
end $$;

-- Recalcula el ganador desde datos públicos. Devuelve si coincide con lo
-- que se pagó. Cualquiera puede llamarla.
create or replace function public.verificar_sorteo(p_ciclo_id uuid)
returns table (hash_valido boolean, ganador_recalculado uuid, ganador_registrado uuid, coincide boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s public.sorteos;
  v_recalculado uuid;
begin
  select * into v_s from public.sorteos where ciclo_id = p_ciclo_id;
  if v_s.ciclo_id is null or v_s.semilla is null then
    raise exception 'el sorteo del ciclo % todavía no se revela', p_ciclo_id;
  end if;
  if coalesce(array_length(v_s.acertantes, 1), 0) > 0 then
    v_recalculado := v_s.acertantes[1 + public.indice_sorteo(v_s.semilla, p_ciclo_id, array_length(v_s.acertantes, 1))];
  end if;
  return query select
    public.hash_semilla(v_s.semilla) = v_s.semilla_hash,
    v_recalculado,
    v_s.ganador_boleto_id,
    v_recalculado is not distinct from v_s.ganador_boleto_id;
end;
$$;

-- resolver_ciclo: igual que 0010, salvo el bloque del sorteo (marcado).
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
  v_sorteo public.sorteos;
  v_semilla text;
  v_acertantes uuid[];
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;
  if p_resultado not in ('si','no') then
    raise exception 'resultado inválido: %', p_resultado;
  end if;

  select * into v_ciclo from public.ciclos where id = p_ciclo_id for update;
  if v_ciclo.id is null then
    raise exception 'ciclo % no existe', p_ciclo_id;
  end if;
  if v_ciclo.estado <> 'lleno' then
    raise exception 'el ciclo % no está listo para resolverse (estado: %) -- debe estar "lleno"', p_ciclo_id, v_ciclo.estado;
  end if;

  select * into v_detalle from public.calcular_premio_ciclo(p_ciclo_id);

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

  -- ---- Sorteo verificable (0011) -- reemplaza `order by random()` ----
  select * into v_sorteo from public.sorteos where ciclo_id = p_ciclo_id;
  if v_sorteo.ciclo_id is null then
    v_sorteo := public.comprometer_sorteo(p_ciclo_id, true);
  end if;
  select semilla into v_semilla from public.sorteo_semillas where ciclo_id = p_ciclo_id;

  select coalesce(array_agg(b.id order by b.id), '{}') into v_acertantes
    from public.boletos b
    where b.id = any(v_sorteo.participantes) and b.respuesta = p_resultado;

  if array_length(v_acertantes, 1) > 0 then
    select * into v_ganador from public.boletos
      where id = v_acertantes[1 + public.indice_sorteo(v_semilla, p_ciclo_id, array_length(v_acertantes, 1))];
  end if;

  update public.sorteos
    set semilla = v_semilla, revelado_en = now(), acertantes = v_acertantes, ganador_boleto_id = v_ganador.id
    where ciclo_id = p_ciclo_id;
  -- ---- fin del sorteo ----

  -- Si nadie acertó, el premio no se paga -- qué pasa con él (bote
  -- acumulado con tope, según Legal) sigue pendiente de decisión.
  if v_ganador.id is not null then
    update public.boletos set ganador = true where id = v_ganador.id;

    insert into public.ledger_movimientos (user_id, monto, causa, modo)
    values (v_ganador.user_id, v_detalle.premio, 'Premio de sorteo -- ciclo ' || p_ciclo_id, 'demo');
  end if;

  update public.ciclos set estado = 'resuelto', actualizado_en = now() where id = p_ciclo_id;

  insert into public.ciclo_resoluciones (ciclo_id, resultado, fuente, evidencia, ganador_boleto_id, premio_pagado, resuelto_por)
  values (p_ciclo_id, p_resultado, p_fuente, p_evidencia, v_ganador.id, case when v_ganador.id is not null then v_detalle.premio else null end, auth.uid())
  returning * into v_resolucion;

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

-- Solo el sistema compromete sorteos. Si un usuario pudiera llamar
-- comprometer_sorteo() sobre un ciclo que todavía se está llenando,
-- congelaría una lista de participantes incompleta y dejaría fuera a
-- quienes compraran después. Supabase da EXECUTE a anon/authenticated por
-- default en funciones nuevas, así que se revoca explícitamente.
revoke execute on function public.comprometer_sorteo(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.trg_comprometer_sorteo_al_llenar() from public, anon, authenticated;
revoke execute on function public.registrar_auditoria() from public, anon, authenticated;


-- =======================================================================
-- 5. Eliminar cuenta (requisito del App Store, guía 5.1.1(v)): toda app
-- que permite crear cuenta debe permitir borrarla desde la app. Choca con
-- el punto 1 (no se borra historia financiera), así que "eliminar" =
-- anonimizar: se borran o sustituyen los datos personales, se cierran las
-- sesiones y ya no se puede entrar; ledger, boletos y consentimientos se
-- conservan bajo un id sin nombre (Legal: conservar 5 años).
-- =======================================================================
alter table public.perfiles add column if not exists cuenta_eliminada_en timestamptz;

create or replace function public.eliminar_mi_cuenta()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'eliminar_mi_cuenta requiere sesión activa';
  end if;

  -- No se elimina una cuenta con dinero en juego: primero se resuelve o
  -- se cancela el ciclo y el depósito regresa.
  if exists (
    select 1 from public.boletos b join public.ciclos c on c.id = b.ciclo_id
    where b.user_id = v_uid and c.estado in ('llenando','lleno')
  ) then
    raise exception 'tienes boletos activos: podrás eliminar tu cuenta cuando se resuelvan';
  end if;

  update auth.users
    set email = 'eliminado+' || v_uid || '@cuenta-eliminada.invalid',
        encrypted_password = null,
        raw_user_meta_data = '{}'::jsonb
    where id = v_uid;

  -- Tablas que solo existen en Supabase real (no en pruebas locales).
  if to_regclass('auth.identities') is not null then
    execute 'delete from auth.identities where user_id = $1' using v_uid;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using v_uid;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1::text' using v_uid;
  end if;

  delete from public.intereses_modo_real where user_id = v_uid;
  update public.perfiles set cuenta_eliminada_en = now() where user_id = v_uid;
end;
$$;


-- =======================================================================
-- 6. Bote acumulado por nivel (decisión de Beto, 2026-10-03; regla de
-- salida de Legal, reporte-legal-01 §4):
--   * Si nadie acierta, el premio del ciclo se suma al bote de su nivel.
--   * El siguiente ciclo de ese nivel juega por premio base + bote.
--   * Tope: al llegar a `productos.bote_max_ciclos` ciclos seguidos sin
--     acertante (3 por default), el premio (base + bote) se sortea entre
--     TODOS los participantes de ese ciclo, aciertan o no. Así el premio
--     ofrecido siempre se entrega (requisito del permiso de sorteo).
--   * Un ciclo cancelado (no se llenó) no toca el bote.
--
-- El bote es un pasivo: vive como movimientos append-only
-- (`bote_movimientos`, inmutable como el ledger) y `botes.monto` es solo
-- la caché que mantiene un trigger. Cuenta en la exposición global porque
-- calcular_premio_ciclo() ya lo incluye.
-- =======================================================================
alter table public.productos add column if not exists bote_max_ciclos integer not null default 3 check (bote_max_ciclos >= 1);

create table if not exists public.botes (
  producto_clave text primary key references public.productos(clave),
  monto numeric not null default 0 check (monto >= 0),
  ciclos_sin_acertante integer not null default 0,
  actualizado_en timestamptz not null default now()
);

insert into public.botes (producto_clave)
select clave from public.productos
on conflict (producto_clave) do nothing;

alter table public.botes enable row level security;
drop policy if exists "botes lectura pública" on public.botes;
create policy "botes lectura pública"
  on public.botes for select
  using (true); -- se muestra en pantalla, misma transparencia que sorteos

create table if not exists public.bote_movimientos (
  id bigint generated always as identity primary key,
  producto_clave text not null references public.productos(clave),
  ciclo_id uuid references public.ciclos(id),
  monto numeric not null, -- positivo = entra al bote, negativo = se paga
  causa text not null,
  creado_en timestamptz not null default now()
);

alter table public.bote_movimientos enable row level security;
drop policy if exists "bote_movimientos lectura pública" on public.bote_movimientos;
create policy "bote_movimientos lectura pública"
  on public.bote_movimientos for select
  using (true);

drop trigger if exists trg_bote_movimientos_inmutable on public.bote_movimientos;
create trigger trg_bote_movimientos_inmutable
  before update or delete on public.bote_movimientos
  for each row execute function public.rechazar_cambio_ledger();

create or replace function public.aplicar_movimiento_bote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.botes (producto_clave, monto) values (new.producto_clave, 0)
  on conflict (producto_clave) do nothing;
  update public.botes
    set monto = monto + new.monto, actualizado_en = now()
    where producto_clave = new.producto_clave;
  return new;
end;
$$;

drop trigger if exists trg_aplicar_movimiento_bote on public.bote_movimientos;
create trigger trg_aplicar_movimiento_bote
  after insert on public.bote_movimientos
  for each row execute function public.aplicar_movimiento_bote();

revoke execute on function public.aplicar_movimiento_bote() from public, anon, authenticated;

alter table public.ciclo_resoluciones add column if not exists premio_base numeric;
alter table public.ciclo_resoluciones add column if not exists bote_aplicado numeric;
alter table public.ciclo_resoluciones add column if not exists sorteo_entre text
  check (sorteo_entre in ('acertantes','todos_por_tope','sin_sorteo_acumula'));
alter table public.sorteos add column if not exists elegibles uuid[];
alter table public.sorteos add column if not exists sorteo_entre text;

-- ---------------------------------------------------------------------
-- calcular_premio_ciclo: ÚNICO lugar donde se calcula el premio. Las
-- pantallas, la exposición global y resolver_ciclo leen de aquí. Si
-- Finanzas cambia la fórmula, se cambia solo el bloque "premio base".
-- ---------------------------------------------------------------------
drop function if exists public.calcular_premio_ciclo(uuid);
create function public.calcular_premio_ciclo(p_ciclo_id uuid)
returns table (premio numeric, premio_bruto numeric, carry_pct numeric, motor text, premio_base numeric, bote numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo public.ciclos;
  v_producto public.productos;
  v_tasa_cetes numeric;
  v_alpha_em numeric;
  v_dias numeric;
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

  -- ---- premio base ----
  -- Decisión de Beto (3-oct-2026): premio = lo que el pool generó + bote.
  -- Ya NO se divide entre la probabilidad del evento (1/p): con esa
  -- fórmula, cada vez que el evento ocurría PISO ponía de su bolsa la
  -- diferencia. Ahora el premio sale completo del rendimiento real del
  -- capital del ciclo y PISO nunca pone dinero propio (salvo el bono de
  -- bienvenida, que es un subsidio de adquisición explícito y topado).
  --
  --   rendimiento = N * precio * (e^(r * días/365) - 1)      (CETES, continuo)
  --   bruto       = rendimiento * (1 - alpha_em)              (alpha_em = parte de PISO)
  --   premio base = bruto * (1 - carry del tramo)
  --
  -- Mientras Finanzas no llene tasa_cetes_anual / productos.alpha_em, se
  -- usan los acuerdos vigentes (r = 10%, alpha_em = 25%) y motor =
  -- 'pool_supuestos', visible en /admin.
  v_supuestos := v_tasa_cetes is null or v_producto.alpha_em is null;
  v_tasa_cetes := coalesce(v_tasa_cetes, 10);
  v_alpha_em := coalesce(v_producto.alpha_em, 0.25);
  v_dias := extract(epoch from (v_ciclo.fecha_resolucion - v_ciclo.fecha_inicio)) / 86400.0;

  v_bruto := v_producto.gente_requerida * v_producto.precio
             * (exp((v_tasa_cetes / 100.0) * (v_dias / 365.0)) - 1)
             * (1 - v_alpha_em);

  select coalesce(t.carry_pct, 30) into v_carry
    from public.producto_carry_tramos t
    where t.producto_clave = v_producto.clave
      and (t.premio_hasta is null or v_bruto <= t.premio_hasta)
    order by t.orden asc
    limit 1;
  v_carry := coalesce(v_carry, 12);

  v_neto := round(v_bruto * (1 - v_carry / 100.0));

  if v_ciclo.bono_bienvenida_activado and v_neto < 20000 then
    v_neto := 20000;
  end if;
  -- ---- fin premio base ----

  -- Bote: un ciclo ya resuelto no muestra el bote actual (ese ya es de
  -- otro ciclo); lo que se aplicó queda en ciclo_resoluciones.
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

-- verificar_sorteo: ahora recalcula sobre `elegibles` (acertantes, o todos
-- los participantes cuando se alcanzó el tope del bote).
create or replace function public.verificar_sorteo(p_ciclo_id uuid)
returns table (hash_valido boolean, ganador_recalculado uuid, ganador_registrado uuid, coincide boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_s public.sorteos;
  v_lista uuid[];
  v_recalculado uuid;
begin
  select * into v_s from public.sorteos where ciclo_id = p_ciclo_id;
  if v_s.ciclo_id is null or v_s.semilla is null then
    raise exception 'el sorteo del ciclo % todavía no se revela', p_ciclo_id;
  end if;
  v_lista := coalesce(v_s.elegibles, v_s.acertantes);
  if coalesce(array_length(v_lista, 1), 0) > 0 then
    v_recalculado := v_lista[1 + public.indice_sorteo(v_s.semilla, p_ciclo_id, array_length(v_lista, 1))];
  end if;
  return query select
    public.hash_semilla(v_s.semilla) = v_s.semilla_hash,
    v_recalculado,
    v_s.ganador_boleto_id,
    v_recalculado is not distinct from v_s.ganador_boleto_id;
end;
$$;

-- resolver_ciclo: la versión de la sección 4 + reglas del bote.
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
  v_producto public.productos;
  v_bote public.botes;
  v_detalle record;
  v_ganador public.boletos;
  v_boleto record;
  v_usuarios_afectados uuid[] := '{}';
  v_violaciones integer;
  v_resolucion public.ciclo_resoluciones;
  v_sorteo public.sorteos;
  v_semilla text;
  v_acertantes uuid[];
  v_elegibles uuid[];
  v_sorteo_entre text;
  v_pagado numeric;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;
  if p_resultado not in ('si','no') then
    raise exception 'resultado inválido: %', p_resultado;
  end if;

  select * into v_ciclo from public.ciclos where id = p_ciclo_id for update;
  if v_ciclo.id is null then
    raise exception 'ciclo % no existe', p_ciclo_id;
  end if;
  if v_ciclo.estado <> 'lleno' then
    raise exception 'el ciclo % no está listo para resolverse (estado: %) -- debe estar "lleno"', p_ciclo_id, v_ciclo.estado;
  end if;

  select * into v_producto from public.productos where clave = v_ciclo.producto_clave;
  -- Lock del bote del nivel: dos ciclos del mismo nivel resolviéndose a
  -- la vez no pueden cobrar el mismo bote.
  insert into public.botes (producto_clave) values (v_producto.clave) on conflict (producto_clave) do nothing;
  select * into v_bote from public.botes where producto_clave = v_producto.clave for update;

  select * into v_detalle from public.calcular_premio_ciclo(p_ciclo_id);

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

  -- ---- Sorteo verificable ----
  select * into v_sorteo from public.sorteos where ciclo_id = p_ciclo_id;
  if v_sorteo.ciclo_id is null then
    v_sorteo := public.comprometer_sorteo(p_ciclo_id, true);
  end if;
  select semilla into v_semilla from public.sorteo_semillas where ciclo_id = p_ciclo_id;

  select coalesce(array_agg(b.id order by b.id), '{}') into v_acertantes
    from public.boletos b
    where b.id = any(v_sorteo.participantes) and b.respuesta = p_resultado;

  if array_length(v_acertantes, 1) > 0 then
    v_elegibles := v_acertantes;
    v_sorteo_entre := 'acertantes';
  elsif v_bote.ciclos_sin_acertante + 1 >= v_producto.bote_max_ciclos then
    -- Tope del bote: se sortea entre todos para que el premio se entregue.
    v_elegibles := v_sorteo.participantes;
    v_sorteo_entre := 'todos_por_tope';
  else
    v_elegibles := '{}';
    v_sorteo_entre := 'sin_sorteo_acumula';
  end if;

  if array_length(v_elegibles, 1) > 0 then
    select * into v_ganador from public.boletos
      where id = v_elegibles[1 + public.indice_sorteo(v_semilla, p_ciclo_id, array_length(v_elegibles, 1))];
  end if;

  update public.sorteos
    set semilla = v_semilla, revelado_en = now(), acertantes = v_acertantes,
        elegibles = v_elegibles, sorteo_entre = v_sorteo_entre, ganador_boleto_id = v_ganador.id
    where ciclo_id = p_ciclo_id;
  -- ---- fin del sorteo ----

  if v_ganador.id is not null then
    v_pagado := v_detalle.premio; -- base + bote
    update public.boletos set ganador = true where id = v_ganador.id;

    insert into public.ledger_movimientos (user_id, monto, causa, modo)
    values (v_ganador.user_id, v_pagado, 'Premio de sorteo -- ciclo ' || p_ciclo_id, 'demo');

    if v_detalle.bote > 0 then
      insert into public.bote_movimientos (producto_clave, ciclo_id, monto, causa)
      values (v_producto.clave, p_ciclo_id, -v_detalle.bote, 'Bote pagado en sorteo (' || v_sorteo_entre || ')');
    end if;
    update public.botes set ciclos_sin_acertante = 0, actualizado_en = now() where producto_clave = v_producto.clave;
  else
    -- Nadie acertó y no se llegó al tope: el premio base entra al bote.
    insert into public.bote_movimientos (producto_clave, ciclo_id, monto, causa)
    values (v_producto.clave, p_ciclo_id, v_detalle.premio_base, 'Nadie acertó -- premio se acumula');
    update public.botes set ciclos_sin_acertante = ciclos_sin_acertante + 1, actualizado_en = now() where producto_clave = v_producto.clave;
  end if;

  update public.ciclos set estado = 'resuelto', actualizado_en = now() where id = p_ciclo_id;

  insert into public.ciclo_resoluciones (
    ciclo_id, resultado, fuente, evidencia, ganador_boleto_id, premio_pagado, resuelto_por,
    premio_base, bote_aplicado, sorteo_entre
  )
  values (
    p_ciclo_id, p_resultado, p_fuente, p_evidencia, v_ganador.id, v_pagado, auth.uid(),
    v_detalle.premio_base, case when v_ganador.id is not null then v_detalle.bote else 0 end, v_sorteo_entre
  )
  returning * into v_resolucion;

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
