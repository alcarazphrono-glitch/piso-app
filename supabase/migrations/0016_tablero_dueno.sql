-- PISO — Tablero del dueño (/dueno)
-- =====================================================================
-- Correr DESPUÉS de 0002 (necesita operadores). No depende de 0011-0015:
-- si esas migraciones todavía no están corridas, el tablero lo dice
-- ("pendiente") en vez de fallar.
--
-- Qué agrega:
--   1. duenos            -- quién es dueño. Solo el dueño entra a /dueno.
--   2. es_dueno()        -- la única verificación de acceso, la usa el
--                           layout y cada política de esta migración.
--   3. decisiones        -- bitácora de decisiones de negocio: qué se
--                           decidió, por qué, qué esperamos y qué pasó.
--   4. dueno_estado()    -- foto en vivo de la empresa en una sola llamada.
--                           Solo cuenta lo que ya existe en la base; no
--                           calcula economía (eso vive en Finanzas, 0014,
--                           y se ve en /consola/palancas).

-- ---------------------------------------------------------------------
-- 1. Dueños
-- ---------------------------------------------------------------------
create table if not exists public.duenos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now()
);

alter table public.duenos enable row level security;

-- Igual que operadores (ver 0002): cada quien solo ve su propia fila, sin
-- subconsultar la misma tabla en la política (evita recursión).
drop policy if exists "un usuario ve si el mismo es dueno" on public.duenos;
create policy "un usuario ve si el mismo es dueno"
  on public.duenos for select
  using (auth.uid() = user_id);

-- Siembra: el primer operador registrado (quien corrió 0002 con su correo)
-- es el fundador. Si no es así, borra esta fila y usa la de abajo.
insert into public.duenos (user_id)
select user_id from public.operadores order by creado_en asc limit 1
on conflict do nothing;

-- Alternativa explícita por correo (descomenta y reemplaza):
-- insert into public.duenos (user_id)
-- select id from auth.users where email = 'TU_CORREO_AQUI@dominio.com'
-- on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. es_dueno()
-- ---------------------------------------------------------------------
create or replace function public.es_dueno()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.duenos where user_id = auth.uid());
$$;

grant execute on function public.es_dueno() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Bitácora de decisiones
-- ---------------------------------------------------------------------
-- Cada decisión se registra ANTES de saber cómo sale (qué esperamos y
-- cómo lo vamos a medir), y se revisa después con el resultado real.
-- Así se aprende: se compara lo esperado contra lo que pasó.
create table if not exists public.decisiones (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  departamento text not null default 'direccion'
    check (departamento in ('direccion','tecnologia','finanzas','behavioral','legal','mesa','marketing')),
  por_que text not null default '',
  resultado_esperado text not null default '',
  como_medir text not null default '',
  revisar_el date,
  estado text not null default 'abierta' check (estado in ('abierta','revisada','descartada')),
  resultado_real text,
  aprendizaje text,
  salio_como_esperabamos text check (salio_como_esperabamos in ('si','parcial','no')),
  decidido_por uuid references auth.users(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  revisado_en timestamptz
);

create index if not exists decisiones_creado_en on public.decisiones (creado_en desc);

alter table public.decisiones enable row level security;

drop policy if exists "dueno lee decisiones" on public.decisiones;
create policy "dueno lee decisiones"
  on public.decisiones for select
  using (public.es_dueno());

drop policy if exists "dueno crea decisiones" on public.decisiones;
create policy "dueno crea decisiones"
  on public.decisiones for insert
  with check (public.es_dueno());

drop policy if exists "dueno actualiza decisiones" on public.decisiones;
create policy "dueno actualiza decisiones"
  on public.decisiones for update
  using (public.es_dueno())
  with check (public.es_dueno());

-- Sin política de delete a propósito: una decisión que no se tomó se marca
-- 'descartada', no se borra. La bitácora es el registro de aprendizaje.

-- Decisiones ya tomadas por Beto (2026-10-03), para que la bitácora no
-- arranque vacía. Quedan abiertas para escribirles el resultado real.
insert into public.decisiones (titulo, departamento, por_que, resultado_esperado, como_medir, decidido_por, creado_en)
select * from (values
  ('Premio por sorteo entre quienes aciertan; bote con tope de 3 ciclos', 'direccion',
   'Un premio grande y claro atrae más que repartir poco entre muchos; el tope evita un bote infinito.',
   'Más boletos por ciclo que con premio repartido.',
   'Boletos por ciclo y tasa de recompra después de fallar.', null::uuid, '2026-10-03'::timestamptz),
  ('Premio = rendimiento del pool + bote. PISO nunca pone de su bolsa', 'finanzas',
   'El capital del usuario queda 100% protegido y PISO no asume riesgo de pagar premios.',
   'Margen positivo en cada ciclo sin importar quién gane.',
   'Contribución por ciclo en /consola/palancas.', null::uuid, '2026-10-03'::timestamptz),
  ('Home solo con Boletos; app lista para 50,000 usuarios antes de El Reto', 'tecnologia',
   'Una sola acción clara en la entrada; no lanzar El Reto con una app a medias.',
   'Mayor conversión de registro a primer boleto.',
   'Embudo registro → primer boleto en PostHog.', null::uuid, '2026-10-03'::timestamptz),
  ('A quien falla se le recomienda otro evento por interés, nunca "recupera lo perdido"', 'behavioral',
   'Legal: evitar mensajes que empujen a perseguir pérdidas.',
   'Recompra sana sin señales de juego problemático.',
   'Recompra después de fallar y quejas/bajas.', null::uuid, '2026-10-03'::timestamptz)
) as v(titulo, departamento, por_que, resultado_esperado, como_medir, decidido_por, creado_en)
where not exists (select 1 from public.decisiones);

-- ---------------------------------------------------------------------
-- 4. dueno_estado() -- foto en vivo
-- ---------------------------------------------------------------------
-- Lee tablas de otras migraciones (0011-0014) solo si existen, con
-- to_regclass + execute, para que el tablero funcione en cualquier orden
-- de merge y además muestre qué partes de la infraestructura faltan.
create or replace function public.dueno_estado()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb := '{}'::jsonb;
  n bigint;
  x numeric;
  r jsonb;
begin
  if not public.es_dueno() then
    raise exception 'solo el dueño puede ver este tablero';
  end if;

  -- Usuarios
  select count(*) into n from auth.users;
  v := v || jsonb_build_object('usuarios_total', n);
  select count(*) into n from auth.users where created_at >= now() - interval '7 days';
  v := v || jsonb_build_object('usuarios_7d', n);
  select count(*) into n from auth.users where created_at >= now() - interval '1 day';
  v := v || jsonb_build_object('usuarios_24h', n);
  select count(*) into n from public.balances where modo = 'real';
  v := v || jsonb_build_object('usuarios_modo_real', n);

  -- Ciclos y dinero en juego
  select count(*) into n from public.ciclos where estado in ('llenando','lleno');
  v := v || jsonb_build_object('ciclos_abiertos', n);
  select count(*) into n from public.ciclos where estado = 'resuelto';
  v := v || jsonb_build_object('ciclos_resueltos', n);
  select coalesce(sum(b.monto), 0) into x
    from public.boletos b join public.ciclos c on c.id = b.ciclo_id
   where c.estado in ('llenando','lleno');
  v := v || jsonb_build_object('pool_abierto', x);
  select count(*) into n from public.boletos where creado_en >= now() - interval '7 days';
  v := v || jsonb_build_object('boletos_7d', n);
  select count(*) into n from public.boletos;
  v := v || jsonb_build_object('boletos_total', n);
  select count(*) into n from public.eventos where estado = 'abierto';
  v := v || jsonb_build_object('eventos_abiertos', n);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'nivel', p.nombre,
           'evento', e.nombre,
           'ocupados', c.lugares_ocupados,
           'requeridos', p.gente_requerida,
           'estado', c.estado,
           'resuelve', c.fecha_resolucion
         ) order by c.fecha_resolucion), '[]'::jsonb)
    into r
    from public.ciclos c
    join public.productos p on p.clave = c.producto_clave
    join public.eventos e on e.id = c.evento_id
   where c.estado in ('llenando','lleno');
  v := v || jsonb_build_object('ciclos', r);

  -- Lista de espera (0013)
  if to_regclass('public.lista_espera') is not null then
    execute 'select count(*) from public.lista_espera' into n;
    v := v || jsonb_build_object('lista_espera', n);
    execute $q$select count(*) from public.lista_espera where creado_en >= now() - interval '7 days'$q$ into n;
    v := v || jsonb_build_object('lista_espera_7d', n);
  end if;

  -- Mesa de derivados (0012): propuestas esperando decisión humana
  if to_regclass('public.mesa_propuestas') is not null then
    execute $q$select count(*) from public.mesa_propuestas where estado = 'pendiente'$q$ into n;
    v := v || jsonb_build_object('mesa_pendientes', n);
  end if;

  -- Decisiones por revisar
  select count(*) into n from public.decisiones
   where estado = 'abierta' and revisar_el is not null and revisar_el <= current_date;
  v := v || jsonb_build_object('decisiones_por_revisar', n);

  -- Qué piezas de infraestructura están corridas en esta base
  v := v || jsonb_build_object('infra', jsonb_build_object(
    '0011_legal_sorteo', to_regclass('public.sorteos') is not null,
    '0012_mesa', to_regclass('public.mesa_propuestas') is not null,
    '0013_lista_espera', to_regclass('public.lista_espera') is not null,
    '0014_economia', to_regclass('public.economia_parametros') is not null
  ));

  v := v || jsonb_build_object('generado_en', now());
  return v;
end;
$$;

grant execute on function public.dueno_estado() to authenticated;
