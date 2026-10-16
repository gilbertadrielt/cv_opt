import { findDefect } from "./knowledge-base";
import { compareSeverity, FALLBACK_SEVERITY } from "./severity";
import type { DefectDefinition, Detection, DetectionsByPhoto, Disposition, Severity } from "./types";

/** All detections across every photo of a run, in photo order. */
export function allDetections(detectionsByPhoto: DetectionsByPhoto): Detection[] {
  return Object.values(detectionsByPhoto).flat();
}

/**
 * The definition behind a detection.
 *
 * A run in History holds the detections it produced, but the knowledge base it
 * was run against can be edited afterwards. Rather than dropping a finding
 * whose key no longer resolves — which would make the counts disagree with the
 * boxes on screen — we substitute a placeholder so the region stays visible and
 * the gap is stated plainly.
 */
export function resolveDefect(
  defectKey: string,
  defects: readonly DefectDefinition[],
): DefectDefinition {
  return (
    findDefect(defects, defectKey) ?? {
      key: defectKey,
      name: defectKey,
      severity: FALLBACK_SEVERITY,
      description:
        "This defect is no longer defined in the knowledge base for this product line.",
      impacts: [],
    }
  );
}

/** Severity of a detection, via `resolveDefect`. */
export function severityOf(detection: Detection, defects: readonly DefectDefinition[]): Severity {
  return resolveDefect(detection.defectKey, defects).severity;
}

/** The most severe finding among `detections`, or `null` when there are none. */
export function worstSeverity(
  detections: readonly Detection[],
  defects: readonly DefectDefinition[],
): Severity | null {
  return detections.reduce<Severity | null>((worst, detection) => {
    const severity = severityOf(detection, defects);
    return worst === null || compareSeverity(severity, worst) < 0 ? severity : worst;
  }, null);
}

export function countBySeverity(
  detections: readonly Detection[],
  defects: readonly DefectDefinition[],
  severity: Severity,
): number {
  return detections.filter((detection) => severityOf(detection, defects) === severity).length;
}

export interface DispositionResult {
  code: Disposition;
  label: string;
}

/**
 * The station's disposition rule: any confirmed critical defect scraps the
 * unit, anything else flagged goes to rework review, and a clean scan passes.
 */
export function dispositionFor(criticalCount: number, totalCount: number): DispositionResult {
  if (criticalCount > 0) return { code: "scrap", label: "Scrap — critical defect confirmed" };
  if (totalCount > 0) return { code: "rework-review", label: "Route to rework review" };
  return { code: "pass", label: "Pass — no defect found" };
}
