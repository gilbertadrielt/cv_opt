import { resolveDefect } from "@/domain/inspection";
import type { BoundingBox, DefectDefinition } from "@/domain/types";
import { cn } from "@/lib/cn";
import { severityClasses } from "@/lib/severity-styles";

/** Boxes stagger in so the eye can follow the order the model reported them. */
const STAGGER_MS = 90;

/**
 * The minimum a box needs to be drawn: an identity, the defect it marks, and
 * where it sits. Satisfied by both `Detection` (from the model) and
 * `AnnotatedRegion` (drawn by an inspector), so one overlay serves both.
 */
export interface Region {
  id: string;
  defectKey: string;
  box: BoundingBox;
}

/**
 * Labelled boxes drawn over a photo.
 *
 * Positioned in percentages from the normalised boxes, so they stay aligned at
 * any render size without measuring the image. Non-interactive by design —
 * selection belongs to the findings list, which is a real list of controls.
 */
export function RegionBoxes({
  regions,
  defects,
  focusedRegionId = null,
  animate = false,
}: {
  regions: readonly Region[];
  defects: readonly DefectDefinition[];
  /** When set, that box is ringed and the others are dimmed. */
  focusedRegionId?: string | null;
  animate?: boolean;
}) {
  return (
    <>
      {regions.map((region, index) => {
        const defect = resolveDefect(region.defectKey, defects);
        const styles = severityClasses(defect.severity);
        const isFocused = focusedRegionId === region.id;
        const isDimmed = focusedRegionId !== null && !isFocused;

        return (
          <div
            key={region.id}
            aria-hidden
            className={cn(
              "pointer-events-none absolute border-[1.5px]",
              styles.border,
              animate && "animate-box-in motion-reduce:animate-none",
              isDimmed && "opacity-30",
              isFocused && cn("ring-2", styles.ring),
            )}
            style={{
              left: `${region.box.x * 100}%`,
              top: `${region.box.y * 100}%`,
              width: `${region.box.width * 100}%`,
              height: `${region.box.height * 100}%`,
              animationDelay: animate ? `${index * STAGGER_MS}ms` : undefined,
            }}
          >
            <span
              className={cn(
                "absolute -top-[19px] -left-[1.5px] px-1.5 py-px font-mono text-3xs whitespace-nowrap text-white",
                styles.fill,
              )}
            >
              {index + 1} · {defect.name}
            </span>
          </div>
        );
      })}
    </>
  );
}
