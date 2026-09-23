-- PISO Core -- Integración Behavioral Forest (D1-D15), parte 2/3.
-- Cubre D8 (guardrails de referidos), D11 (separación de namespace de
-- modelos fase0/producción) y D12 (chequeo de términos prohibidos en
-- contenido). Correr DESPUÉS de 0005_behavioral_capital_riesgo.sql.

-- =======================================================================
-- D8 -- Referidos. Cuatro reglas del memo, todas como regla de BACKEND (no
-- confiar en el cliente para ninguna):
--   1. Single-level: referido_por no se propaga -- es una decisión de
--      esquema, no de código: la columna solo guarda quién te refirió a
--      TI, nunca se lee "el referido de mi referido" en ningún lado.
--   2. Recompensa solo cuando el referido completa su PRIMER evento (no
--      en el signup) -- se dispara dentro de confirmar_posicion(), no en
--      asegurarPerfilYBalanceDemo().
--   3. Monto fijo, nunca %/rango -- una sola columna numeric, sin fórmula.
--   4. Cap mensual por usuario, y CERO leaderboard de "top referidores" --
--      esta migración NO crea ninguna vista ni función de ranking. Si en
--      el futuro alguien pide un leaderboard, es una decisión de producto
--      nueva, no un descuido de esta migración.
-- =======================================================================

alter table public.perfiles
  add column if not exists referido_por uuid references auth.users(id);
  -- Nullable -- la mayoría de usuarios no llega por referido. Se llena una
  -- sola vez (ver vincular_referido() abajo), nunca se reescribe.

create table if not exists public.referidos_config (
  id boolean primary key default true check (id),
  monto_recompensa numeric not null default 100,
  -- Monto FIJO en MXN, memo D8: "fixed reward amount (never %/range)".
  cap_mensual_por_referidor integer not null default 10,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.operadores(user_id)
);

insert into public.referidos_config (id) values (true) on conflict (id) do nothing;

alter table public.referidos_config enable row level security;

create policy "referidos_config lectura pública"
  on public.referidos_config for select
  using (true); -- necesario para que el cliente muestre "invita y gana $X"

create policy "operadores editan referidos_config"
  on public.referidos_config for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create table if not exists public.referidos_recompensas (
  id uuid primary key default gen_random_uuid(),
  referidor_id uuid not null references auth.users(id) on delete cascade,
  referido_id uuid not null references auth.users(id) on delete cascade,
  monto numeric not null,
  creado_en timestamptz not null default now(),
  unique (referido_id) -- un referido solo puede generar UNA recompensa, una vez
);

alter table public.referidos_recompensas enable row level security;

create policy "usuarios ven las recompensas que generaron"
  on public.referidos_recompensas for select
  using (auth.uid() = referidor_id);

-- Sin política de insert para authenticated -- solo escribe
-- procesar_recompensa_referido() (SECURITY DEFINER), nunca un insert
-- directo del cliente, por la misma razón que ledger_movimientos.

-- ---------------------------------------------------------------------
-- vincular_referido -- se llama UNA vez, cuando un usuario nuevo entra con
-- un código de referido. No hay pantalla todavía que capture ese código
-- en el onboarding (Consumer no tiene ese flujo construido) -- se deja
-- explícito aquí, no oculto: esta función es infraestructura lista, pero
-- el enganche de UI (¿de dónde saca el código el nuevo usuario? ¿un link
-- con query param?) es una decisión de Producto/Behavioral pendiente, no
-- de Tecnología. Ver checklist del README.
-- ---------------------------------------------------------------------
create or replace function public.vincular_referido(p_codigo_referidor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ya_tiene uuid;
begin
  if auth.uid() is null then
    raise exception 'vincular_referido requiere sesión activa';
  end if;
  if p_codigo_referidor = auth.uid() then
    raise exception 'no puedes referirte a ti mismo';
  end if;
  if not exists (select 1 from public.perfiles where user_id = p_codigo_referidor) then
    raise exception 'código de referido inválido';
  end if;

  select referido_por into v_ya_tiene from public.perfiles where user_id = auth.uid();
  if v_ya_tiene is not null then
    raise exception 'este usuario ya tiene un referidor asignado';
  end if;

  update public.perfiles set referido_por = p_codigo_referidor where user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- procesar_recompensa_referido -- SOLO se llama internamente, desde dentro
-- de confirmar_posicion() (0005/0007 la reemplaza otra vez para agregar
-- esta llamada), nunca expuesta directo como RPC pública: el disparador
-- ("¿es esta la primera posición del usuario?") lo decide el backend, no
-- un parámetro que el cliente pudiera mandar en falso.
-- ---------------------------------------------------------------------
create or replace function public.procesar_recompensa_referido(p_nuevo_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referidor uuid;
  v_total_posiciones integer;
  v_monto numeric;
  v_cap integer;
  v_recompensas_este_mes integer;
begin
  select referido_por into v_referidor from public.perfiles where user_id = p_nuevo_usuario_id;
  if v_referidor is null then
    return; -- no vino de un referido, nada que hacer
  end if;

  select count(*) into v_total_posiciones from public.posiciones where user_id = p_nuevo_usuario_id;
  if v_total_posiciones <> 1 then
    return; -- regla D8: solo en su PRIMER evento, no en cada uno
  end if;

  if exists (select 1 from public.referidos_recompensas where referido_id = p_nuevo_usuario_id) then
    return; -- ya se pagó (constraint unique lo protegería igual, pero evita el intento)
  end if;

  select monto_recompensa, cap_mensual_por_referidor into v_monto, v_cap from public.referidos_config limit 1;

  select count(*) into v_recompensas_este_mes
  from public.referidos_recompensas
  where referidor_id = v_referidor and creado_en >= date_trunc('month', now());

  if v_recompensas_este_mes >= v_cap then
    return; -- cap mensual alcanzado -- el referido no se entera, no es su culpa
  end if;

  insert into public.referidos_recompensas (referidor_id, referido_id, monto)
  values (v_referidor, p_nuevo_usuario_id, v_monto);

  insert into public.ledger_movimientos (user_id, monto, causa, modo)
  values (v_referidor, v_monto, 'Recompensa por referido -- primer evento completado', 'demo');
end;
$$;

-- =======================================================================
-- D11 -- Separación de namespace fase0/producción. No existe todavía un
-- pipeline de ML real desplegado en este proyecto (el causal forest de
-- D13 es diseño, no código corriendo) -- así que lo que se construye aquí
-- es el registro central y la regla de rechazo, para que el día que exista
-- un pipeline de despliegue real, apunte a ESTA tabla como fuente de
-- verdad en vez de inventar su propia convención de nombres.
-- =======================================================================
create table if not exists public.modelo_registro (
  clave text primary key, -- ej. 'fase0:t1_control', 'produccion:pricing_v2'
  fase text not null check (fase in ('fase0','produccion')),
  apunta_a text, -- clave de otro registro al que este apunta/depende, si aplica
  descripcion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

alter table public.modelo_registro enable row level security;

create policy "modelo_registro lectura para operadores"
  on public.modelo_registro for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores administran modelo_registro"
  on public.modelo_registro for insert
  with check (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores editan modelo_registro"
  on public.modelo_registro for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create or replace function public.validar_namespace_modelo()
returns trigger
language plpgsql
as $$
declare
  v_fase_destino text;
begin
  -- La clave debe empezar con su propia fase -- 'produccion:x' no puede
  -- declararse fase='fase0' ni viceversa. Evita el descuido más simple.
  if new.clave not like new.fase || ':%' then
    raise exception 'D11: la clave "%" no coincide con su fase declarada "%"', new.clave, new.fase;
  end if;

  if new.apunta_a is not null then
    select fase into v_fase_destino from public.modelo_registro where clave = new.apunta_a;
    -- Regla D11, la que más importa: un registro de PRODUCCIÓN nunca
    -- puede apuntar a algo registrado como FASE0. Al revés sí se permite
    -- (fase0 puede apuntar a producción, ej. para comparar contra el
    -- modelo real vigente).
    if new.fase = 'produccion' and v_fase_destino = 'fase0' then
      raise exception 'D11: rechazado a nivel de infraestructura -- un puntero de producción ("%") no puede apuntar a un registro de fase0 ("%")',
        new.clave, new.apunta_a;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_namespace_modelo on public.modelo_registro;
create trigger trg_validar_namespace_modelo
  before insert or update on public.modelo_registro
  for each row execute function public.validar_namespace_modelo();

-- =======================================================================
-- D12 -- Compliance de contenido. Chequeo de términos prohibidos, FLAG
-- para confirmación humana -- memo explícito: "flags for human
-- confirmation, does not yet auto-block". No se integra a ningún
-- pipeline de publicación de anuncios real (no existe uno en este
-- proyecto) -- se integra al único lugar de este sistema donde se publica
-- copy editable: contenido_versionado (0007, D14). Ahí, guardar contenido
-- corre validar_copy() y muestra el aviso, pero SÍ permite guardar --
-- exactamente el alcance que pide D12 para esta fase.
-- =======================================================================
create table if not exists public.terminos_prohibidos (
  termino text primary key,
  motivo text,
  agregado_en timestamptz not null default now()
);

insert into public.terminos_prohibidos (termino, motivo) values
  ('apuesta', 'Dato D10 (panel ENCODAT 2025): framing de riesgo regulatorio SEGOB -- ver D2/D10.'),
  ('apuéstale', 'Misma familia que "apuesta".'),
  ('jugada', 'Framing de juego de azar -- riesgo regulatorio.'),
  ('cuotas', 'Terminología de casas de apuestas deportivas.')
on conflict do nothing;

alter table public.terminos_prohibidos enable row level security;

create policy "terminos_prohibidos lectura para operadores"
  on public.terminos_prohibidos for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores administran terminos_prohibidos"
  on public.terminos_prohibidos for insert
  with check (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create or replace function public.validar_copy(p_texto text)
returns table (termino text, motivo text)
language sql
stable
security definer
set search_path = public
as $$
  select tp.termino, tp.motivo
  from public.terminos_prohibidos tp
  where p_texto ilike '%' || tp.termino || '%';
$$;

comment on function public.validar_copy is
  'D12: devuelve los términos prohibidos encontrados en el texto, para mostrarlos como AVISO en /admin/contenido. No bloquea el guardado -- ver nota D12 arriba.';

-- ---------------------------------------------------------------------
-- confirmar_posicion -- tercera versión de esta función en el repo (0002
-- la creó, 0005 la extendió con kill switch/racha/piso, esta la extiende
-- una vez más solo para llamar procesar_recompensa_referido() al final).
-- Se reescribe completa (no solo un trigger aparte) a propósito: mantener
-- toda la lógica de "qué pasa cuando alguien confirma una posición" en un
-- solo lugar es más fácil de auditar que repartirla en triggers ocultos
-- sobre la tabla posiciones.
-- ---------------------------------------------------------------------
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

  update public.perfiles
    set racha_actual = racha_actual + 1,
        racha_actualizada_en = now(),
        volumen_depositado_acumulado = volumen_depositado_acumulado + coalesce(v_ticket, 0)
    where user_id = auth.uid();

  perform public.recalcular_piso(auth.uid());

  -- D8: solo tiene efecto si esta resulta ser la PRIMERA posición del
  -- usuario Y tiene un referidor asignado -- la función misma valida
  -- ambas cosas, aquí solo se llama siempre, sin condición previa.
  perform public.procesar_recompensa_referido(auth.uid());

  return v_posicion;
end;
$$;
