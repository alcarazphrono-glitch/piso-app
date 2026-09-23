"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Screen, BackChevron } from "@/components/ui";
import { obtenerTrustCenter, PreguntaTrustCenter } from "@/lib/contenido";

// Trust Center -- memo Behavioral, sección 6: "implementado tal cual, sin
// cambios. Es la única pantalla donde los datos no dan ninguna razón para
// desviarnos de lo que pidió DG." Incluye, a propósito, la pregunta sobre
// qué pasa si PISO desaparece con la respuesta marcada como pendiente de
// Legal -- la pregunta visible genera más confianza que esconderla.
//
// Checkpoint 17-sep-2026 (Behavioral Forest, D14/D15): las 4 preguntas ya
// no viven hardcodeadas aquí -- se leen de contenido_versionado (migración
// 0007) vía src/lib/contenido.ts, con el mismo copy exacto que tenía esta
// pantalla, para que este deploy no cambie ni una palabra por sí solo. La
// diferencia es que ahora Legal (o un operador) puede editar y publicar
// una respuesta nueva desde /admin/contenido sin depender de un deploy de
// código -- que es exactamente lo que D15 pide para la respuesta legal
// pendiente.

export default function TrustCenterPage() {
  const router = useRouter();
  const [preguntas, setPreguntas] = useState<PreguntaTrustCenter[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    obtenerTrustCenter()
      .then(setPreguntas)
      .finally(() => setCargando(false));
  }, []);

  return (
    <Screen>
      <div className="flex items-center gap-3.5 pt-2">
        <BackChevron onClick={() => router.back()} />
        <h1 className="font-display text-[19px] font-bold">¿Cómo funciona PISO?</h1>
      </div>

      {cargando ? (
        <p className="mt-6 text-sm text-ink-soft">Cargando…</p>
      ) : (
        <div className="mt-[26px] flex flex-col gap-[22px]">
          {preguntas.map((p, i) => (
            <div key={p.clave} className={i > 0 ? "border-t border-line pt-[22px]" : ""}>
              <p className="mb-2 font-display text-base font-semibold">{p.q}</p>
              <p className="text-sm leading-relaxed text-ink-soft">{p.a}</p>
              {p.pendienteLegal && (
                <p className="mt-2 text-[11.5px] italic text-faint">Respuesta pendiente de validación de Legal.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
