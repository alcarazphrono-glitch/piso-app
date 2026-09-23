# PISO — MVP del loop (entregable de la semana)

Construido contra el memo de Dirección General del 25-ago-2026 ("Instrucciones
MVP — prioridades de construcción esta semana"). Las cinco pantallas del loop,
modo demo obligatorio, un solo evento (Banxico), tres pisos activos/dos
bloqueados, el tagline nuevo, y el PISO Moment instrumentado. Nada de lo que
el memo marcó como "no construyen esta semana" está aquí (sin integración
real de CETES, sin float/carry real, sin causal forest, sin más de un
evento, sin los cinco pisos completos).

## Lo que necesitas crear antes de que esto corra de verdad

Este código compila y corre (`npm run build` ya se probó, sin errores), pero
necesita tres cuentas externas para funcionar con datos reales. Ninguna
cuesta dinero en el nivel gratuito, y las tres se crean en menos de 10
minutos cada una:

1. **Un proyecto de Supabase** (supabase.com → New Project). Copia la
   "Project URL" y la "anon public key" de Settings → API.
   Luego, en el SQL Editor del proyecto, pega y corre todo
   `supabase/schema.sql` — eso crea las tablas y los permisos.
   **Importante:** en Authentication → Providers → Email, desactiva
   "Confirm email" para que el registro entre directo sin esperar un correo
   de confirmación (así se prueba más rápido esta semana; se puede
   reactivar cuando haya modo real).

2. **Un proyecto de PostHog** (posthog.com → New Project). Copia la
   "Project API Key" de Project Settings.

3. **Una cuenta de Vercel** (vercel.com) para publicar la app en una URL
   real, o cualquier otro hosting que corra Next.js.

Con esas tres cosas, llena `.env.local` (copia `.env.example` y pon los
valores reales) y ya puedes correr `npm run dev` localmente, o conectar el
repo a Vercel y agregar esas mismas variables de entorno ahí para el
despliegue real.

## Cómo correrlo localmente

```bash
npm install
cp .env.example .env.local   # y llena los 4 valores
npm run dev
```

Abre `http://localhost:3000`.

## El loop, pantalla por pantalla

| # | Ruta | Qué hace |
|---|---|---|
| — | `/` | Entrada pública, tagline nuevo, botón "Probar PISO" |
| — | `/auth` | Registro/login por email — crea el balance demo de $1,000 |
| 1 | `/home` | Tu piso, capital protegido, pisos activos/bloqueados |
| 2 | `/evento/[id]` | Banxico (único activo), probabilidad, premio, Sí/No |
| 3 | `/confirmar` | Piso, upside, "Capital en riesgo $0", confirmar |
| 4 | `/posicion` | Tu respuesta, premio, contador — + botón demo para resolver sin esperar 42 días |
| 5 | `/resultado` | Ganaste/No ganaste, piso intacto, PISO Moment, siguiente evento |

## PostHog — el funnel exacto que pidió Dirección General

Cada paso vive como una función en `src/lib/posthog.ts` (`trackFunnel`), para
que nadie dispare un evento con el nombre mal escrito desde tres archivos
distintos:

`visita` → `registro` → `demo_activo` → `primer_evento` → `segundo_evento`
→ `quiere_subir_piso` → `quiere_modo_real` → `deposito_real`

`quiere_subir_piso` se dispara al tocar Platino/Obsidiana (bloqueados).
`quiere_modo_real` se dispara al tocar "Pasar a modo real" en el resultado.
`deposito_real` está definido y listo para usarse — no se dispara todavía
porque el memo de DG excluye integración real de dinero esta semana.

También se manda `quiere_mas_eventos` (al tocar un evento bloqueado) y
`piso_moment_respondido` — no estaban en la lista literal del memo, pero son
la forma más directa de medir exactamente lo que Prioridad 3 y Prioridad 7
piden ("medir si la gente quiere más eventos", "el dato más importante que
vamos a recolectar").

## Decisiones que tomé y por qué

**El "Simular resultado ahora" en la pantalla de Posición.** Banxico decide
tasas cada 42 días — nadie va a poder demostrar el loop completo el viernes
si hay que esperar eso de verdad. Ese botón es exclusivo de modo demo:
resuelve la posición al instante con la probabilidad histórica real (35%)
como peso. En modo real ese botón no existe — ahí sí se espera el resultado
real. Está marcado en la interfaz como "Solo en modo demo" para que nadie
lo confunda con el comportamiento de producción.

**El cálculo de "premio potencial" en `src/types/index.ts`.** Es una
fórmula simplificada a propósito (`premioPotencialDemo`), NO el motor de
precios real (float 25% / carry 12% sobre rendimiento de CETES) que ya
existe en `piso_fase0/pricing_engine.py` del otro repo. Conectar el motor
real es trabajo de cuando exista dinero real — mezclarlo ahora sería
construir precisión donde el memo pidió velocidad.

**Misma identidad visual que la landing de Fase 1.** Paleta y tipografía
(Bricolage Grotesque / IBM Plex Sans / IBM Plex Mono) son las mismas que
`piso_fase1/generate_landing.py` — para que el anuncio y el producto se
sientan como una sola marca, no dos proyectos distintos.

**Fuentes por `<link>`, no por `next/font/google`.** `next/font` descarga
las tipografías durante el build en el servidor que compila — en este
entorno de desarrollo esa descarga no tuvo salida a internet y rompía el
build. Con `<link>` en `globals.css`, es el navegador de quien visita la
página el que las pide (igual que la landing). Si el pipeline de CI real sí
tiene salida a internet, cambiar a `next/font` es una línea, no una
decisión de arquitectura.

## Lo que no está aquí (a propósito, memo de DG)

Integración real con CETES, sistema de carry y float real, causal forest o
personalización, más de un evento activo, los cinco pisos completos, o
cualquier cosa fuera de las cinco pantallas del loop.

---

## Actualización 2-sep-2026 — Rediseño conductual (memo Behavioral Forest)

Después de una revisión con Dirección General y Behavioral, el diseño de
esta app se reconstruyó de raíz sobre un lienzo publicado por Behavioral,
con base en una prueba con 50,000 usuarios. Esto cambió tanto la marca
visual como parte del flujo:

- **Sistema visual nuevo:** modo oscuro, verde menta + dorado, tipografías
  Space Grotesk / Sora — reemplaza el beige/dorado/teal con Bricolage/IBM
  Plex de la versión anterior. Único fondo claro a propósito: la pantalla
  Ganaste. Ver `src/app/globals.css`.
- **Evento y Confirmar se fusionaron** en una sola pantalla
  (`/evento/[id]`) — el dato de Behavioral dice que ahí es donde ocurre el
  mayor abandono, no en el Home, así que se quitó un paso.
- **Racha nueva** (`src/lib/demo.ts`, `obtenerRacha`): cuenta las
  posiciones que ha abierto el usuario, se muestra en Evento y Resultado.
  Es la pieza que Behavioral agregó para resolver que solo 29% reabre
  posición en 48h.
- **Segundo evento activo** (INPC, `src/types/index.ts`) con la misma
  plantilla que Banxico.
- **Modo real** dejó de ser un `alert()` y es pantalla completa
  (`/modo-real`) con captura de correo real (tabla
  `intereses_modo_real`, ver `supabase/schema.sql` — hay que correr el
  SQL nuevo de esa tabla si el proyecto de Supabase ya existía antes de
  esta actualización).
- **Trust Center** nuevo (`/trust-center`), y los 5 niveles se movieron a
  su propia pantalla (`/perfil`) — el Home ahora es un solo flujo:
  capital protegido → Ver eventos.

**Pendiente, no resuelto por Tecnología:** el premio de Banxico usa
$10,919 (validado por Behavioral para un ticket de $500) pero no cuadra
linealmente con el $8,750 que Dirección General calculó para $1,000 en su
memo original — falta que Finanzas confirme cuál es el canónico. El
premio de INPC es un placeholder sin validar todavía. Ambos están
marcados explícitamente en `src/lib/config.ts`
(`RECONCILIACION_PENDIENTE`) para que nadie los tome por cifras de
negocio cerradas.

---

## Actualización 17-sep-2026 — PISO Core V1 (Event Manager + Ledger + Resolution Engine)

Hasta esta actualización, el navegador de quien usaba la app decidía
cuánto dinero tenía y si había ganado un evento (`Math.random()` en
`posicion/page.tsx`, `update` directo a `balances`). Funcionaba para modo
demo, pero un Ledger o un motor de resolución no se pueden construir
encima de eso. Esta actualización mueve esa autoridad a Postgres:

- **`supabase/migrations/0002_piso_core.sql`** — hay que correrla en el
  SQL Editor de Supabase, después de `schema.sql`. Antes de correrla,
  reemplaza el correo placeholder de la sección 6 por el tuyo, para
  registrarte como operador. Agrega:
  - `operadores` (quién puede administrar eventos).
  - `eventos` extendida con categoría, pregunta, fechas, fuente de
    resolución y un ciclo de vida (`borrador → abierto → cerrado →
    resuelto`).
  - `resoluciones` — bitácora auditable: fuente, evidencia, quién resolvió,
    cuándo. Lectura pública, mismo espíritu que el Trust Center.
  - `ledger_movimientos` — el balance de un usuario ya no es un número que
    cualquiera pueda `update`-ear; es la suma de sus movimientos. Un
    trigger es la única vía que actualiza `balances.demo_balance`.
  - `parametros_pricing` — ticket demo y multiplicador editables desde
    `/admin/configuracion`, sin deploy.
  - Cuatro funciones (`SECURITY DEFINER`, cada una verifica explícitamente
    quién llama antes de escribir): `calcular_premio_potencial`,
    `confirmar_posicion`, `simular_resultado_posicion_demo`,
    `resolver_evento`. Esta última liquida en cascada todas las
    posiciones abiertas del evento que resuelve — resolver un evento sin
    eso sería un registro de auditoría sin consecuencia real.
- **`/admin/eventos`** y **`/admin/configuracion`** — paneles nuevos,
  gateados por la tabla `operadores`. Un operador crea, publica y resuelve
  eventos sin tocar código ni redesplegar.
- **Consumer ya no lee `EVENTOS` hardcodeado** (ese arreglo desapareció de
  `src/types/index.ts`) — `/eventos`, `/evento/[id]`, `/posicion` y
  `/resultado` leen la tabla `eventos` real vía `src/lib/eventos.ts`. Un
  evento creado en `/admin/eventos` aparece en la app sin deploy.

**Qué no se pudo probar desde aquí, y hay que confirmar contra tu proyecto
real de Supabase antes de darlo por bueno:** el build compila limpio y las
pantallas renderizan sin crash, pero este entorno no tiene acceso a tu
Supabase real, así que no se corrió el loop completo (crear evento →
confirmar posición → resolver → ver el ledger reflejarlo), ni se probó que
un usuario no pueda llamar a `simular_resultado_posicion_demo` sobre la
posición de otro, ni que `resolver_evento` rechace resolver el mismo
evento dos veces. La lógica de esas tres cosas está en la migración
(revisa los `raise exception` de cada función), pero falta la prueba en
vivo — hazla antes de mostrarle esto a nadie más.

---

## Actualización 17-sep-2026 (segunda ronda) — Pricing Engine real, espacio de Finanzas, Data ingestion

Con esto se cierran las 8 piezas de PISO Core V1 que pedía el brief
original (Event Manager, Resolution Engine, Ledger, Risk Dashboard,
Pricing Engine, User/Behavior Dashboard, Data ingestion, Analytics).

- **`supabase/migrations/0003_pricing_engine_real.sql`** (correr después
  de 0002) —
  - `calcular_premio_potencial()` ahora intenta primero la fórmula real
    (rendimiento de CETES en la ventana del evento × `float_pct`, entre
    probabilidad, menos `carry_pct`) y solo cae a la fórmula placeholder
    si falta algún parámetro. Tecnología no llenó esos tres números —
    siguen en `null` hasta que Finanzas los confirme.
  - `/admin/configuracion` los vuelve campos editables de verdad (antes
    solo se mostraban) y te dice si el "motor real" está activo o no.
  - `parametros_pricing_historial` + trigger: cada cambio a esos
    parámetros queda registrado con fecha y valor anterior.
  - `eventos.premio_estado` (`validado` / `interino_pendiente_finanzas` /
    `formula_automatica`) — la reconciliación $10,919 vs $8,750 ya no
    vive solo en un comentario de `config.ts`, es un campo visible en
    `/admin/eventos`.
- **`supabase/migrations/0004_data_ingestion.sql`** (correr después de
  0003) — `fuentes_datos` (catálogo, ya trae registradas Banxico e
  INEGI) e `ingestas` (bitácora de capturas) — `/admin/fuentes`. Sin
  ninguna API real conectada todavía (este entorno no tiene salida a
  Banxico/INEGI) — es la mesa donde se para esa automatización después,
  no la automatización en sí.
- `/admin` quedó completamente aislado del código de Consumer (no
  importa nada de `src/components/ui.tsx`) para poder separarse en su
  propio proyecto de Vercel más adelante sin reescribir nada, y
  `public/robots.txt` bloquea que se indexe en buscadores mientras tanto.

**Qué sigue sin poder probarse desde este sandbox, igual que la ronda
anterior:** build limpio, pero ni el motor de pricing real, ni el
historial de auditoría, ni el registro de fuentes se corrieron contra un
Supabase real. Antes de confiar en un número que salga de
`calcular_premio_potencial()` con el motor real activo, créalo con datos
de prueba y verifica el resultado a mano una vez.

---

## Actualización 17-sep-2026 (tercera ronda) — Integración de la
## especificación de Behavioral Forest (D1-D15)

Behavioral Forest entregó una especificación consolidada de backend (15
decisiones, D1-D15) cubriendo protección de capital, resolución de
eventos, pricing, kill switch de riesgo, racha, progresión de piso,
referidos, servicio de asignación de tratamiento, separación de
namespace de modelos, compliance de contenido y CMS versionado para el
explainer/Trust Center. Esta ronda integra las 15 con lo que ya existía
de PISO Core, sin tocar el diseño de retención que es dominio de
Behavioral — solo se construyó la infraestructura real detrás de él.

**Tres migraciones nuevas, en orden, después de 0004:**

- **`0005_behavioral_capital_riesgo.sql`** — D1, D3, D4, D5, D6, D7.
  - D3: `posiciones` gana `monto_ticket`, `tau_dias`, `capital_returned`
    (siempre `true` — el depósito nunca sale de `balances.demo_balance`,
    ver el check `capital_en_riesgo = 0` que ya existía), `carry_retenido`
    y `float_acumulado`. No se construyó la máquina de estados completa
    de 5 pasos (`creado→fondeado→evento_abierto→evento_resuelto→
    liquidado`) — hoy no existe un paso de "fondeo" real distinto del
    signup, así que forzar esos estados sería fingir una etapa que no
    existe. El esquema queda listo (`estado` acepta `'fondeada'` y
    `'liquidada'`) para cuando sí exista modo real.
  - D1: `verificar_integridad_capital()` — reconcilia
    `balances.demo_balance` contra `1000 + suma del ledger` para cada
    usuario. `resolver_evento()` la corre sobre los usuarios que acaba de
    liquidar y **revierte toda la resolución** si alguno queda fuera de
    reconciliación — así se lee literal el "bloquea el cierre del
    contrato" que pide D1, con "cierre del contrato" = resolución del
    evento en este sistema.
  - D4: tres alphas (`alpha_emisor`/`alpha_c2`/`alpha_c1`, deben sumar
    100%) en `parametros_pricing`, editables en `/admin/configuracion`.
    **Sin reconciliar** contra `float_pct`/`carry_pct`/`tasa_cetes_anual`
    de la migración 0003 — son dos formas de descomponer el mismo
    rendimiento de CETES y Finanzas/Behavioral no han confirmado cuál
    manda. La fórmula que sigue calculando premios en vivo es float/carry
    — los alphas se guardan reales y versionados, listos para cuando se
    resuelva cuál gana.
  - D5: kill switch real. `eventos.exposure_limite_mxn` (editable en
    `/admin/riesgo`) + `confirmar_posicion()` lo hace cumplir — en cuanto
    la exposición agregada de un evento llega al límite, deja de aceptar
    posiciones nuevas para ese evento. No es una alerta, es un freno.
  - D6: `perfiles.racha_actual` — contador atómico real (antes era un
    `count()` recalculado en cada carga de pantalla), incrementado
    server-side dentro de `confirmar_posicion()`. **La regla de reset NO
    se construyó** — el memo la marca explícitamente como "propuesta, no
    consenso" — mismo criterio que VaR/CVaR en Riesgo.
  - D7: `perfiles.volumen_depositado_acumulado` / `aciertos_acumulados` +
    tabla `piso_niveles` (editable, mismos 5 umbrales que ya existían en
    `src/types/index.ts`) + `recalcular_piso()`, event-triggered dentro
    de `confirmar_posicion()` — no es un cron, se recalcula cuando el
    usuario actúa, tal como pide D7 ("not per-request").
- **`0006_behavioral_referidos_compliance.sql`** — D8, D11, D12.
  - D8: `perfiles.referido_por` (single-level — nunca se propaga),
    `referidos_config` (monto fijo + cap mensual, editable en
    `/admin/referidos`), `referidos_recompensas` (bitácora) y
    `procesar_recompensa_referido()`, que paga **solo en el primer evento
    del referido**, nunca en el signup. **Sin leaderboard de top
    referidores** — el memo lo prohíbe explícitamente y esta migración no
    construye ninguna vista de ranking. Falta la pantalla de Consumer que
    capture el código de referido en el onboarding — `vincular_referido()`
    ya existe y funciona, pero enganchar la UI es decisión de
    Producto/Behavioral, no se inventó aquí.
  - D11: `modelo_registro` (namespace `fase0:*` / `produccion:*`) +
    trigger que **rechaza a nivel de base de datos** cualquier puntero de
    producción hacia un registro de fase0. No existe todavía un pipeline
    de ML real desplegado en este proyecto — esto es el registro central
    listo para que ese pipeline, el día que exista, lo use como fuente de
    verdad.
  - D12: `terminos_prohibidos` (sembrada con "apuesta"/"apuéstale"/
    "jugada"/"cuotas") + `validar_copy()` — **avisa, no bloquea**, tal
    como pide el memo para esta fase. Integrado en `/admin/contenido`.
- **`0007_behavioral_experimentos_contenido.sql`** — D9, D10, D14, D15.
  - D9: `tratamientos` (T1-T4, pesos editables, deben sumar 100% o
    Postgres rechaza el guardado) + `asignaciones_tratamiento`
    (asignación pegajosa, una por usuario, con `propensity_score`
    registrado desde el día uno) + `asignar_tratamiento()`, la interfaz
    estable que pide D9 — hoy pesa-y-sortea, el día que exista un policy
    tree real ningún caller tiene que cambiar. Pesos sembrados en
    30/10/40/20 (antes 25/25/25/25).
  - D10: T2 baja a 10% del presupuesto de prueba (panel ENCODAT 2025 —
    framing "apuesta"/"juego" en 41%/27% de cobertura de prensa) y su
    copy se movió a `contenido_versionado` bajo `tratamiento:t2:copy`,
    ya con el texto nuevo ("Tu predicción sobre Banxico…" en vez de
    "Apuesta a Banxico...").
  - D14/D15: `contenido_versionado` — CMS ligero, una versión activa por
    clave, historial completo de las anteriores. Las 4 preguntas del
    Trust Center se migraron aquí con el copy EXACTO que ya tenían (ver
    `src/lib/contenido.ts`, conectado en `src/app/trust-center/page.tsx`)
    — este deploy no cambia una palabra de Trust Center por sí solo, solo
    cambia de dónde sale el texto. La respuesta pendiente de Legal
    (`trust_center:4`) queda marcada con `pendiente_legal = true` y es
    editable desde `/admin/contenido` sin ticket de dev — que es
    exactamente lo que pide D15. **Nota de alcance honesta:** el
    mecanismo ya existe; lo que falta es que Legal tenga su propio acceso
    separado de un admin completo (hoy `publicar_contenido()` exige
    `operadores`, rol `'admin'` únicamente) — es una decisión de acceso
    pendiente, no se construyó un rol a medias.

**D2, el punto que el memo marca como más crítico y no negociable, ya
estaba satisfecho antes de esta ronda** — se dejó documentado
explícitamente en 0005 en vez de depender de que alguien lo infiera
leyendo dos funciones distintas: `resolver_evento()` solo acepta un
resultado que un operador confirma a mano (nunca genera el resultado);
la única función que usa `random()` es `simular_resultado_posicion_demo()`,
exclusiva de modo demo, nunca usada para resolver un evento real.

**Nuevas páginas de admin:** `/admin/referidos`, `/admin/experimentos`,
`/admin/contenido`. `/admin/riesgo` gana el widget de integridad de
capital (D1) y el panel de kill switch por evento (D5). `/admin/
configuracion` gana los tres alphas (D4) y una nota explícita de que el
reset de racha (D6) no está construido.

**Sobre las pruebas de esta ronda — un cambio real frente a las
anteriores:** además de la revisión manual de siempre (así se encontró y
arregló, por ejemplo, la recursión de RLS en `operadores` hace dos
rondas), esta vez sí se pudo ejecutar. Este sandbox tiene Postgres 16
instalado localmente — se armó un stub mínimo de lo que Supabase agrega
(`auth.users`, `auth.uid()`, `gen_random_uuid()`) y se corrió la cadena
completa `schema.sql` → `0002` → ... → `0007` contra una base real, más
un script funcional que ejercitó `confirmar_posicion` con kill switch
activo, `resolver_evento` con la reconciliación de capital, el ascenso
de piso, la asignación pegajosa de tratamiento, `validar_copy` y el
versionado de contenido — los 15 puntos corrieron sin un solo error. Esto
**no es lo mismo que probarlo contra tu proyecto real de Supabase** (no
hay forma de replicar aquí sus extensiones exactas, políticas de red, ni
tus datos reales) — pero es una verificación real de que el SQL es
válido y la lógica hace lo que dice, no solo una lectura del código.
Antes de considerar esto listo para los 20 usuarios: corre las tres
migraciones en orden sobre tu Supabase real y repite al menos la prueba
del kill switch y la de `resolver_evento` a mano una vez.

---

## Actualización 18-sep-2026 — Hardening de seguridad antes de publicar
## (auditoría propia, previa a los 20 usuarios)

Antes de subir esto se hizo una auditoría deliberada buscando huecos, no
solo una relectura de lo que ya se había escrito. Se encontraron y
cerraron **tres hallazgos reales**, los tres verificados corriendo la
migración completa contra un Postgres real (ver nota de metodología abajo
— la ronda anterior había cometido un error de prueba que esta ronda
corrigió).

**`0008_hardening_rls_y_limite_posiciones.sql`** (correr después de 0007):

1. **Crítico — `perfiles` se podía reescribir directo desde el cliente.**
   La política de UPDATE de `schema.sql` original nunca se revocó (a
   diferencia de `balances`, donde sí se hizo en la migración 0002).
   Cualquier usuario autenticado podía llamar
   `supabase.from('perfiles').update({...})` sobre su propia fila y
   cambiar `piso`, `racha_actual`, `volumen_depositado_acumulado`,
   `aciertos_acumulados` o `referido_por` directamente — sin pasar por
   `confirmar_posicion()`, `recalcular_piso()` ni `vincular_referido()`.
   En la práctica esto anulaba D6 y D7 por completo (autopromoverse a
   piso "obsidiana", inflar la racha a mano) y abría un camino real para
   cobrar la recompensa de referidos de D8 hacia una cuenta cómplice sin
   haber sido referido de verdad. Se cerró revocando esa política — nada
   en el código del cliente le hacía `update` a `perfiles` (se verificó
   con grep antes de tocar nada), así que cerrarlo no rompió nada.
2. **Alto — `balances` se podía insertar con un saldo inicial arbitrario.**
   La política de INSERT tampoco se había revocado nunca. Existía una
   ventana real entre el signup y el upsert que hacía el cliente
   (`asegurarPerfilYBalanceDemo` en `src/lib/demo.ts`) donde un usuario
   podía ganarle la carrera con su propio insert de un `demo_balance`
   inflado. Se cerró de raíz: la creación de perfil+balance ya NO la hace
   el cliente — un trigger en `auth.users` (`manejar_nuevo_usuario()`,
   `SECURITY DEFINER`) la hace atómicamente al signup, sin que el cliente
   participe. `asegurarPerfilYBalanceDemo()` se retiró de
   `src/lib/demo.ts` y de `src/app/auth/page.tsx`.
3. **Medio — nada impedía múltiples posiciones de un usuario en el mismo
   evento.** Como `capital_en_riesgo` es siempre 0 (abrir una posición no
   cuesta nada), un usuario podía confirmar el mismo evento una y otra
   vez y acumular `premio_potencial` sin límite — agotando él solo la
   exposición máxima de D5 y farmeando racha/volumen/piso de paso. No
   había ni un constraint en la base, ni un chequeo en
   `confirmar_posicion()`, ni una guarda en la UI. **Decisión de
   producto, confirmada contigo:** una sola posición por usuario por
   evento. Se agregó `unique (user_id, evento_id)` sobre `posiciones` +
   un chequeo explícito en `confirmar_posicion()` con mensaje legible +
   una guarda en `evento/[id]/page.tsx` que redirige a la posición
   existente en vez de dejar reintentar.

**Nota de metodología — un error propio que vale la pena dejar por
escrito:** la primera pasada de pruebas contra Postgres local corrió como
superusuario (`root`), y Postgres exime por default al dueño de una tabla
y a los superusuarios de RLS — así que el primer intento de "verificar"
el hallazgo 1 dio un falso negativo (pareció que el `UPDATE` prohibido sí
pasaba). Se detectó antes de reportarlo, se creó un rol sin privilegios
especiales (equivalente al `authenticated` real de Supabase, sin
ownership de las tablas) y se repitió la prueba — ahí sí se confirmó el
hueco y, después del fix, se confirmó el cierre (`UPDATE 0`, y el
`INSERT` a `balances` directamente rechazado por RLS). Se menciona esto
explícitamente porque es el mismo tipo de error que ya nos mordió una vez
esta sesión (la recursión de RLS en `operadores`) — la lección es correr
las pruebas de seguridad con el rol correcto, no solo con el más cómodo.

**Antes de correr esto en tu Supabase real:** si ya existen usuarios de
prueba con más de una posición en el mismo evento, el `unique constraint`
del hallazgo 3 va a fallar al crearse — corre primero
`select user_id, evento_id, count(*) from posiciones group by user_id, evento_id having count(*) > 1;`
y decide a mano qué posición duplicada conservar antes de aplicar esta
migración.

## Actualización 23-sep-2026 — Sistema de boletos por nivel (Entrada/Crecimiento/Elite)

Finanzas entregó una especificación nueva que **reemplaza el producto que
se lanza** (no el modelo `eventos`/`posiciones` de las migraciones
0002-0008, que sigue vivo como infraestructura y de hecho lo reutiliza):
tres niveles de "boleto" ($500/N=5,000, $3,000/N=1,500, $15,000/N=300)
donde un "ciclo" debe llenarse hasta su aforo o vence en una fecha fija;
si se llena, se resuelve con un **sorteo** (un premio, un ganador entre
quienes acertaron un resultado real y verificable); si no se llena a
tiempo, se cancela y se reembolsa el 100% a todos. Implementado en
`0009_sistema_boletos_por_nivel.sql` (productos, ciclos, boletos,
`comprar_boleto()`, `cancelar_ciclos_vencidos()`) y
`0010_sorteo_bono_reserva_global.sql` (`calcular_premio_ciclo()` con la
fórmula real de interés compuesto continuo + carry escalonado,
`resolver_ciclo()` con el sorteo server-side, bono de bienvenida para
Entrada, y la reserva/kill-switch GLOBAL, distinta del kill-switch por
evento de D5).

**Riesgo regulatorio — decisión de Dirección General, no de Tecnología.**
Un sorteo entre depositantes cae más directamente bajo la Ley Federal de
Juegos y Sorteos (SEGOB) que el modelo de predicción individual anterior
— de hecho, D2 del memo de Behavioral Forest se construyó explícitamente
como la defensa regulatoria contra justamente esto ("resolución nunca por
RNG"). Se te presentó este conflicto antes de escribir código y elegiste
construirlo tal cual, aceptando el riesgo conscientemente. La mitigación
que sí se aplicó: el `order by random()` de `resolver_ciclo()` **solo**
elige al ganador entre quienes ya acertaron un resultado real confirmado
por un operador — nunca decide el resultado en sí. Ver el comentario
extenso al inicio de `0009_sistema_boletos_por_nivel.sql`.

**Qué se probó, y cómo.** Igual que en la ronda anterior: setup de datos
de prueba como `root` (equivalente al `service_role`), pero toda la
lógica de negocio ejercida como `piso_authenticated` (rol sin superuser,
sin ownership de las tablas nuevas). Se corrieron, contra Postgres 16
real:
- Flujo feliz: llenar un ciclo Elite (N=300) hasta el aforo exacto,
  transición automática a `lleno`, resolver con sorteo, verificar
  reembolso del 100% a los 300 boletos + exactamente 1 ganador.
- El caso "nadie acertó" (todos responden distinto al resultado): cero
  ganadores, `premio_pagado` null, reembolso 100% de cualquier forma —
  qué pasa con ese premio no pagado el memo no lo dice (¿se acumula al
  siguiente ciclo del mismo nivel? ¿queda en reserva?) — se deja como
  pregunta abierta para Finanzas, no se inventó una respuesta.
- Los seis rechazos esperados: abrir/resolver un ciclo sin ser operador,
  comprar sin saldo suficiente, comprar dos boletos en el mismo ciclo,
  comprar después de la fecha límite, resolver un ciclo que no está
  "lleno".
- Cancelación por vencimiento (`cancelar_ciclos_vencidos()`): reembolso
  100% a un ciclo que nunca se llenó, y una segunda llamada inmediata NO
  vuelve a reembolsar el mismo ciclo.
- Bono de bienvenida: los cinco gates (antes del día 15, producto
  distinto de Entrada, ciclo inexistente, doble activación, monto mayor a
  $10,000) y que el piso de $20,000 sí se aplique sobre el premio cuando
  el bono está activo.
- Reserva/kill-switch global: inactivo mientras `reserva_fondeada` es
  `NULL` (pendiente de Tesorería), se activa al fondearla por debajo de
  la exposición real, y bloquea `comprar_boleto()` en **cualquier**
  ciclo/nivel mientras esté activo — no solo en el que disparó la alerta.
- El motor "real" de `calcular_premio_ciclo()` (con `tasa_cetes_anual` y
  `alpha_em` llenos): se verificó que la fórmula de interés compuesto
  continuo da el número exacto esperado y que escoge el tramo de carry
  correcto (12/20/30%) según el tamaño del premio bruto.
- D1 (`verificar_integridad_capital()`) se corrió después de cada bloque:
  cero violaciones pese a que este modelo, a diferencia de `posiciones`,
  sí debita y acredita capital real en el ledger.
- RLS directa sobre las tablas nuevas: insertar en `ciclos`/`boletos` sin
  pasar por `abrir_ciclo()`/`comprar_boleto()` se rechaza; un no-operador
  no puede editar `productos` ni leer `reserva_config`/`bonos_bienvenida`.

**Bugs reales encontrados y corregidos durante esta ronda** (antes de
entregar, no reportados por ti — autorevisión + pruebas, mismo estándar
que la migración 0008):
1. **`RAISE EXCEPTION` con conteo de parámetros equivocado** en el
   mensaje del kill-switch global (`comprar_boleto()`, 0010) — un `%% %%`
   de más dejaba solo 2 placeholders para 3 argumentos. Postgres lo
   hubiera rechazado en el momento de compilar la función (no es un bug
   silencioso, pero sí hubiera tumbado el despliegue completo de la
   migración). Corregido a un placeholder + un `%%` literal.
2. **`RAISE` con especificador estilo printf (`%.1f`)** en
   `activar_bono_bienvenida()` — PL/pgSQL no soporta precisión en `RAISE`,
   solo `%` planos; el `.1f` se hubiera quedado pegado como texto literal
   en el mensaje de error ("...va en el día 15.23456.1f"). Corregido
   redondeando el valor antes de pasarlo.
3. **Falta de chequeo explícito de ciclo inexistente en
   `activar_bono_bienvenida()`** — a diferencia de todas las funciones
   hermanas (`abrir_ciclo`, `comprar_boleto`, `resolver_ciclo`,
   `calcular_premio_ciclo`), esta no verificaba `v_ciclo.id is null` antes
   de seguir. Con un id inexistente, las comparaciones contra columnas
   `null` simplemente no disparaban (`NULL <> 'entrada'` es `NULL`, no
   `true`, así que el `IF` no entra), y el error real que salía era un
   crudo "violates foreign key constraint" al insertar en
   `bonos_bienvenida` — confuso para quien opera. Se agregó el mismo
   chequeo explícito que ya tenían las demás; verificado con la prueba
   6b2.
4. **Falta de `FOR UPDATE` en el balance dentro de `comprar_boleto()`**
   (0009 y su redefinición en 0010) — sin el lock de fila, dos compras
   concurrentes del mismo usuario en **dos ciclos distintos** podían leer
   el mismo saldo antes de que cualquiera confirmara su movimiento, y
   ambas pasar el chequeo de saldo aunque juntas lo rebasaran. El
   `unique(ciclo_id, user_id)` ya cubría "dos boletos en el mismo ciclo";
   esto cubre el caso de ciclos distintos al mismo tiempo. No se pudo
   escribir una prueba de concurrencia real desde `psql` secuencial —
   este es un fix por inspección de código, no verificado con una carrera
   real; queda como pendiente si algún día se quiere probar con conexiones
   paralelas de verdad.
5. **Falta de `FOR UPDATE` en el cursor de `cancelar_ciclos_vencidos()`**
   — dos invocaciones concurrentes (el cron real y, por ejemplo, un
   operador con doble clic en un botón futuro) podían ambas leer el mismo
   ciclo vencido antes de que cualquiera lo marcara `cancelado`, y
   reembolsar el capital dos veces. Mismo comentario que el punto
   anterior sobre no poder probar la carrera real desde este sandbox — se
   verificó sí que **dos llamadas secuenciales** no reembolsan dos veces
   (prueba de bloque 5), que es lo que sí se puede probar aquí.
6. **Falta de `FOR UPDATE` sobre el ciclo en `resolver_ciclo()`** — el
   más serio de los tres: sin el lock, dos operadores resolviendo el
   mismo ciclo casi al mismo tiempo podían ambos pasar el chequeo de
   `estado = 'lleno'` y pagar el premio dos veces. Mismo límite de prueba
   que los dos anteriores (no hay forma de forzar una carrera real desde
   `psql` secuencial en este sandbox) — corregido por inspección,
   siguiendo el mismo patrón de lock que ya usa `comprar_boleto()` sobre
   el propio ciclo.

Los tres últimos puntos comparten la misma limitación honesta: se
corrigieron por revisión de código (el patrón de `FOR UPDATE` es
estándar y correcto), pero **no se pudo verificar con una carrera de
concurrencia real** desde este sandbox de pruebas secuencial — eso
requeriría dos conexiones simultáneas de verdad (por ejemplo, con
`pgbench` o dos sesiones de `psql` en paralelo), que no se armó esta
ronda. Queda anotado como el pendiente de prueba más importante de esta
entrega si se quiere ir más a fondo antes de producción.

**Sigue pendiente / no se puede verificar desde este sandbox:**
- No hay `pg_cron` ni Edge Functions programadas aquí — `cancelar_ciclos_vencidos()`
  y `activar_bono_bienvenida()` están listas para invocarse periódicamente
  desde un cron real de Supabase una vez desplegado, pero nunca se han
  ejecutado así "solas en el tiempo".
- Los cortes exactos del carry escalonado (`producto_carry_tramos`) son
  un estimado (terciles de ejemplo) — Finanzas no dio los números
  exactos, solo los tres porcentajes (12/20/30%).
- La mecánica exacta de cómo el subsidio de adquisición del bono de
  bienvenida "se convierte" en rendimiento no está modelada — se
  implementó como un piso directo sobre el premio neto, documentado como
  simplificación.
- Qué pasa con el premio no pagado cuando nadie acierta (bloque 2 de la
  prueba) es una pregunta abierta para Finanzas, no una decisión tomada
  aquí.
- La página web del portal financiero interno (el segundo artifact que
  compartiste) sigue explícitamente en fase 2, por tu propia instrucción
  de secuenciar primero la app.

### UI -- Admin y Consumer

**Admin** (nuevo, sobre el patrón ya establecido de /admin/eventos y
/admin/riesgo):
- `/admin/productos` — edita los 3 niveles (precio, gente requerida, días
  de resolución, alpha_em, premio estático) y sus tramos de carry
  escalonado. Mientras `alpha_em` esté vacío, el aviso en pantalla explica
  que `calcular_premio_ciclo()` sigue en modo "estático".
- `/admin/ciclos` — abrir un ciclo nuevo (producto + evento real), ver
  barra de avance de aforo ("faltan N lugares", nunca una cuenta
  regresiva de días), activar el bono de bienvenida cuando aplica,
  resolver con el sorteo. Incluye un botón manual "Cancelar vencidos
  ahora" -- sustituto de `cancelar_ciclos_vencidos()` mientras no exista
  un cron real conectado.
- `/admin/reserva` — configura `reserva_config` y muestra
  `calcular_exposicion_global()` en vivo, con el mismo lenguaje de
  advertencia que el kill switch de Riesgo (D5) pero aclarando que este es
  el GLOBAL, sobre todos los niveles a la vez.

**Consumer** (nuevo, mismo sistema visual que /evento, /posicion,
/resultado):
- `/ciclos` — lista de niveles activos con barra de avance.
- `/ciclo/[id]` — responder sí/no y comprar el boleto. Incluye la
  "responsibility condition" de la sección 7 del memo (vía Behavioral):
  fricción obligatoria (checkbox que debe marcarse, el botón de comprar
  se queda deshabilitado sin ella) cuando el boleto elegido es más de 3x
  el ticket promedio histórico del usuario (posiciones clásicas + boletos
  anteriores juntos, ponderado por `volumen_depositado_acumulado`). El
  memo no da la fórmula exacta de "mucho más grande" -- 3x es un umbral
  estimado, documentado como tal en el código
  (`calcularTicketPromedioHistorico`, `src/lib/boletos.ts`). Sin
  historial previo, no se dispara -- no hay contra qué comparar.
- `/boleto` — pantalla de espera mientras el nivel se llena (se refresca
  sola cada 15s). A diferencia de `/posicion`, no tiene botón de "Simular
  resultado ahora": resolver un ciclo es exclusivo de un operador y
  depende de que el nivel completo se llene, no es algo que un usuario
  pueda adelantar solo.
- `/boleto-resultado` — tres estados, no dos: ganaste el sorteo,
  acertaste pero el sorteo no te tocó, o no acertaste. En los tres, el
  depósito regresa al 100%.
- `/home` gana un segundo botón ("Boletos por nivel") junto al "Ver
  eventos" que ya existía -- **decisión pendiente, no tomada aquí**: si
  este sistema debe reemplazar "Ver eventos" como el CTA principal del
  Home es una decisión de producto/arquitectura de información más
  grande que no le corresponde inventar a Tecnología sola. Se dejó como
  una segunda entrada, sin quitar la primera, hasta que Dirección
  General lo confirme.

Build verificado con `npm run build` — compila y tipa limpio, las 6
páginas nuevas incluidas.

---
*PISO — MVP del loop · Agosto-Septiembre 2026 · Confidencial*
