-- PISO Core -- Integración Behavioral Forest (D1-D15), parte 3/3.
-- Cubre D9/D10 (servicio de asignación de tratamiento T1-T4) y D14/D15
-- (contenido versionado -- CMS ligero para el explainer y el Trust
-- Center, incluyendo la respuesta pendiente de Legal). Correr DESPUÉS de
-- 0006_behavioral_referidos_compliance.sql.

-- =======================================================================
-- D9 -- Servicio de asignación de tratamiento. Pesos 30/10/40/20 (antes
-- eran 25/25/25/25 iguales, memo D9 los cambia), en una tabla editable --
-- no en código, para que ajustar la mezcla del experimento no sea un
-- deploy. propensity_score se registra desde el día uno en CADA
-- asignación, aunque hoy la lógica de asignación sea simple lectura de
-- peso -- el memo es explícito en que esto es lo que preserva la validez
-- causal-forest el día que exista Fase 2 (policy tree). La función es la
-- interfaz estable que D9 pide: el día que la asignación deje de ser
-- "leer un peso" y pase a ser un policy tree real, asignar_tratamiento()
-- cambia de implementación por dentro, pero ningún caller (Consumer,
-- analítica) tiene que cambiar una sola línea.
-- =======================================================================
create table if not exists public.tratamientos (
  clave text primary key check (clave in ('T1','T2','T3','T4')),
  nombre text not null,
  peso numeric not null check (peso >= 0 and peso <= 1), -- fracción, no %
  activo boolean not null default true,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.operadores(user_id)
);

insert into public.tratamientos (clave, nombre, peso) values
  ('T1', 'Control', 0.30),
  ('T2', 'Predicción (framing no-apuesta)', 0.10),
  -- D10: T2 baja de 25% a 10% del budget de prueba -- el panel ENCODAT
  -- 2025 (41%/27% de cobertura de prensa con framing "apuesta"/"juego")
  -- mostró riesgo de percepción, no se elimina T2, se reduce su exposición
  -- mientras se confirma la señal de la siguiente ronda.
  ('T3', 'Variante 3', 0.40),
  ('T4', 'Variante 4', 0.20)
on conflict (clave) do update set peso = excluded.peso, nombre = excluded.nombre;

alter table public.tratamientos enable row level security;

create policy "tratamientos lectura pública"
  on public.tratamientos for select
  using (true); -- el cliente necesita leer esto para pedir su asignación

create policy "operadores editan tratamientos"
  on public.tratamientos for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- Valida que los pesos ACTIVOS sumen 1.0 (con tolerancia) -- a nivel
-- statement, no row, porque la suma depende de toda la tabla, no de una
-- sola fila que se esté insertando/actualizando.
create or replace function public.validar_pesos_tratamientos()
returns trigger
language plpgsql
as $$
declare
  v_suma numeric;
begin
  select sum(peso) into v_suma from public.tratamientos where activo;
  if v_suma is not null and abs(v_suma - 1.0) > 0.001 then
    raise exception 'D9: los pesos de tratamientos activos deben sumar 1.0 (100%%) -- suman %', v_suma;
  end if;
  return null; -- trigger de statement, el valor de retorno no se usa
end;
$$;

drop trigger if exists trg_validar_pesos_tratamientos on public.tratamientos;
create trigger trg_validar_pesos_tratamientos
  after insert or update on public.tratamientos
  for each statement execute function public.validar_pesos_tratamientos();

create table if not exists public.asignaciones_tratamiento (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tratamiento text not null references public.tratamientos(clave),
  propensity_score numeric not null,
  asignado_en timestamptz not null default now()
);
-- primary key = user_id -- asignación PEGAJOSA (sticky), una por usuario,
-- para siempre. Un usuario nunca cambia de tratamiento a media prueba.

alter table public.asignaciones_tratamiento enable row level security;

create policy "usuarios ven su propia asignación"
  on public.asignaciones_tratamiento for select
  using (auth.uid() = user_id);

create policy "operadores ven todas las asignaciones"
  on public.asignaciones_tratamiento for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- Sin insert para authenticated -- solo asignar_tratamiento() (abajo).

create or replace function public.asignar_tratamiento(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existente text;
  v_random numeric;
  v_acumulado numeric := 0;
  v_fila record;
  v_elegido text;
  v_peso numeric;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'asignar_tratamiento solo puede pedirse para el propio usuario';
  end if;

  select tratamiento into v_existente from public.asignaciones_tratamiento where user_id = p_user_id;
  if v_existente is not null then
    return v_existente; -- pegajoso -- nunca reasigna
  end if;

  v_random := random();

  for v_fila in select clave, peso from public.tratamientos where activo order by clave loop
    v_acumulado := v_acumulado + v_fila.peso;
    if v_random <= v_acumulado and v_elegido is null then
      v_elegido := v_fila.clave;
      v_peso := v_fila.peso;
    end if;
  end loop;

  -- Redondeo de punto flotante puede dejar v_random ligeramente por
  -- encima de la suma acumulada final -- si pasó, cae al último activo.
  if v_elegido is null then
    select clave, peso into v_elegido, v_peso from public.tratamientos where activo order by clave desc limit 1;
  end if;

  insert into public.asignaciones_tratamiento (user_id, tratamiento, propensity_score)
  values (p_user_id, v_elegido, v_peso)
  on conflict (user_id) do nothing;

  -- Si dos llamadas concurrentes chocaron en el on conflict, se regresa lo
  -- que haya quedado en la tabla (la primera que ganó la carrera), no lo
  -- que esta llamada calculó -- así nunca se reporta un tratamiento que
  -- no quedó realmente asignado.
  select tratamiento into v_existente from public.asignaciones_tratamiento where user_id = p_user_id;
  return v_existente;
end;
$$;

comment on function public.asignar_tratamiento is
  'D9: interfaz estable de asignación -- hoy pesa-y-sortea, mañana puede ser policy tree, ningún caller cambia.';

-- =======================================================================
-- D14/D15 -- Contenido versionado. CMS ligero: cada "clave" (una pregunta
-- del Trust Center, un bloque del explainer, un copy de tratamiento) tiene
-- múltiples versiones; solo una está activa a la vez. Editar esto es
-- INSERTAR una fila nueva, nunca hacer UPDATE sobre una vigente -- así el
-- historial completo de qué decía cada texto y cuándo queda intacto,
-- mismo principio que parametros_pricing_historial.
-- =======================================================================
create table if not exists public.contenido_versionado (
  id uuid primary key default gen_random_uuid(),
  clave text not null,
  version integer not null,
  cuerpo jsonb not null,
  activa boolean not null default false,
  pendiente_legal boolean not null default false,
  -- D15: marca el caso especial (hoy solo "qué pasa si PISO desaparece")
  -- donde el campo vive aquí precisamente para que Legal lo edite sin
  -- ticket de desarrollo -- ver nota de alcance más abajo.
  vigente_desde timestamptz,
  editado_por uuid references public.operadores(user_id),
  creado_en timestamptz not null default now(),
  unique (clave, version)
);

-- A lo más UNA versión activa por clave -- índice único parcial, no un
-- constraint de tabla completa (Postgres no soporta "unique where" como
-- check constraint, pero sí como índice).
create unique index if not exists contenido_versionado_una_activa_por_clave
  on public.contenido_versionado (clave) where (activa);

alter table public.contenido_versionado enable row level security;

create policy "contenido activo es de lectura pública"
  on public.contenido_versionado for select
  using (activa = true);
  -- Solo lo PUBLICADO es público -- un borrador/versión vieja no se filtra
  -- a Consumer. Ver la política de abajo para operadores.

create policy "operadores ven todo el contenido, incluidos borradores"
  on public.contenido_versionado for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- Sin política de insert/update directa para nadie -- todo pasa por
-- publicar_contenido() (SECURITY DEFINER), para que "activar una versión
-- nueva" siempre desactive la anterior en la misma transacción -- un
-- insert manual del cliente podría dejar dos versiones activas a la vez
-- si alguien olvida el paso de desactivar.

create or replace function public.publicar_contenido(
  p_clave text,
  p_cuerpo jsonb,
  p_pendiente_legal boolean default false
)
returns public.contenido_versionado
language plpgsql
security definer
set search_path = public
as $$
declare
  v_siguiente_version integer;
  v_fila public.contenido_versionado;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
    -- Nota de alcance honesta (D15): el memo pide que Legal edite esto
    -- "directamente, sin ticket de dev" -- este gate hoy exige ser
    -- operador (tabla operadores, rol='admin' únicamente). El MECANISMO
    -- que pide D15 ya existe (el contenido vive en una tabla editable,
    -- no en código) -- lo que falta, y es una decisión de acceso
    -- pendiente, es si Legal necesita su propio rol dentro de
    -- `operadores` con permisos más angostos que un admin completo. No
    -- se inventa ese rol aquí a medias -- se deja marcado en el README.
  end if;

  select coalesce(max(version), 0) + 1 into v_siguiente_version
    from public.contenido_versionado where clave = p_clave;

  update public.contenido_versionado set activa = false where clave = p_clave and activa = true;

  insert into public.contenido_versionado (clave, version, cuerpo, activa, pendiente_legal, vigente_desde, editado_por)
  values (p_clave, v_siguiente_version, p_cuerpo, true, p_pendiente_legal, now(), auth.uid())
  returning * into v_fila;

  return v_fila;
end;
$$;

create or replace function public.contenido_actual(p_clave text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select cuerpo from public.contenido_versionado where clave = p_clave and activa = true limit 1;
$$;

-- ---------------------------------------------------------------------
-- Siembra inicial -- el copy que YA existía hardcodeado en
-- src/app/trust-center/page.tsx, ahora como versión 1 activa de cada
-- clave, para que la migración a esta tabla no cambie ni una palabra el
-- día que se despliega -- Trust Center se conecta a esto en el mismo
-- paquete (ver src/lib/contenido.ts).
-- ---------------------------------------------------------------------
insert into public.contenido_versionado (clave, version, cuerpo, activa, pendiente_legal, vigente_desde) values
  ('trust_center:1', 1, '{"q":"¿Dónde está mi dinero?","a":"Tu depósito se invierte en CETES — valores gubernamentales emitidos por el gobierno mexicano. Es el instrumento de ahorro más seguro disponible en México. Tu capital no se usa para pagar premios de otros usuarios."}'::jsonb, true, false, now()),
  ('trust_center:2', 1, '{"q":"¿Puedo perder mi depósito?","a":"No. Tu depósito inicial siempre está disponible para retiro. Lo que participa en los eventos es únicamente el rendimiento que tu dinero genera en CETES durante el período del evento."}'::jsonb, true, false, now()),
  ('trust_center:3', 1, '{"q":"¿Cómo gana dinero PISO?","a":"PISO retiene el 12% de cada premio pagado. Si no hay premio, no cobramos nada adicional sobre tu depósito. Nuestros intereses están alineados con los tuyos: ganamos cuando tú ganas."}'::jsonb, true, false, now()),
  ('trust_center:4', 1, '{"q":"¿Qué pasa si PISO desaparece?","a":"Tu capital está custodiado en instrumentos de deuda gubernamental separados del capital operativo de PISO. En el escenario de discontinuidad del servicio, tu depósito es recuperable."}'::jsonb, true, true, now())
  -- pendiente_legal = true -- D15: esta es la respuesta exacta que sigue
  -- pendiente de validación de Legal. El campo booleano ya existía como
  -- copy fijo en la pantalla (p.pendienteLegal); ahora vive aquí también,
  -- editable sin deploy en cuanto Legal la confirme o la cambie.
on conflict (clave, version) do nothing;

insert into public.contenido_versionado (clave, version, cuerpo, activa, vigente_desde) values
  ('tratamiento:t2:copy', 1, '{"titulo":"Tu predicción sobre Banxico…","nota":"D10: reemplaza el framing anterior (\"Apuesta a Banxico...\") -- panel ENCODAT 2025 mostró riesgo de percepción con lenguaje de apuesta/juego."}'::jsonb, true, now())
on conflict (clave, version) do nothing;
