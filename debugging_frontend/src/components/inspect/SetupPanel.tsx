"use client";

import { findProductLine } from "@/domain/product-lines";
import { useInspection } from "@/state/InspectionProvider";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ProductLineSelect } from "@/components/ProductLineSelect";
import { ColumnHeader } from "./ColumnHeader";
import { PhotoDropZone } from "./PhotoDropZone";
import { PhotoThumbnails } from "./PhotoThumbnails";

/**
 * Left column: everything the inspector sets before running.
 *
 * The product line comes first because it selects both the model and the defect
 * vocabulary — the findings mean nothing without it.
 */
export function SetupPanel() {
  const {
    lineId,
    photos,
    status,
    error,
    activePhotoId,
    selectLine,
    addPhotos,
    removePhoto,
    selectPhoto,
    runInspection,
    resetRun,
  } = useInspection();

  const line = findProductLine(lineId);
  const isRunning = status === "running";

  return (
    <section
      aria-label="Setup"
      className="overflow-y-auto border-r border-rule bg-panel"
    >
      <ColumnHeader title="Setup" meta={`${photos.length} img`} />

      <div className="p-4.5">
        <ProductLineSelect
          value={lineId}
          onChange={selectLine}
          placeholder="Select a line…"
          hint={
            line ? (
              <span className="font-mono">
                {line.packaging} · model {line.model}
              </span>
            ) : undefined
          }
        />

        <Field label="Photos">
          <PhotoDropZone onFiles={addPhotos} />
          <PhotoThumbnails
            photos={photos}
            activePhotoId={activePhotoId}
            onSelect={selectPhoto}
            onRemove={removePhoto}
          />
        </Field>

        <Button
          variant="primary"
          fullWidth
          className="py-3 font-semibold"
          disabled={isRunning}
          onClick={runInspection}
        >
          {isRunning ? "Inspecting…" : "Run inspection"}
        </Button>

        {error ? (
          <p role="alert" className="mt-2 text-2xs leading-relaxed text-critical">
            {error}
          </p>
        ) : null}

        {status === "done" ? (
          <Button size="sm" fullWidth className="mt-2" onClick={resetRun}>
            Start a new run
          </Button>
        ) : null}
      </div>
    </section>
  );
}
