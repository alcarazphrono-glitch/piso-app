// Mesa de derivados -- bases estocásticas. Todo aquí es matemática pura y
// determinista: mismos datos, mismo número. Claude nunca calcula la
// probabilidad; solo redacta la lectura sobre lo que sale de aquí.

// Φ(x), CDF normal estándar (Abramowitz-Stegun 26.2.17, error < 7.5e-8).
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function media(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function desviacion(xs: number[]): number {
  const m = media(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

const recorta = (p: number) => Math.min(0.99, Math.max(0.01, p));

export interface BaseEstocastica {
  modelo: string;
  probabilidad: number;
  prob_baja: number;
  prob_alta: number;
  parametros: Record<string, number | string>;
}

// Tasas: posterior Beta(1 + recortes, 1 + decisiones − recortes). Intervalo
// del 90% por aproximación normal a la Beta.
export function betaBinomial(recortes: number, decisiones: number): BaseEstocastica {
  const a = 1 + recortes;
  const b = 1 + Math.max(0, decisiones - recortes);
  const m = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return {
    modelo: "Beta-Binomial",
    probabilidad: recorta(m),
    prob_baja: recorta(m - 1.645 * sd),
    prob_alta: recorta(m + 1.645 * sd),
    parametros: { alpha: a, beta: b, recortes, decisiones },
  };
}

// Inflación: π_{t+1} = π_t + ε, ε ~ N(μ, σ). P(π_{t+1} < umbral). El
// intervalo mueve μ ± 1.645·σ/√n (incertidumbre de la media estimada).
export function caminataNormal(actual: number, cambios: number[], umbral: number): BaseEstocastica {
  const mu = media(cambios);
  const sigma = Math.max(1e-6, desviacion(cambios));
  const se = sigma / Math.sqrt(cambios.length);
  const p = (m: number) => normCdf((umbral - actual - m) / sigma);
  return {
    modelo: "Caminata aleatoria normal",
    probabilidad: recorta(p(mu)),
    prob_baja: recorta(p(mu + 1.645 * se)),
    prob_alta: recorta(p(mu - 1.645 * se)),
    parametros: { actual, umbral, mu: +mu.toFixed(4), sigma: +sigma.toFixed(4), n: cambios.length },
  };
}

// Tipo de cambio: GBM sin drift (martingala). P(S_T > K) = Φ(d2),
// d2 = (ln(S/K) − σ²T/2) / (σ√T), σ diaria. El intervalo usa los extremos
// del IC 90% de σ (aprox. χ² para n grande: σ·(1 ± 1.645/√(2(n−1)))).
export function browniano(spot: number, rendimientosLog: number[], strike: number, diasHabiles: number): BaseEstocastica {
  const sigma = desviacion(rendimientosLog);
  const n = rendimientosLog.length;
  const p = (s: number) => {
    const v = s * Math.sqrt(diasHabiles);
    return normCdf((Math.log(spot / strike) - (v * v) / 2) / v);
  };
  const k = 1.645 / Math.sqrt(2 * (n - 1));
  const pA = p(sigma * (1 - k));
  const pB = p(sigma * (1 + k));
  return {
    modelo: "Movimiento browniano geométrico",
    probabilidad: recorta(p(sigma)),
    prob_baja: recorta(Math.min(pA, pB)),
    prob_alta: recorta(Math.max(pA, pB)),
    parametros: {
      spot,
      strike,
      sigma_diaria: +sigma.toFixed(5),
      sigma_anual: +(sigma * Math.sqrt(252)).toFixed(4),
      dias_habiles: diasHabiles,
      n,
    },
  };
}
