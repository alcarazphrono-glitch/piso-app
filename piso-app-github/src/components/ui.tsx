import { ButtonHTMLAttributes, ReactNode } from "react";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-[460px] px-6 pb-16 pt-8">{children}</main>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 inline-flex items-center gap-1.5 text-xs text-ink-soft">{children}</div>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return (
    <h1 className="mb-3 font-display text-[32px] font-bold leading-[1.12] tracking-[-0.015em] [text-wrap:balance]">
      {children}
    </h1>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="mb-6 max-w-[38ch] text-[16px] leading-relaxed text-ink-soft">{children}</p>;
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-full rounded-card bg-ink px-4 py-4 text-center font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40 ${className}`}
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
      className={`w-full rounded-card border border-line bg-surface px-4 py-4 text-center font-semibold text-ink transition-colors hover:bg-line/30 disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "teal" }: { children: ReactNode; tone?: "teal" | "gold" }) {
  const color = tone === "teal" ? "text-teal" : "text-gold";
  return (
    <span
      className={`inline-block rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.06em] ${color}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{children}</span>;
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
