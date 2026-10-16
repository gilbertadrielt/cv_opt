import { FALLBACK_SEVERITY } from "@/domain/severity";
import type { Severity } from "@/domain/types";

interface SeverityClasses {
  /** Solid fill for swatches and detection-box tags. */
  fill: string;
  border: string;
  text: string;
  /** Soft halo used to mark the focused detection box. */
  ring: string;
}

/**
 * Severity → Tailwind classes.
 *
 * Written as complete literal strings rather than assembled at runtime
 * (`bg-${severity}`), because Tailwind's scanner only emits classes it can see
 * spelled out in the source.
 */
export const SEVERITY_CLASSES: Record<Severity, SeverityClasses> = {
  critical: {
    fill: "bg-critical",
    border: "border-critical",
    text: "text-critical",
    ring: "ring-critical/35",
  },
  major: {
    fill: "bg-major",
    border: "border-major",
    text: "text-major",
    ring: "ring-major/35",
  },
  cosmetic: {
    fill: "bg-cosmetic",
    border: "border-cosmetic",
    text: "text-cosmetic",
    ring: "ring-cosmetic/35",
  },
};

export function severityClasses(severity: Severity | undefined): SeverityClasses {
  return SEVERITY_CLASSES[severity ?? FALLBACK_SEVERITY];
}
