"use client";

import posthog from "posthog-js";

// Prioridad 5 del memo de Dirección General: "PostHog para analytics desde
// el día uno -- no lo agreguen después, lo ponen desde el primer deploy."
//
// initPostHog() se llama una vez, desde src/app/layout.tsx (RootLayout),
// para que TODA la app quede instrumentada desde el primer render, no solo
// las pantallas que alguien se acuerde de instrumentar.

let inicializado = false;

export function initPostHog() {
  if (inicializado || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  if (!key) {
    // eslint-disable-next-line no-console
    console.warn("[PISO] Falta NEXT_PUBLIC_POSTHOG_KEY -- el funnel no se está midiendo. Ver README.md.");
    return;
  }
  posthog.init(key, {
    api_host: host,
    capture_pageview: true,
    capture_pageleave: true,
  });
  inicializado = true;
}

// -----------------------------------------------------------------------
// El funnel exacto que pide el memo de DG, sección final:
//   Visita → Registro → Demo activo → Primer evento → Segundo evento
//   → Quiere subir de piso → Quiere modo real → Depósito real
// Cada paso es UNA función aquí -- así nadie dispara un evento con el
// nombre mal escrito desde tres archivos distintos.
// -----------------------------------------------------------------------

export type FunnelEvento =
  | "visita"
  | "registro"
  | "demo_activo"
  | "primer_evento"
  | "segundo_evento"
  | "quiere_subir_piso"
  | "quiere_modo_real"
  | "deposito_real";

export function trackFunnel(evento: FunnelEvento, props: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  posthog.capture(evento, { ...props, timestamp: new Date().toISOString() });
}

export function identifyUsuario(userId: string, props: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  posthog.identify(userId, props);
}

export { posthog };
