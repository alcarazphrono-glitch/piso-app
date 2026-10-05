-- PISO -- Lista de espera pública (landing /unete). Antes del App Store
-- medimos interés real: cuánta gente deja su correo, de qué campaña llega
-- (UTM) y cuánta trae a otros (código de invitación). Behavioral usa esto
-- para decidir qué contenido produce.
--
-- Número 0013 a propósito: 0011 es de "Pulir app antes de El Reto" y 0012
-- se deja libre para el hilo del dashboard financiero, que corre en
-- paralelo. No depende de ninguna otra migración.
--
-- Quien visita la landing NO tiene sesión (rol anon). Por eso la tabla no
-- tiene ninguna política para anon: nadie puede leer ni escribir directo.
-- La única puerta es unirse_lista_espera() (security definer), que valida
-- el correo, evita duplicados y devuelve solo lo que el visitante necesita
-- ver (su lugar y su código), nunca correos de otros.

create table if not exists public.lista_espera (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  rango_edad text check (rango_edad in ('menos_18', '18_24', '25_34', '35_mas')),
  codigo text not null unique,
  referido_por text references public.lista_espera(codigo) on delete set null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  referrer text,
  creado_en timestamptz not null default now()
);

-- Unicidad sin importar mayúsculas: "Ana@x.com" y "ana@x.com" son la misma.
create unique index if not exists lista_espera_email_unico on public.lista_espera (lower(email));
create index if not exists lista_espera_creado_en on public.lista_espera (creado_en);
create index if not exists lista_espera_referido_por on public.lista_espera (referido_por);

alter table public.lista_espera enable row level security;

-- Operadores leen todo desde /admin/lista-espera (mismo patrón que 0002).
create policy "operadores ven la lista de espera"
  on public.lista_espera for select
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- -----------------------------------------------------------------------
-- Registro público. Idempotente: si el correo ya existe devuelve su lugar
-- y código originales (ya_registrado = true) en vez de un error, así el
-- visitante que se registra dos veces ve lo mismo y no hay forma de saber
-- qué correos existen más allá del propio.
-- -----------------------------------------------------------------------
create or replace function public.unirse_lista_espera(
  p_email text,
  p_rango_edad text default null,
  p_referido_por text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_referrer text default null
)
returns table (posicion bigint, codigo text, ya_registrado boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_fila public.lista_espera;
  v_codigo text;
  v_ref text;
  v_nuevo boolean := false;
begin
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'correo_invalido';
  end if;

  if p_rango_edad is not null and p_rango_edad not in ('menos_18', '18_24', '25_34', '35_mas') then
    p_rango_edad := null;
  end if;

  select * into v_fila from public.lista_espera where lower(email) = v_email;

  if v_fila.id is null then
    -- Solo se acepta un código de invitación que exista; uno inventado se
    -- ignora en silencio en vez de bloquear el registro.
    select l.codigo into v_ref from public.lista_espera l where l.codigo = upper(trim(p_referido_por));

    -- Código corto y legible para compartir (sin 0/O/1/I).
    loop
      v_codigo := (
        select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
        from generate_series(1, 6)
      );
      exit when not exists (select 1 from public.lista_espera l where l.codigo = v_codigo);
    end loop;

    begin
      insert into public.lista_espera (
        email, rango_edad, codigo, referido_por,
        utm_source, utm_medium, utm_campaign, utm_content, referrer
      ) values (
        v_email, p_rango_edad, v_codigo, v_ref,
        left(p_utm_source, 100), left(p_utm_medium, 100), left(p_utm_campaign, 100),
        left(p_utm_content, 100), left(p_referrer, 300)
      )
      returning * into v_fila;
      v_nuevo := true;
    exception when unique_violation then
      -- Dos envíos simultáneos del mismo correo: gana el primero.
      select * into v_fila from public.lista_espera where lower(email) = v_email;
    end;
  end if;

  return query
    select (select count(*) from public.lista_espera l where l.creado_en <= v_fila.creado_en),
           v_fila.codigo,
           not v_nuevo;
end;
$$;

revoke all on function public.unirse_lista_espera(text, text, text, text, text, text, text, text) from public;
grant execute on function public.unirse_lista_espera(text, text, text, text, text, text, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------
-- Resumen para /admin/lista-espera: totales, por fuente, por día y por
-- invitación. Solo operadores (mismo chequeo que admin_analytics_resumen).
-- -----------------------------------------------------------------------
create or replace function public.admin_lista_espera_resumen()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v json;
begin
  if not exists (select 1 from public.operadores where user_id = auth.uid()) then
    raise exception 'no tienes permiso de operador';
  end if;

  select json_build_object(
    'total', (select count(*) from public.lista_espera),
    'hoy', (select count(*) from public.lista_espera where creado_en >= date_trunc('day', now())),
    'ultimos_7_dias', (select count(*) from public.lista_espera where creado_en >= now() - interval '7 days'),
    'por_invitacion', (select count(*) from public.lista_espera where referido_por is not null),
    'nicho_18_24', (select count(*) from public.lista_espera where rango_edad = '18_24'),
    'con_edad', (select count(*) from public.lista_espera where rango_edad is not null),
    'por_fuente', coalesce((
      select json_agg(t order by t.registros desc) from (
        select coalesce(utm_source, '(directo)') as fuente,
               coalesce(utm_campaign, '—') as campana,
               count(*) as registros,
               count(*) filter (where rango_edad = '18_24') as nicho_18_24
        from public.lista_espera
        group by 1, 2
      ) t
    ), '[]'::json),
    'por_dia', coalesce((
      select json_agg(t order by t.dia) from (
        select to_char(date_trunc('day', creado_en), 'YYYY-MM-DD') as dia, count(*) as registros
        from public.lista_espera
        where creado_en >= now() - interval '30 days'
        group by 1
      ) t
    ), '[]'::json),
    'por_edad', coalesce((
      select json_agg(t order by t.registros desc) from (
        select coalesce(rango_edad, 'sin_dato') as rango, count(*) as registros
        from public.lista_espera
        group by 1
      ) t
    ), '[]'::json)
  ) into v;

  return v;
end;
$$;

revoke all on function public.admin_lista_espera_resumen() from public;
grant execute on function public.admin_lista_espera_resumen() to authenticated;
