"use client";

import { useRouter } from "next/navigation";
import { Screen, BackChevron } from "@/components/ui";

// Trust Center -- memo Behavioral, sección 6: "implementado tal cual, sin
// cambios. Es la única pantalla donde los datos no dan ninguna razón para
// desviarnos de lo que pidió DG." Incluye, a propósito, la pregunta sobre
// qué pasa si PISO desaparece con la respuesta marcada como pendiente de
// Legal -- la pregunta visible genera más confianza que esconderla.

const PREGUNTAS = [
  {
    q: "¿Dónde está mi dinero?",
    a: "Tu depósito se invierte en CETES — valores gubernamentales emitidos por el gobierno mexicano. Es el instrumento de ahorro más seguro disponible en México. Tu capital no se usa para pagar premios de otros usuarios.",
  },
  {
    q: "¿Puedo perder mi depósito?",
    a: "No. Tu depósito inicial siempre está disponible para retiro. Lo que participa en los eventos es únicamente el rendimiento que tu dinero genera en CETES durante el período del evento.",
  },
  {
    q: "¿Cómo gana dinero PISO?",
    a: "PISO retiene el 12% de cada premio pagado. Si no hay premio, no cobramos nada adicional sobre tu depósito. Nuestros intereses están alineados con los tuyos: ganamos cuando tú ganas.",
  },
  {
    q: "¿Qué pasa si PISO desaparece?",
    a: "Tu capital está custodiado en instrumentos de deuda gubernamental separados del capital operativo de PISO. En el escenario de discontinuidad del servicio, tu depósito es recuperable.",
    pendienteLegal: true,
  },
];

export default function TrustCenterPage() {
  const router = useRouter();

  return (
    <Screen>
      <div className="flex items-center gap-3.5 pt-2">
        <BackChevron onClick={() => router.back()} />
        <h1 className="font-display text-[19px] font-bold">¿Cómo funciona PISO?</h1>
      </div>

      <div className="mt-[26px] flex flex-col gap-[22px]">
        {PREGUNTAS.map((p, i) => (
          <div key={p.q} className={i > 0 ? "border-t border-line pt-[22px]" : ""}>
            <p className="mb-2 font-display text-base font-semibold">{p.q}</p>
            <p className="text-sm leading-relaxed text-ink-soft">{p.a}</p>
            {p.pendienteLegal && (
              <p className="mt-2 text-[11.5px] italic text-faint">Respuesta pendiente de validación de Legal.</p>
            )}
          </div>
        ))}
      </div>
    </Screen>
  );
}
