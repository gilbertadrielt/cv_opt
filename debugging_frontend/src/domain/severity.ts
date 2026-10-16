import type { Severity } from "./types";

/** Worst first. Used for sorting and for picking the headline severity of a run. */
export const SEVERITY_ORDER = ["critical", "major", "cosmetic"] as const satisfies readonly Severity[];

export interface SeverityMeta {
  label: string;
  /**
   * Raw hex, needed where Tailwind classes cannot reach: `<canvas>` annotation
   * and the standalone HTML report. For DOM styling use `SEVERITY_CLASSES`
   * from `@/lib/severity-styles` instead so the classes stay static.
   */
  hex: string;
}

export const SEVERITY: Record<Severity, SeverityMeta> = {
  critical: { label: "Critical", hex: "#C7382C" },
  major: { label: "Major", hex: "#B67A18" },
  cosmetic: { label: "Cosmetic", hex: "#7E8A8C" },
};

/** Severity assumed when a detection references a defect that is no longer in the knowledge base. */
export const FALLBACK_SEVERITY: Severity = "cosmetic";

export function isSeverity(value: string): value is Severity {
  return value in SEVERITY;
}

export function severityMeta(severity: Severity | undefined): SeverityMeta {
  return SEVERITY[severity ?? FALLBACK_SEVERITY];
}

/** Negative when `a` is more severe than `b`. Suitable for `Array.prototype.sort`. */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}
