import type { Metadata } from "next";

// Metadata propia de la landing: es la página que se comparte en TikTok,
// Instagram y WhatsApp, así que el título y la vista previa importan.
export const metadata: Metadata = {
  title: "PISO · Únete a la lista de espera",
  description:
    "Tu capital no se toca. Solo pones en juego lo que tu dinero genera. Aparta tu lugar antes del lanzamiento.",
  openGraph: {
    title: "PISO · Tu dinero no se arriesga",
    description: "Tu capital no se toca. Solo pones en juego lo que tu dinero genera. Aparta tu lugar.",
    type: "website",
    locale: "es_MX",
  },
};

export default function UneteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
