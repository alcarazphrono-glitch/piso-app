import type { Metadata } from "next";
import "./globals.css";
import { PostHogProvider } from "@/components/PostHogProvider";

// Nota: las tipografías se cargan por <link> en globals.css (@import),
// no con next/font/google -- next/font descarga las fuentes durante el
// build en el servidor, y ese paso necesita salida a internet en la
// máquina que compila. Con <link>, es el navegador de quien visita la
// página el que las pide, exactamente como ya hace piso_fase1/generate_landing.py.
// Si el equipo prefiere next/font en el pipeline real de CI (que sí tiene
// salida a internet), es un cambio de una línea -- no de arquitectura.

export const metadata: Metadata = {
  title: "PISO",
  description: "Protege tu piso. Ve por más.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body className="font-body min-h-screen">
        {/* PostHog desde el primer render (Prioridad 5 del memo de DG) */}
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
