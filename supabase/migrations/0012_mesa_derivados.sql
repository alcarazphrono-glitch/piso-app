-- PISO -- Mesa de derivados: analistas (agentes) → mesa (humano) → riesgo → app
-- =======================================================================
-- Correr DESPUÉS de 0011. No toca ninguna tabla ni función existente:
-- solo agrega tablas mesa_* y funciones mesa_*, y al publicar escribe en
-- eventos/ciclos por los mismos caminos que ya usa /admin (insert en
-- eventos + abrir_ciclo()).
--
-- Qué resuelve, en una frase: hoy un evento nace a mano en /admin/eventos
-- con una probabilidad que alguien escribe. Después de esto, un agente
-- analista propone el evento con su base estocástica (modelo, datos,
-- probabilidad con intervalo) y su estructura de payoff por nivel; un
-- humano lo acepta (filtro humano), Riesgo le pone límite de exposición,
-- y solo entonces se publica en la app. Cada paso queda en bitácora.
--
-- Escritura: los agentes escriben con la service role (servidor, nunca el
-- navegador). Las decisiones humanas entran SOLO por las funciones
-- mesa_decidir_analista / mesa_decidir_riesgo / mesa_publicar (SECURITY
-- DEFINER, gateadas a operadores). Ningún insert/update directo desde el
-- cliente sobre propuestas ni bitácora.

-- ---------------------------------------------------------------------
-- 1. Config de la mesa
-- ---------------------------------------------------------------------
create table if not exists public.mesa_config (
  id boolean primary key default true check (id),
  -- Cuatro ojos: quien acepta una propuesta como analista no puede ser
  -- quien la aprueba en Riesgo. Apagado por default porque hoy hay un
  -- solo operador; prenderlo en cuanto haya equipo.
  cuatro_ojos boolean not null default false,
  actualizado_en timestamptz not null default now()
);

insert into public.mesa_config (id) values (true) on conflict (id) do nothing;

alter table public.mesa_config enable row level security;

create policy "operadores leen mesa_config"
  on public.mesa_config for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores editan mesa_config"
  on public.mesa_config for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 2. Analistas -- cada uno es un agente con un mercado y un modelo.
-- config guarda parámetros que el humano ajusta sin código (p. ej. la
-- fecha de la próxima decisión de Banxico).
-- ---------------------------------------------------------------------
create table if not exists public.mesa_analistas (
  clave text primary key,
  nombre text not null,
  mercado text not null,
  modelo_estocastico text not null,
  descripcion text not null default '',
  config jsonb not null default '{}'::jsonb,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

insert into public.mesa_analistas (clave, nombre, mercado, modelo_estocastico, descripcion, config) values
  ('tasas', 'Analista de Tasas', 'Tasa objetivo Banxico',
   'Beta-Binomial',
   'Frecuencia de recortes en los últimos 12 meses (8 decisiones/año) como posterior Beta(1+recortes, 1+no recortes). Datos: Banxico SIE SF61745.',
   '{"proxima_decision": null}'::jsonb),
  ('inflacion', 'Analista de Inflación', 'INPC anual (INEGI)',
   'Caminata aleatoria normal',
   'Cambio mensual de la inflación anual ~ Normal(μ, σ) estimado con 24 meses. P(inflación < umbral) = Φ((umbral − π − μ)/σ). Datos: INEGI BIE, INPC general.',
   '{}'::jsonb),
  ('fx', 'Analista de Tipo de Cambio', 'USD/MXN FIX',
   'Movimiento browniano geométrico',
   'Rendimientos log diarios de 250 días; P(S_T > K) = Φ(d2) sin drift. Intervalo por incertidumbre de σ (χ²). Datos: Banxico SIE SF43718.',
   '{}'::jsonb)
on conflict (clave) do nothing;

alter table public.mesa_analistas enable row level security;

create policy "operadores leen mesa_analistas"
  on public.mesa_analistas for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores editan mesa_analistas"
  on public.mesa_analistas for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 3. Corridas -- cada vez que los agentes trabajan (cron o botón).
-- ---------------------------------------------------------------------
create table if not exists public.mesa_corridas (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('cron', 'manual')),
  iniciada_por uuid references public.operadores(user_id),
  iniciada_en timestamptz not null default now(),
  terminada_en timestamptz,
  propuestas_creadas integer not null default 0,
  resultado jsonb not null default '[]'::jsonb -- un renglón por analista: ok / sin datos / error
);

alter table public.mesa_corridas enable row level security;

create policy "operadores leen mesa_corridas"
  on public.mesa_corridas for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 4. Propuestas -- el hallazgo de un analista.
--   pendiente → aceptada (mesa) → aprobada_riesgo → publicada
--   cualquiera de las primeras tres → rechazada
-- ---------------------------------------------------------------------
create table if not exists public.mesa_propuestas (
  id uuid primary key default gen_random_uuid(),
  analista_clave text not null references public.mesa_analistas(clave),
  corrida_id uuid references public.mesa_corridas(id),

  -- El evento tal como lo vería el usuario
  titulo text not null,
  pregunta text not null,
  descripcion_usuario text not null default '',
  categoria text not null default 'macro',
  fuente_resolucion text not null,
  fecha_resolucion timestamptz not null,
  fecha_texto text not null default '',

  -- Base estocástica (la calcula código, no el LLM)
  modelo_estocastico text not null,
  probabilidad numeric not null check (probabilidad > 0 and probabilidad < 1),
  prob_baja numeric check (prob_baja is null or (prob_baja >= 0 and prob_baja <= 1)),
  prob_alta numeric check (prob_alta is null or (prob_alta >= 0 and prob_alta <= 1)),
  parametros jsonb not null default '{}'::jsonb,
  datos jsonb not null default '{}'::jsonb, -- snapshot de lo que se leyó (últimos valores, n, url)

  -- Lectura del analista (redacta Claude sobre los números ya calculados)
  tesis text not null default '',
  riesgos text not null default '',

  -- Payoff por nivel (fórmula de Finanzas de 0010) + nivel sugerido
  payoff jsonb not null default '{}'::jsonb,
  producto_sugerido text references public.productos(clave),

  -- Flujo
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aceptada', 'aprobada_riesgo', 'publicada', 'rechazada')),
  revisado_por uuid references public.operadores(user_id),
  revisado_en timestamptz,
  nota_revision text,
  riesgo_por uuid references public.operadores(user_id),
  riesgo_en timestamptz,
  nota_riesgo text,
  limite_exposicion_mxn numeric check (limite_exposicion_mxn is null or limite_exposicion_mxn > 0),
  publicado_por uuid references public.operadores(user_id),
  publicado_en timestamptz,
  evento_id text references public.eventos(id),
  ciclo_id uuid references public.ciclos(id),

  creado_en timestamptz not null default now()
);

-- Un agente que corre todos los días no debe llenar la bandeja con la
-- misma pregunta: solo una viva por (analista, pregunta).
create unique index if not exists mesa_propuestas_una_viva
  on public.mesa_propuestas (analista_clave, pregunta)
  where estado in ('pendiente', 'aceptada', 'aprobada_riesgo');

create index if not exists mesa_propuestas_estado on public.mesa_propuestas (estado, creado_en desc);

alter table public.mesa_propuestas enable row level security;

create policy "operadores leen mesa_propuestas"
  on public.mesa_propuestas for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 5. Bitácora -- append-only, cada decisión con quién y por qué.
-- ---------------------------------------------------------------------
create table if not exists public.mesa_bitacora (
  id uuid primary key default gen_random_uuid(),
  propuesta_id uuid references public.mesa_propuestas(id),
  accion text not null,
  actor uuid references public.operadores(user_id), -- null = agente
  nota text,
  creado_en timestamptz not null default now()
);

alter table public.mesa_bitacora enable row level security;

create policy "operadores leen mesa_bitacora"
  on public.mesa_bitacora for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create or replace function public.mesa_bitacora_inmutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'mesa_bitacora es append-only';
end;
$$;

drop trigger if exists mesa_bitacora_sin_cambios on public.mesa_bitacora;
create trigger mesa_bitacora_sin_cambios
  before update or delete on public.mesa_bitacora
  for each row execute function public.mesa_bitacora_inmutable();

-- ---------------------------------------------------------------------
-- 6. Decisión de la mesa (filtro humano)
-- ---------------------------------------------------------------------
create or replace function public.mesa_decidir_analista(p_propuesta_id uuid, p_aceptar boolean, p_nota text default null)
returns public.mesa_propuestas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop public.mesa_propuestas;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  select * into v_prop from public.mesa_propuestas where id = p_propuesta_id for update;
  if v_prop.id is null then
    raise exception 'propuesta % no existe', p_propuesta_id;
  end if;
  if v_prop.estado <> 'pendiente' then
    raise exception 'la propuesta ya no está pendiente (estado: %)', v_prop.estado;
  end if;
  if not p_aceptar and coalesce(trim(p_nota), '') = '' then
    raise exception 'para rechazar escribe el motivo';
  end if;

  update public.mesa_propuestas set
    estado = case when p_aceptar then 'aceptada' else 'rechazada' end,
    revisado_por = auth.uid(),
    revisado_en = now(),
    nota_revision = p_nota
  where id = p_propuesta_id
  returning * into v_prop;

  insert into public.mesa_bitacora (propuesta_id, accion, actor, nota)
  values (p_propuesta_id, case when p_aceptar then 'mesa_acepta' else 'mesa_rechaza' end, auth.uid(), p_nota);

  return v_prop;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Decisión de Riesgo -- aprobar exige un límite de exposición, y se
-- niega si el kill switch global (0010) ya está activo.
-- ---------------------------------------------------------------------
create or replace function public.mesa_decidir_riesgo(
  p_propuesta_id uuid,
  p_aprobar boolean,
  p_limite_mxn numeric default null,
  p_nota text default null
)
returns public.mesa_propuestas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop public.mesa_propuestas;
  v_cuatro_ojos boolean;
  v_kill boolean;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  select * into v_prop from public.mesa_propuestas where id = p_propuesta_id for update;
  if v_prop.id is null then
    raise exception 'propuesta % no existe', p_propuesta_id;
  end if;
  if v_prop.estado <> 'aceptada' then
    raise exception 'Riesgo solo revisa propuestas aceptadas por la mesa (estado: %)', v_prop.estado;
  end if;

  select cuatro_ojos into v_cuatro_ojos from public.mesa_config limit 1;
  if coalesce(v_cuatro_ojos, false) and v_prop.revisado_por = auth.uid() then
    raise exception 'cuatro ojos: quien aceptó la propuesta no puede aprobarla en Riesgo';
  end if;

  if p_aprobar then
    if p_limite_mxn is null or p_limite_mxn <= 0 then
      raise exception 'para aprobar pon un límite de exposición en MXN';
    end if;
    select kill_switch_activo into v_kill from public.calcular_exposicion_global();
    if coalesce(v_kill, false) then
      raise exception 'kill switch global activo: la exposición ya pasó el umbral de la reserva fondeada';
    end if;
  elsif coalesce(trim(p_nota), '') = '' then
    raise exception 'para rechazar escribe el motivo';
  end if;

  update public.mesa_propuestas set
    estado = case when p_aprobar then 'aprobada_riesgo' else 'rechazada' end,
    riesgo_por = auth.uid(),
    riesgo_en = now(),
    nota_riesgo = p_nota,
    limite_exposicion_mxn = case when p_aprobar then p_limite_mxn else null end
  where id = p_propuesta_id
  returning * into v_prop;

  insert into public.mesa_bitacora (propuesta_id, accion, actor, nota)
  values (p_propuesta_id,
          case when p_aprobar then 'riesgo_aprueba' else 'riesgo_rechaza' end,
          auth.uid(),
          case when p_aprobar then concat('límite $', p_limite_mxn, coalesce(' -- ' || p_nota, '')) else p_nota end);

  return v_prop;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Publicar -- crea el evento (abierto, con el límite de Riesgo como
-- kill switch por evento) y abre el ciclo del nivel elegido.
--
-- Regla de ventana: el evento debe resolverse DESPUÉS de que cierre la
-- venta del ciclo (now + días del nivel), para que nadie compre un boleto
-- sabiendo ya el resultado, y a más tardar 7 días después, para no
-- retener el capital más de lo prometido.
-- ---------------------------------------------------------------------
create or replace function public.mesa_publicar(p_propuesta_id uuid, p_producto_clave text)
returns public.mesa_propuestas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop public.mesa_propuestas;
  v_dias integer;
  v_evento_id text;
  v_ciclo public.ciclos;
  v_prohibidos text;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  select * into v_prop from public.mesa_propuestas where id = p_propuesta_id for update;
  if v_prop.id is null then
    raise exception 'propuesta % no existe', p_propuesta_id;
  end if;
  if v_prop.estado <> 'aprobada_riesgo' then
    raise exception 'solo se publica lo aprobado por Riesgo (estado: %)', v_prop.estado;
  end if;

  select dias_resolucion into v_dias from public.productos where clave = p_producto_clave and activo;
  if v_dias is null then
    raise exception 'nivel % no existe o no está activo', p_producto_clave;
  end if;

  if v_prop.fecha_resolucion < now() + (v_dias || ' days')::interval then
    raise exception 'el evento se resuelve antes de que cierre la venta del nivel % (% días): se podría comprar sabiendo el resultado', p_producto_clave, v_dias;
  end if;
  if v_prop.fecha_resolucion > now() + ((v_dias + 7) || ' days')::interval then
    raise exception 'el evento se resuelve más de 7 días después de que termina el nivel % (% días)', p_producto_clave, v_dias;
  end if;

  select string_agg(termino, ', ') into v_prohibidos
    from public.validar_copy(v_prop.titulo || ' ' || v_prop.pregunta || ' ' || v_prop.descripcion_usuario);
  if v_prohibidos is not null then
    raise exception 'el copy usa términos prohibidos: %', v_prohibidos;
  end if;

  v_evento_id := 'mesa_' || v_prop.analista_clave || '_' || to_char(now(), 'YYYYMMDD') || '_' || substr(v_prop.id::text, 1, 6);

  insert into public.eventos (
    id, nombre, probabilidad, activo, categoria, descripcion, pregunta,
    fuente_resolucion, estado, fecha_apertura, fecha_cierre,
    explicacion_1, explicacion_2, fecha_texto, fecha_contexto,
    exposure_limite_mxn, creado_por
  ) values (
    v_evento_id, v_prop.titulo, v_prop.probabilidad, true, v_prop.categoria,
    v_prop.descripcion_usuario, v_prop.pregunta,
    v_prop.fuente_resolucion, 'abierto', now(), v_prop.fecha_resolucion,
    v_prop.descripcion_usuario, '', v_prop.fecha_texto, v_prop.fuente_resolucion,
    v_prop.limite_exposicion_mxn, auth.uid()
  );

  v_ciclo := public.abrir_ciclo(p_producto_clave, v_evento_id);

  update public.mesa_propuestas set
    estado = 'publicada',
    publicado_por = auth.uid(),
    publicado_en = now(),
    evento_id = v_evento_id,
    ciclo_id = v_ciclo.id
  where id = p_propuesta_id
  returning * into v_prop;

  insert into public.mesa_bitacora (propuesta_id, accion, actor, nota)
  values (p_propuesta_id, 'publicada', auth.uid(), concat('evento ', v_evento_id, ', nivel ', p_producto_clave));

  return v_prop;
end;
$$;

revoke execute on function public.mesa_decidir_analista(uuid, boolean, text) from public, anon;
revoke execute on function public.mesa_decidir_riesgo(uuid, boolean, numeric, text) from public, anon;
revoke execute on function public.mesa_publicar(uuid, text) from public, anon;
grant execute on function public.mesa_decidir_analista(uuid, boolean, text) to authenticated;
grant execute on function public.mesa_decidir_riesgo(uuid, boolean, numeric, text) to authenticated;
grant execute on function public.mesa_publicar(uuid, text) to authenticated;
