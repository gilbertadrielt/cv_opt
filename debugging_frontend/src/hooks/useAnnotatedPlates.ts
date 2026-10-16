"use client";

import { useEffect, useState } from "react";
import type { DefectDefinition, DetectionsByPhoto, Photo } from "@/domain/types";
import { renderAnnotatedPlates } from "@/lib/annotate";

interface RenderedPlates {
  photos: readonly Photo[];
  detections: DetectionsByPhoto;
  defects: readonly DefectDefinition[];
  plates: (string | null)[];
}

/**
 * Rasterises each photo with its detection boxes burned in.
 *
 * Returns `null` while rendering — the report's download button stays disabled
 * until every plate is ready, because a report is only useful with its images.
 *
 * The result is stored together with the inputs it was produced from, so a
 * result belonging to a previous set of photos reads as "not ready" without the
 * hook having to reset state from inside the effect.
 */
export function useAnnotatedPlates(
  photos: readonly Photo[],
  detections: DetectionsByPhoto,
  defects: readonly DefectDefinition[],
): (string | null)[] | null {
  const [rendered, setRendered] = useState<RenderedPlates | null>(null);

  useEffect(() => {
    let cancelled = false;

    void renderAnnotatedPlates(photos, detections, defects).then((plates) => {
      if (!cancelled) setRendered({ photos, detections, defects, plates });
    });

    return () => {
      cancelled = true;
    };
  }, [photos, detections, defects]);

  const isCurrent =
    rendered !== null &&
    rendered.photos === photos &&
    rendered.detections === detections &&
    rendered.defects === defects;

  return isCurrent ? rendered.plates : null;
}
