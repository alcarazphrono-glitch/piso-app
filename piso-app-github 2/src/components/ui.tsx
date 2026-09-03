import { ButtonHTMLAttributes, ReactNode } from "react";

// Rediseño conductual (memo Behavioral Forest, 2-sep-2026). Componentes
// compartidos reconstruidos sobre el sistema visual nuevo -- ver
// globals.css para los tokens y el porqué del cambio completo de marca.

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-[460px] bg-bg px-6 pb-16 pt-7 text-ink">
      {children}
    </main>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <ShieldIcon className="h-[22px] w-[22px] text-mint" strokeWidth={1.8} />
      <span className="font-display text-[19px] font-bold tracking-[-0.01em]">PISO</span>
    </div>
  );
}

export function BackChevron({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} aria-label="Regresar" className="text-ink-soft">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </button>
  );
}

export function RachaBadge({ n, tone = "dark" }: { n: number; tone?: "dark" | "light" }) {
  if (tone === "light") {
    return (
      <div className="flex items-center gap-1.5 self-center rounded-full bg-ganaste-chip px-3 py-1.5">
        <FlameIcon className="h-3.5 w-3.5 text-ganaste-ink" strokeWidth={2} />
        <span className="text-[12.5px] font-bold text-ganaste-ink">Racha {n}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-gold-chip px-3 py-1.5">
      <FlameIcon className="h-3.5 w-3.5 text-gold" strokeWidth={2} />
      <span className="text-[12.5px] font-semibold text-gold-ink">Racha {n}</span>
    </div>
  );
}

export function PracticeBar() {
  return <p className="mt-3.5 text-[12.5px] tracking-[0.01em] text-ink-soft">Modo práctica — explora sin dinero real</p>;
}

export function H1({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={`font-display text-[25px] font-bold leading-[1.2] tracking-[-0.01em] [text-wrap:balance] ${className}`}>
      {children}
    </h1>
  );
}

export function Lede({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[15px] leading-relaxed text-ink-soft ${className}`}>{children}</p>;
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-full rounded-card bg-mint px-4 py-4 text-center font-body font-bold text-mint-ink transition-opacity hover:opacity-90 disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// Botón oscuro (fondo -ink-) usado solo en la pantalla Ganaste, que tiene
// fondo claro -- el mint no tiene contraste ahí, así que el CTA se invierte.
export function InkButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-full rounded-card bg-ganaste-ink px-4 py-4 text-center font-body font-bold text-[oklch(94%_0.035_85)] transition-opacity hover:opacity-90 disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-full rounded-card border border-line bg-surface px-4 py-4 text-center font-body font-semibold text-ink transition-colors hover:border-ink-soft disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>{children}</div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-display tabular-nums ${className}`}>{children}</span>;
}

// ---------------------------------------------------------------------
// Iconos -- SVG inline, no emoji literal (memo Behavioral, sección 3:
// "ícono SVG, no emoji literal -- más limpio en producción").
// ---------------------------------------------------------------------

type IconProps = { className?: string; strokeWidth?: number };

export function ShieldIcon({ className = "h-4 w-4", strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    </svg>
  );
}

export function ShieldCheckIcon({ className = "h-4 w-4", strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function FlameIcon({ className = "h-4 w-4", strokeWidth = 2 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2c1 3-2 4-2 7a4 4 0 0 0 8 0c0-2-1-3-1-3s1 4-2 4-1-4 1-6c-3 0-5 2-6 5-1 3 1 6 4 6a5 5 0 0 0 5-5c0-4-3-6-3-8z" />
    </svg>
  );
}

export function CalendarIcon({ className = "h-4 w-4", strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 20h18M12 3l9 5H3l9-5z" />
    </svg>
  );
}

export function TrophyIcon({ className = "h-4 w-4", strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M7 5H4v2a4 4 0 0 0 4 4" />
      <path d="M17 5h3v2a4 4 0 0 1-4 4" />
      <path d="M10 15v3H8v2h8v-2h-2v-3" />
    </svg>
  );
}

export function TargetIcon({ className = "h-4 w-4", strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function ArrowLightningIcon({ className = "h-4 w-4", strokeWidth = 2 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

export function MailIcon({ className = "h-4 w-4", strokeWidth = 1.8 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

export function LockIcon({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
