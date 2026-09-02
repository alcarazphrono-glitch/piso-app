-- PISO — MVP Loop, Prioridad 5 (memo Dirección General, 25-ago-2026)
-- =====================================================================
-- Correr esto una vez en el SQL Editor de un proyecto nuevo de Supabase.
-- Todo lo que NO está aquí (CETES real, float/carry real, los 5 pisos
-- completos, más de un evento) es a propósito -- no se construye esta
-- semana (memo DG, sección "Lo que no construyen esta semana").

-- ---------------------------------------------------------------------
-- 1. Perfiles -- espejo de auth.users con lo que el producto necesita
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  piso text not null default 'tierra' check (piso in ('tierra','plata','oro','platino','obsidiana')),
  creado_en timestamptz not null default now()
);

alter table public.perfiles enable row level security;

create policy "usuarios ven su propio perfil"
  on public.perfiles for select
  using (auth.uid() = user_id);

create policy "usuarios crean su propio perfil"
  on public.perfiles for insert
  with check (auth.uid() = user_id);

create policy "usuarios actualizan su propio perfil"
  on public.perfiles for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 2. Balances -- modo demo obligatorio (Prioridad 2). $1,000 virtuales.
-- ---------------------------------------------------------------------
create table if not exists public.balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  demo_balance numeric not null default 1000,
  modo text not null default 'demo' check (modo in ('demo','real')),
  actualizado_en timestamptz not null default now()
);

alter table public.balances enable row level security;

create policy "usuarios ven su propio balance"
  on public.balances for select
  using (auth.uid() = user_id);

create policy "usuarios crean su propio balance"
  on public.balances for insert
  with check (auth.uid() = user_id);

create policy "usuarios actualizan su propio balance"
  on public.balances for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 3. Eventos -- catálogo. Un solo evento activo esta semana (Prioridad 3)
-- ---------------------------------------------------------------------
create table if not exists public.eventos (
  id text primary key,
  nombre text not null,
  probabilidad numeric not null,
  activo boolean not null default false
);

insert into public.eventos (id, nombre, probabilidad, activo) values
  ('banxico_baja_tasas', 'Banxico baja tasas', 0.35, true),
  ('tortilla_sube', 'Precio tortilla sube >5%', 0.25, false),
  ('inpc_bajo', 'Inflación INPC < 4%', 0.40, true),
  ('ipc_sube', 'IPC BMV sube >2%', 0.45, false)
on conflict (id) do update set activo = excluded.activo;
-- Sección 8 del memo Behavioral (2-sep-2026): segundo evento activo esta
-- semana, misma plantilla que Banxico, para que la presentación
-- institucional se vea como instrumento financiero (no fútbol).

-- lectura pública -- el catálogo de eventos no es información sensible
alter table public.eventos enable row level security;
create policy "eventos son de lectura pública"
  on public.eventos for select
  using (true);

-- ---------------------------------------------------------------------
-- 4. Posiciones -- una por cada Sí/No que confirma un usuario
-- ---------------------------------------------------------------------
create table if not exists public.posiciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evento_id text not null references public.eventos(id),
  respuesta text not null check (respuesta in ('si','no')),
  premio_potencial numeric not null,
  capital_en_riesgo numeric not null default 0 check (capital_en_riesgo = 0),
  estado text not null default 'abierta' check (estado in ('abierta','resuelta')),
  resultado text check (resultado in ('gano','no_gano')),
  creada_en timestamptz not null default now(),
  resuelta_en timestamptz
);

alter table public.posiciones enable row level security;

create policy "usuarios ven sus propias posiciones"
  on public.posiciones for select
  using (auth.uid() = user_id);

create policy "usuarios crean sus propias posiciones"
  on public.posiciones for insert
  with check (auth.uid() = user_id);

create policy "usuarios actualizan sus propias posiciones"
  on public.posiciones for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 5. PISO Moment -- Prioridad 7. El dato más importante de la semana.
-- ---------------------------------------------------------------------
create table if not exists public.piso_moment_respuestas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  posicion_id uuid not null references public.posiciones(id) on delete cascade,
  evento_id text not null references public.eventos(id),
  resultado text not null check (resultado in ('gano','no_gano')),
  opcion text not null,
  opcion_otro_texto text,
  creada_en timestamptz not null default now()
);

alter table public.piso_moment_respuestas enable row level security;

create policy "usuarios ven sus propias respuestas"
  on public.piso_moment_respuestas for select
  using (auth.uid() = user_id);

create policy "usuarios crean sus propias respuestas"
  on public.piso_moment_respuestas for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 6. Interés en modo real -- pantalla ModoReal (memo Behavioral, sección 5).
-- Dato 5 del memo: interés orgánico <1.8%, así que el copy tiene que
-- generar la conversión solo. Guardamos el correo aquí, no solo en
-- PostHog, porque esta lista es la que Ventas usa para avisar cuando
-- exista modo real -- no queremos que dependa de exportar analytics.
-- ---------------------------------------------------------------------
create table if not exists public.intereses_modo_real (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  creado_en timestamptz not null default now()
);

alter table public.intereses_modo_real enable row level security;

create policy "usuarios crean su propio interes"
  on public.intereses_modo_real for insert
  with check (auth.uid() = user_id);

create policy "usuarios ven su propio interes"
  on public.intereses_modo_real for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Nota sobre "subir de piso" (Prioridad 4): esta semana no hay lógica de
-- negocio real de ascenso -- se mide la INTENCIÓN (clic en Platino/
-- Obsidiana bloqueados dispara el evento "quiere_subir_piso" en PostHog).
-- La columna perfiles.piso existe para cuando esa lógica sí se construya.
