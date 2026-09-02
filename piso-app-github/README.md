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
*PISO — MVP del loop · Agosto 2026 · Confidencial*
