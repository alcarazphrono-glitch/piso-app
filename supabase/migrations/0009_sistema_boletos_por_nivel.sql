-- PISO -- Sistema de boletos por nivel (Entrada/Crecimiento/Elite).
-- =====================================================================
-- Especificación entregada por Finanzas el 23-sep-2026 ("Especificación
-- financiera — Sistema de boletos PISO", revisada con Behavioral),
-- integrada aquí. Reemplaza el modelo de un solo ticket plano ($500,
-- TICKET_DEMO_MXN) como el producto que se lanza -- el modelo anterior
-- (eventos/posiciones, migraciones 0002-0008) NO se borra: sigue siendo
-- infraestructura válida y las tablas nuevas de aquí reutilizan su
-- ledger, su racha, su progresión de piso y su motor de referidos en vez
-- de duplicarlos.
--
-- NOTA DE RIESGO REGULATORIO -- decisión de negocio, no de Tecnología:
-- la resolución de un ciclo (migración 0010, resolver_ciclo()) incluye un
-- SORTEO server-side entre quienes acertaron la predicción -- un premio,
-- un ganador. Esto es, estructuralmente, un componente de rifa/sorteo, lo
-- cual cae bajo la Ley Federal de Juegos y Sorteos (SEGOB) de forma más
-- directa que el modelo de predicción individual que exist{'i'}a antes. La
-- decisión D2 del memo de Behavioral Forest (17-sep-2026) se construyó
-- explícitamente como la defensa regulatoria contra justamente esto --
-- "resolución nunca por RNG, siempre resultado real". El sorteo aquí SÍ
-- usa RNG, pero solo para elegir AL GANADOR entre quienes ya acertaron un
-- resultado real y verificable -- nunca para decidir el resultado del
-- evento en sí (eso lo sigue confirmando un operador a mano, igual que
-- resolver_evento()). Aun con esa distinción, se le hizo saber
-- explícitamente a Dirección General que esto se aparta de la defensa D2
-- y que construirlo así fue una decisión suya, tomada con el riesgo
-- conocido -- no una omisión de Tecnología. Ver README.
--
-- Correr DESPUÉS de 0008_hardening_rls_y_limite_posiciones.sql.

-- ---------------------------------------------------------------------
-- 1. Productos -- los 3 niveles. Los números de "gente_requerida" vienen
-- etiquetados como Estimado en el documento de Finanzas -- se guardan
-- editables, no hardcodeados en el cliente.
-- ---------------------------------------------------------------------
create table if not exists public.productos (
  clave text primary key check (clave in ('entrada','crecimiento','elite')),
  nombre text not null,
  precio numeric not null,
  gente_requerida integer not null,
  dias_resolucion integer not null,
  alpha_em numeric, -- fracción (0.25 = 25%), pendiente de Finanzas -- ver 0010 para la fórmula real
  premio_estatico numeric not null, -- número de la tabla de Finanzas, visible mientras alpha_em/tasa_cetes no estén llenos
  activo boolean not null default true,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.operadores(user_id)
);

insert into public.productos (clave, nombre, precio, gente_requerida, dias_resolucion, premio_estatico) values
  ('entrada', 'Entrada', 500, 5000, 20, 30470),
  ('crecimiento', 'Crecimiento', 3000, 1500, 12, 50270),
  ('elite', 'Elite', 15000, 300, 6, 148000)
on conflict (clave) do nothing;

alter table public.productos enable row level security;

create policy "productos lectura pública"
  on public.productos for select
  using (true);

create policy "operadores editan productos"
  on public.productos for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- Carry escalonado (sección 2 del memo: "12% / 20% / 30% según el tamaño
-- del premio dentro de su propio nivel"). El memo no da los cortes
-- exactos -- se deja como tabla editable, sembrada con un corte de
-- ejemplo (terciles) marcado explícitamente como estimado.
create table if not exists public.producto_carry_tramos (
  id uuid primary key default gen_random_uuid(),
  producto_clave text not null references public.productos(clave),
  orden integer not null,
  premio_hasta numeric, -- null = sin tope, es el tramo más alto
  carry_pct numeric not null,
  unique (producto_clave, orden)
);

insert into public.producto_carry_tramos (producto_clave, orden, premio_hasta, carry_pct) values
  ('entrada', 1, 20000, 12), ('entrada', 2, 30000, 20), ('entrada', 3, null, 30),
  ('crecimiento', 1, 35000, 12), ('crecimiento', 2, 50000, 20), ('crecimiento', 3, null, 30),
  ('elite', 1, 100000, 12), ('elite', 2, 150000, 20), ('elite', 3, null, 30)
on conflict (producto_clave, orden) do nothing;

comment on table public.producto_carry_tramos is
  'ESTIMADO -- Finanzas dio los tres porcentajes (12/20/30) pero no los cortes de premio exactos. Sembrado con terciles de ejemplo sobre el premio_estatico de cada nivel -- pendiente de que Finanzas confirme los cortes reales antes de tratarlos como definitivos.';

alter table public.producto_carry_tramos enable row level security;

create policy "producto_carry_tramos lectura pública"
  on public.producto_carry_tramos for select
  using (true);

create policy "operadores editan producto_carry_tramos"
  on public.producto_carry_tramos for all
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 2. Ciclos -- una instancia de un producto, ligada a un evento real
-- (mismo catálogo `eventos` que ya existe -- reutiliza probabilidad,
-- fuente de resolución, etc.). "Hasta que se llena, se juega": la fecha
-- de resolución se fija desde el día 1 (fecha_inicio + dias_resolucion) y
-- NO se mueve si se llena antes -- llenarse antes solo significa que el
-- capital pasa más tiempo generando rendimiento real antes del pago.
-- ---------------------------------------------------------------------
create table if not exists public.ciclos (
  id uuid primary key default gen_random_uuid(),
  producto_clave text not null references public.productos(clave),
  evento_id text not null references public.eventos(id),
  lugares_ocupados integer not null default 0,
  estado text not null default 'llenando' check (estado in ('llenando','lleno','resuelto','cancelado')),
  fecha_inicio timestamptz not null default now(),
  fecha_resolucion timestamptz not null, -- fija desde la creación -- ver comentario arriba
  fecha_llenado timestamptz, -- cuándo alcanzó el aforo, si aplica -- informativo, no mueve fecha_resolucion
  bono_bienvenida_activado boolean not null default false, -- ver 0010, sección 3 del memo
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table public.ciclos enable row level security;

create policy "ciclos lectura pública"
  on public.ciclos for select
  using (true); -- barra de progreso pública, mismo espíritu que eventos

-- Sin insert/update para authenticated -- solo abrir_ciclo()/comprar_boleto()/
-- resolver_ciclo() (todas SECURITY DEFINER), nunca un insert/update directo.

create or replace function public.abrir_ciclo(p_producto_clave text, p_evento_id text)
returns public.ciclos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dias integer;
  v_ciclo public.ciclos;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  select dias_resolucion into v_dias from public.productos where clave = p_producto_clave and activo;
  if v_dias is null then
    raise exception 'producto % no existe o no está activo', p_producto_clave;
  end if;

  if not exists (select 1 from public.eventos where id = p_evento_id) then
    raise exception 'evento % no existe', p_evento_id;
  end if;

  insert into public.ciclos (producto_clave, evento_id, fecha_resolucion)
  values (p_producto_clave, p_evento_id, now() + (v_dias || ' days')::interval)
  returning * into v_ciclo;

  return v_ciclo;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Boletos -- un lugar comprado por un usuario dentro de un ciclo. A
-- diferencia de `posiciones` (donde capital_en_riesgo siempre es 0 y
-- nunca se debita nada), aquí SÍ se debita el precio del producto al
-- comprar -- el memo de Finanzas es explícito en que el depósito "entra
-- al pool" (sección 5, movimiento 1) y se regresa completo al resolver
-- (sección 1) -- la protección de capital sigue siendo el principio, pero
-- ahora se sostiene devolviendo el depósito, no evitando tocarlo.
-- ---------------------------------------------------------------------
create table if not exists public.boletos (
  id uuid primary key default gen_random_uuid(),
  ciclo_id uuid not null references public.ciclos(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  respuesta text not null check (respuesta in ('si','no')),
  monto numeric not null, -- snapshot de productos.precio al momento de comprar
  acerto boolean, -- null hasta que se resuelve el ciclo
  ganador boolean not null default false, -- true solo para quien ganó el sorteo (a lo más 1 por ciclo)
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  unique (ciclo_id, user_id) -- un boleto por usuario por ciclo -- mismo criterio que el hallazgo de la migración 0008
);

alter table public.boletos enable row level security;

create policy "usuarios ven sus propios boletos"
  on public.boletos for select
  using (auth.uid() = user_id);

create policy "operadores ven todos los boletos"
  on public.boletos for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- Sin insert/update para authenticated -- solo comprar_boleto()/resolver_ciclo().

create or replace function public.comprar_boleto(p_ciclo_id uuid, p_respuesta text)
returns public.boletos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo public.ciclos;
  v_producto public.productos;
  v_balance numeric;
  v_boleto public.boletos;
  v_ticket record;
begin
  if auth.uid() is null then
    raise exception 'comprar_boleto requiere sesión activa';
  end if;
  if p_respuesta not in ('si','no') then
    raise exception 'respuesta inválida: %', p_respuesta;
  end if;

  select * into v_ciclo from public.ciclos where id = p_ciclo_id for update;
  if v_ciclo.id is null then
    raise exception 'ciclo % no existe', p_ciclo_id;
  end if;
  if v_ciclo.estado <> 'llenando' then
    raise exception 'el ciclo % no está aceptando boletos (estado: %)', p_ciclo_id, v_ciclo.estado;
  end if;
  if now() > v_ciclo.fecha_resolucion then
    raise exception 'el ciclo % ya pasó su fecha límite de llenado', p_ciclo_id;
  end if;

  select * into v_producto from public.productos where clave = v_ciclo.producto_clave;

  -- FOR UPDATE: sin este lock, dos compras concurrentes del mismo usuario
  -- (en dos ciclos distintos) podrían leer el mismo saldo antes de que
  -- cualquiera de las dos confirme su movimiento, y ambas pasarían el
  -- chequeo de saldo aunque juntas lo rebasen. El unique(ciclo_id,user_id)
  -- ya cubre "dos boletos en el mismo ciclo" -- esto cubre "dos boletos en
  -- ciclos distintos al mismo tiempo".
  select demo_balance into v_balance from public.balances where user_id = auth.uid() for update;
  if v_balance is null or v_balance < v_producto.precio then
    raise exception 'saldo insuficiente -- necesitas $% para este boleto', v_producto.precio;
  end if;

  -- Depósito: capital sale del balance disponible del usuario y entra al
  -- pool del ciclo (memo sección 5, movimiento 1). Se devuelve completo
  -- al resolver (ver resolver_ciclo(), migración 0010), gane o no.
  insert into public.ledger_movimientos (user_id, monto, causa, modo)
  values (auth.uid(), -v_producto.precio, 'Depósito -- boleto ' || v_producto.nombre || ' (ciclo ' || p_ciclo_id || ')', 'demo');

  insert into public.boletos (ciclo_id, user_id, respuesta, monto)
  values (p_ciclo_id, auth.uid(), p_respuesta, v_producto.precio)
  returning * into v_boleto;

  update public.ciclos
    set lugares_ocupados = lugares_ocupados + 1,
        actualizado_en = now(),
        estado = case when lugares_ocupados + 1 >= v_producto.gente_requerida then 'lleno' else estado end,
        fecha_llenado = case when lugares_ocupados + 1 >= v_producto.gente_requerida then now() else fecha_llenado end
    where id = p_ciclo_id;

  -- Reutiliza exactamente la misma racha/volumen/piso/referidos que ya
  -- existía para `posiciones` (migraciones 0005/0006) -- un boleto cuenta
  -- igual que una posición para efectos de comportamiento.
  update public.perfiles
    set racha_actual = racha_actual + 1,
        racha_actualizada_en = now(),
        volumen_depositado_acumulado = volumen_depositado_acumulado + v_producto.precio
    where user_id = auth.uid();

  perform public.recalcular_piso(auth.uid());
  perform public.procesar_recompensa_referido(auth.uid());

  return v_boleto;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Cancelación por no llenar -- "si no se llena en el tiempo asignado,
-- el evento se cancela y se regresa el dinero" (memo, sección 1). No hay
-- cron real disponible desde este sandbox (mismo límite que el resto de
-- la sesión) -- se expone como función invocable por un operador, o
-- llamable por cualquier request autenticado de forma segura (no hace
-- nada dañino si se llama de más: solo cancela ciclos que de verdad ya
-- vencieron). El candidato natural para automatizar esto en producción es
-- un cron job de Supabase (pg_cron) o una Edge Function programada --
-- ninguna de las dos se puede verificar desde este sandbox.
-- ---------------------------------------------------------------------
create or replace function public.cancelar_ciclos_vencidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo record;
  v_cancelados integer := 0;
begin
  -- FOR UPDATE en el cursor: si esta función se llama dos veces en paralelo
  -- (dos invocaciones del cron, o un operador con doble clic), la segunda
  -- se bloquea en cada ciclo hasta que la primera termine -- y al
  -- desbloquear, Postgres vuelve a evaluar el WHERE sobre la versión más
  -- reciente de la fila, así que la segunda corrida ya no ve ese ciclo
  -- como 'llenando' y lo salta, en vez de reembolsar dos veces.
  for v_ciclo in
    select * from public.ciclos where estado = 'llenando' and now() > fecha_resolucion for update
  loop
    update public.ciclos set estado = 'cancelado', actualizado_en = now() where id = v_ciclo.id;

    -- Devolución del 100% del capital a cada boleto de este ciclo.
    insert into public.ledger_movimientos (user_id, monto, causa, modo)
    select b.user_id, b.monto, 'Devolución -- ciclo cancelado (no se llenó a tiempo)', 'demo'
    from public.boletos b
    where b.ciclo_id = v_ciclo.id;

    v_cancelados := v_cancelados + 1;
  end loop;

  return v_cancelados;
end;
$$;

comment on function public.cancelar_ciclos_vencidos is
  'Sin cron real conectado desde este sandbox -- llamar periódicamente desde un job externo (pg_cron o Edge Function programada de Supabase) una vez desplegado. Gateada implícitamente por ser SECURITY DEFINER de bajo riesgo: solo actúa sobre ciclos que YA vencieron, así que llamarla de más nunca cancela algo que no debía cancelarse.';
