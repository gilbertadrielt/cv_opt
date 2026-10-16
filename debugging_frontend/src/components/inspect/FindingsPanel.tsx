"use client";

import { useMemo } from "react";
import { allDetections, countBySeverity, resolveDefect } from "@/domain/inspection";
import { useInspection } from "@/state/InspectionProvider";
import { useKnowledgeBase } from "@/state/KnowledgeBaseProvider";
import { Button } from "@/components/ui/Button";
import { Hint } from "@/components/ui/Field";
import { ColumnHeader } from "./ColumnHeader";
import { FindingItem } from "./FindingItem";
import { FindingsSummary } from "./FindingsSummary";

/**
 * Right column: what the model found on the photo currently on the stage, and
 * what each finding means for the unit once it is back in service.
 *
 * The summary counts the whole run while the list covers one photo — a unit is
 * dispositioned on all its angles, but only one is being looked at.
 */
export function FindingsPanel({ onBuildReport }: { onBuildReport: () => void }) {
  const { photos, detections, status, activePhotoId, focusedDetectionId, lineId, focusDetection } =
    useInspection();
  const { defectsFor } = useKnowledgeBase();

  const defects = defectsFor(lineId);
  const isDone = status === "done";

  const { flagged, critical } = useMemo(() => {
    const flat = allDetections(detections);
    return { flagged: flat.length, critical: countBySeverity(flat, defects, "critical") };
  }, [detections, defects]);

  const activeDetections = activePhotoId ? (detections[activePhotoId] ?? []) : [];

  return (
    <section
      aria-label="Findings"
      className="flex min-h-0 flex-col overflow-y-auto border-l border-rule bg-panel"
    >
      <ColumnHeader title="Findings" meta={isDone ? `${flagged} total` : "—"} />

      {isDone ? (
        <FindingsSummary flagged={flagged} critical={critical} photos={photos.length} />
      ) : null}

      {!isDone ? (
        <div className="p-4.5">
          <Hint className="mt-0">
            Findings list every region the model flags on this unit, what the defect is, and the
            failures it tends to produce in service.
          </Hint>
        </div>
      ) : activeDetections.length === 0 ? (
        <div className="p-4.5">
          <Hint className="mt-0">
            No defects found on this photo. Check the other angles before passing the unit.
          </Hint>
        </div>
      ) : (
        <ul className="flex-1">
          {activeDetections.map((detection, index) => (
            <FindingItem
              key={detection.id}
              detection={detection}
              defect={resolveDefect(detection.defectKey, defects)}
              position={index + 1}
              isFocused={focusedDetectionId === detection.id}
              onToggleFocus={() =>
                focusDetection(focusedDetectionId === detection.id ? null : detection.id)
              }
            />
          ))}
        </ul>
      )}

      {isDone ? (
        <div className="mt-auto border-t border-rule p-4.5">
          <Button fullWidth onClick={onBuildReport}>
            Build report
          </Button>
        </div>
      ) : null}
    </section>
  );
}
