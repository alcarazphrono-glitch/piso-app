import type { Config } from "tailwindcss";

// Rediseño conductual (memo Behavioral Forest, 2-sep-2026): tokens leídos
// directo de globals.css, que a su vez son los valores oklch() literales
// del lienzo publicado. "ganaste-*" son la única excepción de fondo claro
// -- ver nota en globals.css.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        line: "var(--card-border)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        faint: "var(--faint)",
        mint: "var(--mint)",
        "mint-ink": "var(--mint-ink)",
        "mint-chip": "var(--mint-chip)",
        gold: "var(--gold)",
        "gold-chip": "var(--gold-chip)",
        "gold-ink": "var(--gold-ink)",
        "ganaste-bg": "var(--ganaste-bg)",
        "ganaste-ink": "var(--ganaste-ink)",
        "ganaste-ink-soft": "var(--ganaste-ink-soft)",
        "ganaste-card": "var(--ganaste-card)",
        "ganaste-card-border": "var(--ganaste-card-border)",
        "ganaste-chip": "var(--ganaste-chip)",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
        body: ["var(--font-body)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "14px",
      },
    },
  },
  plugins: [],
};
export default config;
