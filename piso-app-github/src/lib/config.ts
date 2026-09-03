// Variables de hipótesis del rediseño conductual (memo Behavioral Forest,
// 2-sep-2026, "Especificación de implementación — Rediseño conductual del
// MVP (piloto 18-24)"). Igual que en Fase 1: esto son hipótesis, no verdades
// -- si algo falla, se revisan y se documenta por qué, no se hardcodean
// silenciosamente en cada pantalla.

export const TICKET_DEMO_MXN = 500; // Dato 2: 71% de usuarios reales deposita $200-500.
// El memo de DG usaba $1,000 como ejemplo -- Behavioral lo bajó a $500 por
// no ser representativo del ticket real.

// ---------------------------------------------------------------------
// PREMIO POR EVENTO -- pendiente de reconciliación con Finanzas.
//
// Banxico: Behavioral entregó $10,919 para d=$500 (Bloque 8 de simulación
// de DG, ya validado). OJO: esto NO cuadra linealmente con el $8,750 que
// DG calculó para d=$1,000 en su memo original (debería ser MAYOR si
// escalara, no menor). Behavioral pidió explícitamente que Finanzas
// confirme cuál de los dos es el canónico antes de hardcodear esto en
// producción -- mientras tanto usamos $10,919 porque corresponde al
// ticket que la gente realmente deposita, tal como indicó el memo.
//
// INPC: Behavioral pidió el mismo tratamiento ("mismo componente que
// Evento") pero NO entregó un número validado -- solo dijo "Finanzas debe
// correr el premio equivalente con p=0.40 usando la misma metodología del
// bloque 8". No existe ese número todavía. Usamos la fórmula demo simplificada
// (piso_fase0 no está conectado aquí) como placeholder visible, NO como
// cifra de negocio. No lanzar a los 20 usuarios externos con este número
// sin que Finanzas lo confirme.
export const RECONCILIACION_PENDIENTE = {
  banxico: {
    estado: "usar_valor_behavioral" as const,
    nota:
      "$10,919 (Behavioral, Bloque 8, d=$500) vs $8,750 (DG, memo original, d=$1,000) " +
      "no cuadran linealmente. Confirmar con Finanzas cuál es el canónico.",
  },
  inpc: {
    estado: "sin_validar" as const,
    nota:
      "Sin número de Finanzas todavía. Placeholder calculado con la fórmula demo " +
      "simplificada (premioPotencialDemo), NO es una cifra de negocio real.",
  },
};

const MULTIPLICADOR_DEMO_PLACEHOLDER = 0.55;
function premioPlaceholder(probabilidad: number): number {
  return Math.round((TICKET_DEMO_MXN * MULTIPLICADOR_DEMO_PLACEHOLDER) / probabilidad);
}

export const PREMIOS_POR_EVENTO: Record<string, number> = {
  banxico_baja_tasas: 10919, // Behavioral, Bloque 8 -- validado para d=$500.
  inpc_bajo: premioPlaceholder(0.4), // placeholder, ver RECONCILIACION_PENDIENTE.inpc
};

export function obtenerPremio(eventoId: string): number {
  return PREMIOS_POR_EVENTO[eventoId] ?? premioPlaceholder(0.35);
}

// Días hasta resolución, para la pantalla de Posición (no tocada por el
// memo Behavioral, se mantiene tal cual). Banxico decide tasas cada 42
// días (documento de negocio §2.3); INPC se publica mensualmente, así que
// usamos una ventana más corta como referencia -- ninguna de las dos
// bloquea el botón "Simular resultado ahora", que es exclusivo de demo.
export const DIAS_HASTA_RESOLUCION: Record<string, number> = {
  banxico_baja_tasas: 42,
  inpc_bajo: 7,
};
