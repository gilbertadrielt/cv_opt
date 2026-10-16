"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_PRODUCT_LINE_ID, type ProductLineId } from "@/domain/product-lines";
import type { AnnotatedRegion, BoundingBox, Photo } from "@/domain/types";
import { useFeedback } from "@/state/FeedbackProvider";
import { useKnowledgeBase } from "@/state/KnowledgeBaseProvider";
import { useToast } from "@/state/ToastProvider";
import { ProductLineSelect } from "@/components/ProductLineSelect";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/controls";
import { Hint } from "@/components/ui/Field";
import { AnnotationCanvas } from "./AnnotationCanvas";
import { MarkedRegionList } from "./MarkedRegionList";
import { RetrainingQueue } from "./RetrainingQueue";

/**
 * Correcting the model: load a photo it got wrong, mark what is actually there,
 * and queue it for retraining.
 *
 * The photo is owned locally until it is submitted. Its object URL is revoked
 * when it is replaced or the panel unmounts, but never after submission —
 * the queued example keeps it.
 */
export function FeedbackPanel() {
  const [lineId, setLineId] = useState<ProductLineId>(DEFAULT_PRODUCT_LINE_ID);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [regions, setRegions] = useState<AnnotatedRegion[]>([]);
  const [defectKey, setDefectKey] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const unsubmittedPhoto = useRef<Photo | null>(null);

  const { defectsFor } = useKnowledgeBase();
  const { submit } = useFeedback();
  const { showToast } = useToast();

  const defects = defectsFor(lineId);

  // Track the photo the panel still owns, and release it on unmount.
  useEffect(() => {
    unsubmittedPhoto.current = photo;
  }, [photo]);

  useEffect(
    () => () => {
      if (unsubmittedPhoto.current) URL.revokeObjectURL(unsubmittedPhoto.current.url);
    },
    [],
  );

  function loadPhoto(file: File) {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto({
      id: `feedback-photo-${(sequence.current += 1)}`,
      name: file.name,
      url: URL.createObjectURL(file),
    });
    setRegions([]);
  }

  function discardPhoto() {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setRegions([]);
  }

  function addRegion(box: BoundingBox) {
    setRegions((previous) => [
      ...previous,
      { id: `region-${(sequence.current += 1)}`, defectKey, box },
    ]);
  }

  function handleSubmit() {
    if (!photo || regions.length === 0) {
      showToast("Add a photo and mark at least one region.");
      return;
    }

    submit({ lineId, photo, regions });
    // Ownership passes to the queue — clear without revoking.
    setPhoto(null);
    setRegions([]);
    setDefectKey("");
    showToast("Sent to the retraining queue");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="mb-3.5 flex flex-wrap items-end gap-3.5">
          <ProductLineSelect
            value={lineId}
            onChange={(next) => {
              if (!next) return;
              setLineId(next);
              // Defect keys are per line, so existing marks no longer apply.
              setRegions([]);
              setDefectKey("");
            }}
            fieldClassName="mb-0 min-w-52"
          />
          <Select
            label="Defect to mark"
            fieldClassName="mb-0 min-w-48"
            value={defectKey}
            onChange={(event) => setDefectKey(event.target.value)}
          >
            <option value="">Select…</option>
            {defects.map((defect) => (
              <option key={defect.key} value={defect.key}>
                {defect.name}
              </option>
            ))}
          </Select>
        </div>

        <AnnotationCanvas
          photo={photo}
          regions={regions}
          defects={defects}
          canDraw={defectKey !== ""}
          onDraw={addRegion}
          onLoadPhoto={() => fileInputRef.current?.click()}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) loadPhoto(file);
            event.target.value = "";
          }}
        />

        {photo ? (
          <Hint>
            <span className="font-mono">{photo.name}</span> —{" "}
            {defectKey
              ? "drag across the region to mark it."
              : "pick a defect type above, then drag across the region."}{" "}
            <button
              type="button"
              onClick={discardPhoto}
              className="underline underline-offset-2 hover:text-critical"
            >
              Replace photo
            </button>
          </Hint>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2.5 text-[13px] font-semibold">Marked regions</h3>
        <MarkedRegionList
          regions={regions}
          defects={defects}
          onRemove={(regionId) =>
            setRegions((previous) => previous.filter((region) => region.id !== regionId))
          }
        />

        <Button onClick={handleSubmit} disabled={!photo || regions.length === 0}>
          Send to retraining queue
        </Button>

        <RetrainingQueue lineId={lineId} />
      </div>
    </div>
  );
}
