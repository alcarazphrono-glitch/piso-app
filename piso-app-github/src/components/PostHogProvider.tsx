"use client";

import { useEffect } from "react";
import { initPostHog, trackFunnel } from "@/lib/posthog";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
    // Primer paso del funnel exigido por el memo de DG: "Visita".
    trackFunnel("visita");
  }, []);

  return <>{children}</>;
}
