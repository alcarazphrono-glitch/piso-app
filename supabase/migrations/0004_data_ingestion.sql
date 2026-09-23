-- PISO Core -- Data ingestion (registro de fuentes + bitácora de capturas)
-- =====================================================================
-- Correr en el SQL Editor de Supabase DESPUÉS de 0003_pricing_engine_real.sql.
--
-- Qué resuelve: hoy, cuando un operador resuelve un evento, escribe la
-- "fuente" como texto libre en el momento (ver resolver_evento() en
-- 0002). Funciona, pero es la versión mínima de lo que pide la sección
-- 3.7 del brief original ("Data ingestion"): un lugar donde las fuentes
-- externas de PISO estén REGISTRADAS (no reescritas cada vez a mano), y
-- donde quede una bitácora de qué se capturó de cada una, para cuando
-- llegue el momento de automatizar esas capturas.
--
-- Lo que esto NO hace, a propósito: no se conecta a ninguna API real de
-- Banxico o INEGI -- este entorno de desarrollo no tiene salida a
-- internet hacia esos servicios, y fingir esa conexión sería peor que no
-- tenerla. Esto es la mesa donde se para esa automatización el día que
-- alguien la construya, no la automatización en sí.

-- ---------------------------------------------------------------------
-- 1. Fuentes de datos -- catálogo, en vez de texto libre repetido en
-- cada resolución.
-- ---------------------------------------------------------------------
create table if not exists public.fuentes_datos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'manual' check (tipo in ('manual', 'api', 'scraping')),
  url text,
  descripcion text,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

alter table public.fuentes_datos enable row level security;

create policy "fuentes_datos lectura pública"
  on public.fuentes_datos for select
  using (true); -- mismo espíritu que resoluciones -- transparencia, no riesgo.

create policy "operadores administran fuentes_datos"
  on public.fuentes_datos for insert
  with check (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

create policy "operadores editan fuentes_datos"
  on public.fuentes_datos for update
  using (exists (select 1 from public.operadores o where o.user_id = auth.uid()));

-- Se registran las dos fuentes que ya se usan hoy, en texto libre, dentro
-- de eventos.fuente_resolucion -- formaliza lo que ya existía.
insert into public.fuentes_datos (nombre, tipo, url, descripcion)
values
  ('Banxico -- comunicado de política monetaria', 'manual',
   'https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/',
   'Decisión de tasa de referencia. Se captura a mano hasta que exista integración automática.'),
  ('INEGI -- publicación del INPC', 'manual',
   'https://www.inegi.org.mx/temas/inpc/',
   'Índice Nacional de Precios al Consumidor. Se captura a mano hasta que exista integración automática.')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Ingestas -- bitácora de qué se capturó de cada fuente, y cuándo.
-- No obliga a ligarla a un evento todavía (evento_id es nullable) -- una
-- captura puede registrarse antes de saber a qué evento le sirve.
-- ---------------------------------------------------------------------
create table if not exists public.ingestas (
  id uuid primary key default gen_random_uuid(),
  fuente_id uuid not null references public.fuentes_datos(id),
  evento_id text references public.eventos(id),
  contenido text not null, -- lo que se leyó/capturó -- texto o resumen, no un scrape real todavía
  capturado_por uuid references public.operadores(user_id),
  capturado_en timestamptz not null default now()
);

alter table public.ingestas enable row level security;

create policy "ingestas lectura pública"
  on public.ingestas for select
  using (true);

create policy "operadores registran ingestas"
  on public.ingestas for insert
  with check (exists (select 1 from public.operadores o where o.user_id = auth.uid()));
