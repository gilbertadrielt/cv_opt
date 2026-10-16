"use client";

import { useKnowledgeBase } from "@/state/KnowledgeBaseProvider";
import { useInspection } from "@/state/InspectionProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { PhotoImage } from "@/components/ui/PhotoImage";
import { RegionBoxes } from "@/components/RegionBoxes";
import { Filmstrip } from "./Filmstrip";

/**
 * Centre column: the photo under examination.
 *
 * Deliberately the darkest surface in the console — the same reason a light
 * table is dark around the edges. Everything else is chrome around this.
 */
export function InspectionStage() {
  const {
    photos,
    detections,
    status,
    activePhotoId,
    focusedDetectionId,
    lineId,
    runMeta,
    selectPhoto,
  } = useInspection();
  const { defectsFor } = useKnowledgeBase();

  const defects = defectsFor(lineId);
  const activePhoto = photos.find((photo) => photo.id === activePhotoId);
  const activeDetections = activePhotoId ? (detections[activePhotoId] ?? []) : [];
  const isDone = status === "done";

  const statusLabel =
    status === "running"
      ? "running inference…"
      : isDone
        ? `${activeDetections.length} region(s)`
        : "idle";

  return (
    // Keeps a usable stage when the columns stack; unconstrained at `lg`, where
    // the column height is set by the workspace grid.
    <section aria-label="Stage" className="flex min-h-[420px] flex-col bg-stage lg:min-h-0">
      <div className="flex items-center justify-between gap-4 border-b border-stage-rule px-4.5 py-3 text-xs text-stage-ink">
        <span>
          {activePhoto ? (
            <strong className="font-medium text-stage-ink-bright">{activePhoto.name}</strong>
          ) : (
            "No photo selected"
          )}
          {runMeta && isDone ? <span className="font-mono"> · {runMeta.id}</span> : null}
        </span>
        <span aria-live="polite" className="font-mono numeric">
          {statusLabel}
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto px-6 py-7">
        {!activePhoto ? (
          <EmptyState tone="stage" title="Nothing on the stage">
            Pick a product line and add the photos taken at the station. Detected regions appear
            here with their operational impact.
          </EmptyState>
        ) : (
          <div className="relative inline-block leading-none shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            <PhotoImage
              src={activePhoto.url}
              alt={activePhoto.name}
              className="max-h-[56vh] max-w-full"
            />
            {isDone ? (
              <RegionBoxes
                regions={activeDetections}
                defects={defects}
                focusedRegionId={focusedDetectionId}
                animate
              />
            ) : null}
          </div>
        )}
      </div>

      {photos.length > 1 ? (
        <Filmstrip
          photos={photos}
          activePhotoId={activePhotoId}
          detections={detections}
          defects={defects}
          showSeverity={isDone}
          onSelect={selectPhoto}
        />
      ) : null}
    </section>
  );
}
