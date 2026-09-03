-- PISO Core V1 — Event Manager + Resolution Engine + Ledger (base)
-- =====================================================================
-- Ver memo "PISO Core — Decisión de arquitectura (Sprint 1)" (3-sep-2026)
-- y su aprobación ("PISO Core — Respuesta a la decisión de arquitectura",
-- 3-sep-2026). Esta migración implementa la Opción C: un solo Supabase,
-- pero la autoridad de escritura sobre balances, resultado de posiciones
-- y eventos se mueve de RLS-por-el-cliente a funciones de servidor
-- (SECURITY DEFINER) auditadas.
--
-- Condición 1 del memo de aprobación: cada función que toca balances,
-- posiciones.resultado/estado o eventos documenta explícitamente, en el
-- propio código, qué valida antes de escribir. Ver comentarios inline en
-- cada función más abajo.
--
-- Condición 2: esta migración NO usa Edge Functions ni service_role key.
-- Las funciones son SECURITY DEFINER de Postgres, invocadas vía
-- supabase.rpc() con el JWT normal del usuario -- auth.uid() adentro de
-- la función ya identifica a quien llama, sin necesitar la credencial más
-- peligrosa del proyecto para esto. El service_role key se reserva para
-- cuando Data Ingestion (sección 3.7 del brief original) necesite hablar
-- con fuentes externas -- no hace falta todavía.
--
-- Corre esto en el SQL Editor del MISMO proyecto de Supabase que ya usa
-- Consumer (confirmado en la sección 5 del memo de aprobación: no se
-- provisiona uno nuevo).

-- ---------------------------------------------------------------------
-- 0. operadores -- quién puede administrar eventos y resolverlos.
-- Sin políticas de select/insert para authenticated a propósito: solo se
-- lee/escribe desde dentro de las funciones SECURITY DEFINER de abajo, o
-- a mano desde el SQL Editor por quien tenga acceso al proyecto.
-- ---------------------------------------------------------------------
create table if not exists public.operadores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rol text not null default 'admin' check (rol in ('admin')),
  creado_en timestamptz not null default now()
);
alter table public.operadores enable row level security;
-- Sin insert manual aquí: agreguen su propio user_id a mano una vez que
-- exista la cuenta real en auth.users, ej:
--   insert into public.operadores (user_id) values ('<uuid-de-beto>');

-- ---------------------------------------------------------------------
-- 1. eventos -- extensión para Event Manager (sección 3.1 del brief).
-- La tabla ya existía (destino de la FK de posiciones) pero la UI de
-- Consumer nunca leyó de aquí -- leía del arreglo EVENTOS hardcodeado en
-- src/types/index.ts. Esta migración le da a la tabla el contenido que le
-- falta; conectar la lectura de Consumer es el siguiente paso, NO parte
-- de esta migración (ver memo de arquitectura, checkpoint de un solo
-- evento antes de replicar el patrón).
-- ---------------------------------------------------------------------
alter table public.eventos
  add column if not exists categoria text,
  add column if not exists descripcion text,
  add column if not exists opciones jsonb not null default '["si","no"]'::jsonb,
  add column if not exists imagen_url text,
  add column if not exists explicacion_corta text,
  add column if not exists explicacion_larga text,
  add column if not exists fecha_display text,
  add column if not exists fecha_contexto text,
  add column if not exists fecha_apertura timestamptz,
  add column if not exists fecha_cierre timestamptz,
  add column if not exists fecha_resolucion timestamptz,
  add column if not exists fuente_resolucion text,
  add column if not exists estado text not null default 'borrador'
    check (estado in ('borrador','abierto','cerrado','resuelto')),
  add column if not exists resultado_oficial text,
  add column if not exists creado_por uuid references auth.users(id),
  add column if not exists creado_en timestamptz not null default now(),
  add column if not exists actualizado_en timestamptz not null default now();

-- NOTA (limitación conocida, no resuelta en esta migración): opciones es
-- jsonb para soportar eventos de más de dos resultados (ej. América /
-- Chivas / Empate, sección 3.1 del brief), pero posiciones.respuesta
-- sigue con el check constraint original ('si'/'no' únicamente) y
-- resolver_evento() más abajo solo compara si/no. Los dos eventos activos
-- hoy (Banxico, INPC) son binarios, así que no bloquea el checkpoint de
-- "un solo evento" -- pero eventos multi-opción (fútbol) necesitan un
-- cambio de esquema adicional en posiciones antes de poder usarse. Queda
-- pendiente a propósito, no es un olvido.

-- Mantener `activo` sincronizado con `estado` mientras Consumer siga
-- leyendo `activo` del arreglo hardcodeado en vez de esta tabla -- evita
-- que este cambio rompa nada que ya funcione hoy.
create or replace function public.sync_eventos_activo()
returns trigger
language plpgsql
as $$
begin
  new.activo := (new.estado = 'abierto');
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_eventos_activo on public.eventos;
create trigger trg_sync_eventos_activo
  before insert or update on public.eventos
  for each row execute function public.sync_eventos_activo();

-- Solo lectura pública se mantiene igual que antes. Insert/update queda
-- restringido a operadores -- así el Event Manager (una página normal
-- autenticada) puede hacer insert/update directo sin necesitar una
-- función aparte, y un usuario común sigue sin poder tocar el catálogo.
drop policy if exists "operadores administran eventos" on public.eventos;
create policy "operadores administran eventos"
  on public.eventos for all
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()))
  with check (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 2. resoluciones -- Resolution Engine (sección 3.2 del brief): fuente +
-- timestamp + evidencia + quién + cuándo, auditable, nunca un campo de
-- texto libre suelto en otra tabla.
-- ---------------------------------------------------------------------
create table if not exists public.resoluciones (
  id uuid primary key default gen_random_uuid(),
  evento_id text not null references public.eventos(id),
  fuente text not null,
  resultado text not null,
  evidencia text,
  resuelto_por uuid references auth.users(id),
  resuelto_en timestamptz not null default now(),
  es_demo boolean not null default true
);
alter table public.resoluciones enable row level security;

drop policy if exists "operadores ven resoluciones" on public.resoluciones;
create policy "operadores ven resoluciones"
  on public.resoluciones for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));
-- Sin policy de insert para authenticated/anon: solo resolver_evento()
-- (SECURITY DEFINER) escribe aquí. Así el audit log no se puede falsear
-- desde el cliente ni siquiera por un operador con acceso directo a la
-- tabla.

-- ---------------------------------------------------------------------
-- 3. ledger_movimientos -- Ledger de doble entrada, base (sección 3.3).
-- V1 real: cada movimiento de balance queda como fila aquí, no solo como
-- un número que cambia. balances.demo_balance sigue existiendo como saldo
-- vigente (lectura rápida para la UI) pero ya no lo escribe el cliente --
-- es un espejo de lo que este ledger dice, mantenido por las funciones de
-- abajo.
-- ---------------------------------------------------------------------
create table if not exists public.ledger_movimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  posicion_id uuid references public.posiciones(id),
  tipo text not null check (tipo in ('deposito_demo','asignacion','premio','devolucion')),
  monto numeric not null,
  saldo_resultante numeric not null,
  creado_en timestamptz not null default now()
);
alter table public.ledger_movimientos enable row level security;

drop policy if exists "usuarios ven su propio ledger" on public.ledger_movimientos;
create policy "usuarios ven su propio ledger"
  on public.ledger_movimientos for select
  using (auth.uid() = user_id);
-- Sin insert/update para authenticated/anon: solo las funciones
-- SECURITY DEFINER escriben aquí.

-- ---------------------------------------------------------------------
-- 4. Retirar la autoridad de escritura del cliente sobre dinero y
-- resultados (el hallazgo central del memo de arquitectura, sección 1).
-- ---------------------------------------------------------------------
drop policy if exists "usuarios crean su propio balance" on public.balances;
drop policy if exists "usuarios actualizan su propio balance" on public.balances;
-- "usuarios ven su propio balance" (select) se queda igual -- leer su
-- saldo sigue siendo del usuario, escribirlo ya no.

drop policy if exists "usuarios actualizan sus propias posiciones" on public.posiciones;
-- "usuarios crean sus propias posiciones" (insert) se queda igual --
-- abrir una posición nueva sigue siendo del usuario (es su intención,
-- capital_en_riesgo sigue forzado a 0 por el check constraint original).
-- Lo que se quita es poder escribir su propio estado/resultado.

-- ---------------------------------------------------------------------
-- 5. Funciones de servidor
-- ---------------------------------------------------------------------

-- Reemplaza el upsert directo de asegurarPerfilYBalanceDemo() en
-- src/lib/demo.ts. Válida: que exista sesión (auth.uid() no nulo). El
-- monto de arranque ($1,000) queda fijo en el código de la función, no lo
-- puede mandar el cliente -- antes de esto, un cliente que llamara
-- directo a la API de Supabase (sin pasar por la app) podía insertar
-- cualquier demo_balance inicial que quisiera.
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

  insert into public.ledger_movimientos (user_id, posicion_id, tipo, monto, saldo_resultante)
    select v_uid, null, 'deposito_demo', 1000, 1000
    where not exists (
      select 1 from public.ledger_movimientos
      where user_id = v_uid and tipo = 'deposito_demo'
    );

  return (select demo_balance from public.balances where user_id = v_uid);
end;
$$;
revoke all on function public.iniciar_balance_demo() from public;
grant execute on function public.iniciar_balance_demo() to authenticated;

-- Reemplaza simularResultadoAhora() en src/app/posicion/page.tsx.
-- Condición 1 del memo de aprobación, aplicada literalmente: valida que
-- la posición que se resuelve pertenece a quien llama, comparando
-- posiciones.user_id contra auth.uid() del JWT de la sesión -- nunca un
-- id que mande el cliente en el body de la llamada.
--
-- Nota de producto (memo de arquitectura, "ajuste de alcance"): esto es
-- simulación POR POSICIÓN, independiente por usuario -- a propósito, para
-- no bloquear la beta de Track A (50-200 usuarios, cada uno necesita ver
-- su propio resultado sin esperar a que un operador resuelva el evento).
-- NO es el Resolution Engine oficial -- no toca eventos.estado ni la
-- tabla resoluciones. Ese es resolver_evento(), más abajo.
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
    insert into public.ledger_movimientos (user_id, posicion_id, tipo, monto, saldo_resultante)
      values (v_uid, p_posicion_id, 'premio', v_pos.premio_potencial, v_balance);
  end if;

  return query select v_resultado, v_balance;
end;
$$;
revoke all on function public.simular_resultado_posicion_demo(uuid) from public;
grant execute on function public.simular_resultado_posicion_demo(uuid) to authenticated;

-- Resolution Engine real (sección 3.2 del brief): resuelve el EVENTO una
-- sola vez, para todos, con fuente + evidencia auditadas, y propaga el
-- resultado a cada posición abierta. Esta es la función que usa Event
-- Manager -- un operador, no un usuario resolviendo su propia posición.
--
-- Condición 1, aplicada aquí de forma distinta a
-- simular_resultado_posicion_demo(): esta función SÍ toca posiciones y
-- balances de otros usuarios, así que no tiene sentido validar "le
-- pertenece a quien llama" -- lo que se valida es que quien llama tiene
-- ROL de operador (existe en public.operadores). Sin esto, cualquier
-- usuario autenticado podría resolver el evento de todos.
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
    -- Binario si/no únicamente -- ver nota de la sección 1 sobre
    -- eventos multi-opción, todavía no soportados.
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
      insert into public.ledger_movimientos (user_id, posicion_id, tipo, monto, saldo_resultante)
        values (v_pos.user_id, v_pos.id, 'premio', v_pos.premio_potencial, v_balance);
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.resolver_evento(text, text, text, text) from public;
grant execute on function public.resolver_evento(text, text, text, text) to authenticated;
