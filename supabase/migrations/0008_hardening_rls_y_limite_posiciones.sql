-- PISO Core -- Hardening de seguridad encontrado en auditoría propia antes
-- de publicar a los 20 usuarios (18-sep-2026). Tres hallazgos, los tres
-- reales y verificados, no hipotéticos:
--
-- 1. `perfiles` conservaba sus políticas de INSERT y UPDATE originales de
--    schema.sql (nunca se revocaron, a diferencia de `balances`, donde sí
--    se hizo en 0002). Cualquier usuario autenticado podía escribir
--    directo a su propia fila -- incluyendo racha_actual,
--    volumen_depositado_acumulado, aciertos_acumulados, piso y
--    referido_por (migración 0005/0006). Eso vuelve inútil todo lo que
--    D6/D7/D8 construyeron como "server-authoritative": un usuario podía
--    autopromoverse a piso 'obsidiana', inflar su racha a mano, o peor --
--    asignarse un referido_por arbitrario (sin pasar por
--    vincular_referido() ni sus validaciones) y cobrar la recompensa de
--    D8 hacia una cuenta cómplice con solo confirmar una posición.
--    Verificado: ningún código del cliente (`grep` sobre src/) hace
--    update a `perfiles` -- cerrar esto no rompe nada existente.
--
-- 2. `balances` conservaba su política de INSERT (la de UPDATE sí se
--    había revocado en 0002). Un usuario podía, en la ventana entre su
--    signup y el upsert que hace el cliente en asegurarPerfilYBalanceDemo
--    (src/lib/demo.ts), insertar su propia fila de `balances` con un
--    demo_balance arbitrario -- ignoreDuplicates del upsert legítimo
--    nunca lo sobreescribe una vez que existe. Se cierra moviendo la
--    creación de perfil+balance a un trigger en auth.users, 100%
--    server-side -- ya no hay ventana de carrera porque ya no hay un
--    INSERT que el cliente pueda ganarle.
--
-- 3. Nada impedía que un mismo usuario abriera MÚLTIPLES posiciones sobre
--    el MISMO evento abierto -- ni un constraint en la base, ni un
--    chequeo en confirmar_posicion(), ni siquiera una guarda en la UI
--    (evento/[id]/page.tsx deja volver a confirmar sin avisar). Como
--    capital_en_riesgo es SIEMPRE 0 (abrir una posición no cuesta nada),
--    esto significa que un usuario podía acumular premio_potencial sin
--    límite sobre un mismo evento, agotar solo él la exposición máxima
--    de D5, y farmear racha/volumen/piso en el proceso. Decisión de
--    producto confirmada: una sola posición por usuario por evento.
--
-- Correr DESPUÉS de 0007_behavioral_experimentos_contenido.sql.

-- =======================================================================
-- Hallazgo 3 -- una posición por usuario por evento.
-- =======================================================================

-- Antes de correr esto en producción: si por el hallazgo de arriba ya
-- existen usuarios con más de una posición en el mismo evento, este
-- constraint FALLA al crearse -- hay que decidir a mano qué posiciones
-- duplicadas conservar antes de aplicar la migración. Query para
-- detectarlo:
--   select user_id, evento_id, count(*) from public.posiciones
--   group by user_id, evento_id having count(*) > 1;

alter table public.posiciones
  add constraint posiciones_una_por_usuario_evento unique (user_id, evento_id);

-- =======================================================================
-- Hallazgo 1 -- cerrar perfiles a escritura directa del cliente.
-- =======================================================================
drop policy if exists "usuarios crean su propio perfil" on public.perfiles;
drop policy if exists "usuarios actualizan su propio perfil" on public.perfiles;
-- Las políticas de SELECT (propio perfil + "operadores ven todos") NO se
-- tocan -- leer sigue funcionando igual. Escribir ahora solo pasa por: el
-- trigger de creación de cuenta (abajo), recalcular_piso(),
-- vincular_referido(), y los incrementos dentro de confirmar_posicion()/
-- simular_resultado_posicion_demo()/resolver_evento() -- todas
-- SECURITY DEFINER, todas ya auditadas.

-- =======================================================================
-- Hallazgo 2 -- creación de cuenta 100% server-side, sin ventana de
-- carrera. Reemplaza lo que hacía asegurarPerfilYBalanceDemo() en el
-- cliente (src/lib/demo.ts) -- ese código se retira en este mismo
-- paquete (ver auth/page.tsx).
-- =======================================================================
drop policy if exists "usuarios crean su propio balance" on public.balances;

create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (user_id, piso)
  values (new.id, 'tierra')
  on conflict (user_id) do nothing;

  insert into public.balances (user_id, demo_balance, modo)
  values (new.id, 1000, 'demo')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.manejar_nuevo_usuario();

comment on function public.manejar_nuevo_usuario is
  'Reemplaza asegurarPerfilYBalanceDemo() del cliente -- crea perfil+balance atómicamente al signup, sin ventana donde el cliente pueda insertar un balance inicial arbitrario. Si esta migración corre en un proyecto con usuarios ya registrados de antes, el backfill de abajo los cubre.';

-- Backfill -- usuarios que ya existían antes de este trigger y por
-- cualquier razón (falla de red, ad-blocker, lo que sea) se quedaron sin
-- perfil o balance.
insert into public.perfiles (user_id, piso)
select u.id, 'tierra' from auth.users u
left join public.perfiles p on p.user_id = u.id
where p.user_id is null
on conflict (user_id) do nothing;

insert into public.balances (user_id, demo_balance, modo)
select u.id, 1000, 'demo' from auth.users u
left join public.balances b on b.user_id = u.id
where b.user_id is null
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- confirmar_posicion -- se reemplaza una vez más solo para agregar el
-- chequeo explícito del hallazgo 3, con un mensaje de error legible (en
-- vez de dejar que el usuario se tope con un error crudo de constraint
-- violation de Postgres). El constraint de arriba sigue siendo la última
-- línea de defensa real -- este chequeo es para que el mensaje tenga
-- sentido cuando llegue a la pantalla.
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

  if exists (select 1 from public.posiciones where user_id = auth.uid() and evento_id = p_evento_id) then
    raise exception 'ya tienes una posición en el evento % -- solo se permite una por evento', p_evento_id;
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
  perform public.procesar_recompensa_referido(auth.uid());

  return v_posicion;
end;
$$;
