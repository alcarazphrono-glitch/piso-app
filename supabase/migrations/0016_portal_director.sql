-- PISO — Portal del director (/director)
-- =====================================================================
-- Correr DESPUÉS de 0002 (necesita operadores). No depende de 0011-0015:
-- si esas migraciones todavía no están corridas, el portal lo dice en vez
-- de fallar, y lo que toca de ellas (cuota_evento, economia_parametros)
-- se activa solo cuando existan.
--
-- Qué agrega:
--   1. director_correos        -- correos con acceso de director. Solo el
--                                 dueño de ese correo (confirmado) entra.
--   2. es_director()           -- la única verificación de acceso.
--   3. director_activar()      -- al entrar, registra al director como
--                                 operador para que /admin y /consola le abran.
--   4. decisiones              -- bitácora: qué, por qué, qué esperamos,
--                                 y después qué pasó. Una decisión puede
--                                 traer un CAMBIO EN LA APP (precio, N,
--                                 días, cuota, palancas de Finanzas).
--   5. director_parametros()   -- lo que hoy tiene la app y se puede cambiar.
--   6. decidir()               -- aprobar (y aplicar el cambio a la app) o
--                                 rechazar una decisión propuesta.
--   7. director_estado()       -- foto en vivo de la empresa.
--
-- El portal no calcula economía: márgenes y LTV salen del modelo único de
-- Finanzas (0014, /consola/palancas). Aquí solo se cuentan hechos y se
-- cambian parámetros que ese modelo ya lee.

-- ---------------------------------------------------------------------
-- 1. Correos con acceso de director
-- ---------------------------------------------------------------------
create table if not exists public.director_correos (
  email text primary key check (email = lower(trim(email))),
  creado_en timestamptz not null default now()
);

alter table public.director_correos enable row level security;
-- Sin políticas: nadie la lee desde el navegador. Solo es_director() la usa.

insert into public.director_correos (email) values ('aalcaraz.beto@gmail.com')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. es_director()
-- ---------------------------------------------------------------------
-- Exige correo confirmado: así nadie se registra con el correo del
-- director para colarse.
create or replace function public.es_director()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from auth.users u
      join public.director_correos d on d.email = lower(u.email)
     where u.id = auth.uid()
       and u.email_confirmed_at is not null
  );
$$;

grant execute on function public.es_director() to authenticated;

-- ---------------------------------------------------------------------
-- 3. director_activar()
-- ---------------------------------------------------------------------
create or replace function public.director_activar()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_director() then
    return false;
  end if;
  insert into public.operadores (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end;
$$;

grant execute on function public.director_activar() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Bitácora de decisiones
-- ---------------------------------------------------------------------
-- Estados:
--   propuesta  -> la propone un departamento o un agente (Claude); espera
--                 que el director la apruebe o la rechace.
--   abierta    -> aprobada; si traía cambio, ya se aplicó a la app.
--                 Se está midiendo.
--   revisada   -> ya se anotó qué pasó de verdad y qué aprendimos.
--   descartada -> rechazada o abandonada. No se borra: también enseña.
create table if not exists public.decisiones (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  departamento text not null default 'direccion'
    check (departamento in ('direccion','tecnologia','finanzas','behavioral','legal','mesa','marketing')),
  por_que text not null default '',
  resultado_esperado text not null default '',
  como_medir text not null default '',
  revisar_el date,
  estado text not null default 'abierta' check (estado in ('propuesta','abierta','revisada','descartada')),
  propuesta_por text not null default 'director', -- 'director', 'claude', o el nombre del agente/departamento

  -- Cambio en la app (opcional): {"tabla":"productos","clave":"entrada","campo":"precio","valor":600}
  -- o {"tabla":"economia_parametros","campo":"cac_mxn","valor":80}
  cambio jsonb,
  cambio_antes jsonb,
  aplicado_en timestamptz,

  resultado_real text,
  aprendizaje text,
  salio_como_esperabamos text check (salio_como_esperabamos in ('si','parcial','no')),
  decidido_por uuid references auth.users(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  decidido_en timestamptz,
  revisado_en timestamptz
);

create index if not exists decisiones_creado_en on public.decisiones (creado_en desc);

alter table public.decisiones enable row level security;

drop policy if exists "director lee decisiones" on public.decisiones;
create policy "director lee decisiones"
  on public.decisiones for select
  using (public.es_director());

-- El director crea decisiones; los agentes las crean con la service role
-- (estado 'propuesta'). El cambio a la app NUNCA se aplica con un insert o
-- update directo: solo con decidir(), que valida y guarda el antes.
drop policy if exists "director crea decisiones" on public.decisiones;
create policy "director crea decisiones"
  on public.decisiones for insert
  with check (public.es_director() and aplicado_en is null and cambio_antes is null);

drop policy if exists "director actualiza decisiones" on public.decisiones;
create policy "director actualiza decisiones"
  on public.decisiones for update
  using (public.es_director())
  with check (public.es_director());

-- Columnas que el navegador NO puede tocar en un update (las escribe decidir()).
revoke update on public.decisiones from authenticated;
grant update (titulo, departamento, por_que, resultado_esperado, como_medir, revisar_el,
              resultado_real, aprendizaje, salio_como_esperabamos, revisado_en)
  on public.decisiones to authenticated;

-- Para revisar o descartar sin pasar por decidir() basta cambiar el estado
-- de abierta a revisada/descartada; eso va por director_cerrar().

-- Decisiones ya tomadas por Beto (2026-10-03), para que la bitácora no
-- arranque vacía. Quedan abiertas para escribirles el resultado real.
insert into public.decisiones (titulo, departamento, por_que, resultado_esperado, como_medir, decidido_por, creado_en, decidido_en)
select v.titulo, v.departamento, v.por_que, v.resultado_esperado, v.como_medir, null, v.creado_en, v.creado_en from (values
  ('Premio por sorteo entre quienes aciertan; bote con tope de 3 ciclos', 'direccion',
   'Un premio grande y claro atrae más que repartir poco entre muchos; el tope evita un bote infinito.',
   'Más boletos por ciclo que con premio repartido.',
   'Boletos por ciclo y tasa de recompra después de fallar.', '2026-10-03'::timestamptz),
  ('Premio = rendimiento del pool + bote. PISO nunca pone de su bolsa', 'finanzas',
   'El capital del usuario queda 100% protegido y PISO no asume riesgo de pagar premios.',
   'Margen positivo en cada ciclo sin importar quién gane.',
   'Contribución por ciclo en /consola/palancas.', '2026-10-03'::timestamptz),
  ('Home solo con Boletos; app lista para 50,000 usuarios antes de El Reto', 'tecnologia',
   'Una sola acción clara en la entrada; no lanzar El Reto con una app a medias.',
   'Mayor conversión de registro a primer boleto.',
   'Embudo registro → primer boleto en PostHog.', '2026-10-03'::timestamptz),
  ('A quien falla se le recomienda otro evento por interés, nunca "recupera lo perdido"', 'behavioral',
   'Legal: evitar mensajes que empujen a perseguir pérdidas.',
   'Recompra sana sin señales de juego problemático.',
   'Recompra después de fallar y quejas/bajas.', '2026-10-03'::timestamptz)
) as v(titulo, departamento, por_que, resultado_esperado, como_medir, creado_en)
where not exists (select 1 from public.decisiones);

-- ---------------------------------------------------------------------
-- 5. director_parametros() -- lo que hoy tiene la app y se puede cambiar
-- ---------------------------------------------------------------------
-- Lista blanca: solo estos campos se pueden cambiar desde una decisión.
-- Si la columna no existe todavía (0014 sin correr), simplemente no sale.
create or replace function public.director_campo_permitido(p_tabla text, p_campo text)
returns boolean
language sql
immutable
as $$
  select (p_tabla = 'productos' and p_campo in ('precio','gente_requerida','dias_resolucion','cuota_evento','alpha_em','activo'))
      or (p_tabla = 'economia_parametros' and p_campo not in ('id','actualizado_en','actualizado_por'));
$$;

create or replace function public.director_parametros()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_productos jsonb;
  v_economia jsonb;
begin
  if not public.es_director() then
    raise exception 'solo el director puede ver esto';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.precio), '[]'::jsonb) into v_productos from public.productos p;

  if to_regclass('public.economia_parametros') is not null then
    execute 'select to_jsonb(e) - ''id'' - ''actualizado_en'' - ''actualizado_por'' from public.economia_parametros e limit 1'
      into v_economia;
  end if;

  return jsonb_build_object('productos', v_productos, 'economia', v_economia);
end;
$$;

grant execute on function public.director_parametros() to authenticated;

-- ---------------------------------------------------------------------
-- 6. decidir() -- aprobar (y aplicar) o rechazar
-- ---------------------------------------------------------------------
create or replace function public.decidir(p_id uuid, p_aprobar boolean)
returns public.decisiones
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.decisiones;
  v_tabla text;
  v_campo text;
  v_clave text;
  v_tipo text;
  v_antes jsonb;
begin
  if not public.es_director() then
    raise exception 'solo el director puede decidir';
  end if;

  select * into d from public.decisiones where id = p_id for update;
  if d.id is null then
    raise exception 'la decisión no existe';
  end if;
  if d.estado <> 'propuesta' then
    raise exception 'esta decisión ya no está pendiente (estado %)', d.estado;
  end if;

  if not p_aprobar then
    update public.decisiones
       set estado = 'descartada', decidido_por = auth.uid(), decidido_en = now()
     where id = p_id returning * into d;
    return d;
  end if;

  if d.cambio is not null then
    v_tabla := d.cambio->>'tabla';
    v_campo := d.cambio->>'campo';
    v_clave := d.cambio->>'clave';

    if not public.director_campo_permitido(v_tabla, v_campo) then
      raise exception 'ese cambio no está permitido desde el portal (%.%)', v_tabla, v_campo;
    end if;

    select data_type into v_tipo
      from information_schema.columns
     where table_schema = 'public' and table_name = v_tabla and column_name = v_campo;
    if v_tipo is null then
      raise exception 'la columna %.% no existe en esta base (¿falta correr una migración?)', v_tabla, v_campo;
    end if;
    if v_tipo not in ('numeric','integer','boolean') then
      raise exception 'solo se pueden cambiar números o sí/no';
    end if;

    -- El director también queda como operador: los triggers de auditoría
    -- de productos/economía guardan quién cambió (FK a operadores).
    insert into public.operadores (user_id) values (auth.uid()) on conflict do nothing;

    if v_tabla = 'productos' then
      execute format('select to_jsonb(%I) from public.productos where clave = $1', v_campo) into v_antes using v_clave;
      if v_antes is null and not exists (select 1 from public.productos where clave = v_clave) then
        raise exception 'el nivel % no existe', v_clave;
      end if;
      execute format('update public.productos set %I = ($1->>''valor'')::%s, actualizado_en = now(), actualizado_por = auth.uid() where clave = $2',
                     v_campo, v_tipo)
        using d.cambio, v_clave;
    else
      execute format('select to_jsonb(%I) from public.economia_parametros limit 1', v_campo) into v_antes;
      execute format('update public.economia_parametros set %I = ($1->>''valor'')::%s', v_campo, v_tipo)
        using d.cambio;
    end if;
  end if;

  update public.decisiones
     set estado = 'abierta',
         cambio_antes = case when d.cambio is null then null else jsonb_build_object('valor', v_antes) end,
         aplicado_en = case when d.cambio is null then null else now() end,
         decidido_por = auth.uid(),
         decidido_en = now()
   where id = p_id returning * into d;
  return d;
end;
$$;

grant execute on function public.decidir(uuid, boolean) to authenticated;

-- Cerrar una decisión abierta: con resultado (revisada) o sin él (descartada).
create or replace function public.director_cerrar(p_id uuid, p_estado text)
returns public.decisiones
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.decisiones;
begin
  if not public.es_director() then
    raise exception 'solo el director puede cerrar decisiones';
  end if;
  if p_estado not in ('revisada','descartada') then
    raise exception 'estado inválido';
  end if;
  update public.decisiones
     set estado = p_estado, revisado_en = now()
   where id = p_id and estado = 'abierta'
  returning * into d;
  if d.id is null then
    raise exception 'solo se cierran decisiones abiertas';
  end if;
  return d;
end;
$$;

grant execute on function public.director_cerrar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. director_estado() -- foto en vivo
-- ---------------------------------------------------------------------
-- Lee tablas de otras migraciones (0011-0014) solo si existen, con
-- to_regclass + execute, para que funcione en cualquier orden de merge y
-- además muestre qué partes de la infraestructura faltan.
create or replace function public.director_estado()
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
  if not public.es_director() then
    raise exception 'solo el director puede ver este portal';
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

  select count(*) into n from public.decisiones where estado = 'propuesta';
  v := v || jsonb_build_object('decisiones_propuestas', n);
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

grant execute on function public.director_estado() to authenticated;
