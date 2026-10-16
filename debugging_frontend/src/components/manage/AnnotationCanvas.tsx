"use client";

import type { AnnotatedRegion, BoundingBox, DefectDefinition, Photo } from "@/domain/types";
import { useBoxDrawing } from "@/hooks/useBoxDrawing";
import { RegionBoxes } from "@/components/RegionBoxes";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PhotoImage } from "@/components/ui/PhotoImage";

/**
 * The marking surface: an incorrectly-classified photo the inspector drags
 * boxes onto.
 *
 * Drawing is disabled until a defect type is chosen, because a box without a
 * label is not a training example — the cursor reflects that.
 */
export function AnnotationCanvas({
  photo,
  regions,
  defects,
  canDraw,
  onDraw,
  onLoadPhoto,
}: {
  photo: Photo | null;
  regions: readonly AnnotatedRegion[];
  defects: readonly DefectDefinition[];
  canDraw: boolean;
  onDraw: (box: BoundingBox) => void;
  onLoadPhoto: () => void;
}) {
  const { frameRef, box, handlers } = useBoxDrawing({ enabled: canDraw, onComplete: onDraw });

  return (
    <div className="flex min-h-70 items-center justify-center bg-stage p-4">
      {!photo ? (
        <EmptyState
          tone="stage"
          title="No photo loaded"
          action={
            <Button size="sm" onClick={onLoadPhoto}>
              Add a photo
            </Button>
          }
        >
          Load a photo the model got wrong, then drag across the defect to mark it.
        </EmptyState>
      ) : (
        <div
          ref={frameRef}
          {...handlers}
          className={`relative inline-block touch-none leading-none ${canDraw ? "cursor-crosshair" : "cursor-not-allowed"}`}
        >
          <PhotoImage
            src={photo.url}
            alt={photo.name}
            draggable={false}
            className="max-h-[52vh] max-w-full"
          />

          <RegionBoxes regions={regions} defects={defects} />

          {box ? (
            <div
              aria-hidden
              className="pointer-events-none absolute border-[1.5px] border-dashed border-stage-ink-bright"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
