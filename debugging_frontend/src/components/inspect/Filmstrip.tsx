"use client";

import { worstSeverity } from "@/domain/inspection";
import { SEVERITY } from "@/domain/severity";
import type { DefectDefinition, DetectionsByPhoto, Photo } from "@/domain/types";
import { cn } from "@/lib/cn";
import { severityClasses } from "@/lib/severity-styles";
import { PhotoImage } from "@/components/ui/PhotoImage";

/**
 * Angle switcher along the bottom of the stage.
 *
 * Each frame carries a dot in its worst severity, so the inspector can tell at
 * a glance which angle still needs looking at without cycling through them.
 */
export function Filmstrip({
  photos,
  activePhotoId,
  detections,
  defects,
  showSeverity,
  onSelect,
}: {
  photos: readonly Photo[];
  activePhotoId: string | null;
  detections: DetectionsByPhoto;
  defects: readonly DefectDefinition[];
  showSeverity: boolean;
  onSelect: (photoId: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-t border-stage-rule px-4.5 py-3">
      {photos.map((photo) => {
        const photoDetections = detections[photo.id] ?? [];
        const worst = showSeverity ? worstSeverity(photoDetections, defects) : null;
        const isActive = photo.id === activePhotoId;

        return (
          <button
            key={photo.id}
            type="button"
            onClick={() => onSelect(photo.id)}
            aria-pressed={isActive}
            title={worst ? `${photo.name} — ${SEVERITY[worst].label}` : photo.name}
            className={cn(
              "relative size-13 shrink-0 border bg-film",
              isActive ? "border-stage-ink-bright" : "border-film-rule hover:border-stage-ink",
            )}
          >
            <PhotoImage src={photo.url} alt="" className="size-full object-cover" />
            <span className="sr-only">{photo.name}</span>
            {worst ? (
              <span
                aria-hidden
                className={cn(
                  "absolute right-0.5 bottom-0.5 size-1.5 rounded-full",
                  severityClasses(worst).fill,
                )}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
