"use client";

import { useMemo } from "react";
import { findProductLine } from "@/domain/product-lines";
import { buildReportModel } from "@/domain/report";
import { useAnnotatedPlates } from "@/hooks/useAnnotatedPlates";
import { buildReportHtml } from "@/lib/report/build-report-html";
import { downloadFile } from "@/lib/download";
import { useInspection } from "@/state/InspectionProvider";
import { useKnowledgeBase } from "@/state/KnowledgeBaseProvider";
import { useToast } from "@/state/ToastProvider";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ReportDocument } from "./ReportDocument";

/**
 * Preview and export of the inspection report.
 *
 * The plates are rasterised before the download unlocks: the exported file has
 * to be self-contained, so a report without its annotated images would be worse
 * than no report at all.
 */
export function ReportDialog({ onClose }: { onClose: () => void }) {
  const { photos, detections, lineId, runMeta } = useInspection();
  const { defectsFor } = useKnowledgeBase();
  const { showToast } = useToast();

  const defects = defectsFor(lineId);
  const line = findProductLine(lineId);
  const plates = useAnnotatedPlates(photos, detections, defects);

  const model = useMemo(
    () =>
      line && runMeta
        ? buildReportModel({
            runId: runMeta.id,
            completedAt: runMeta.completedAt,
            line,
            photos,
            detections,
            defects,
          })
        : null,
    [line, runMeta, photos, detections, defects],
  );

  function handleDownload() {
    if (!model || !plates) return;
    try {
      downloadFile(
        `${model.runId}.html`,
        buildReportHtml(model, plates),
        "text/html;charset=utf-8",
      );
      showToast("Report downloaded");
    } catch {
      // Sandboxed or download-blocked contexts: the preview is still on screen.
      showToast("Download blocked here — the report is still on screen to print or copy.");
    }
  }

  return (
    <Modal
      title="Inspection report"
      onClose={onClose}
      toolbar={
        <>
          <Button size="sm" onClick={handleDownload} disabled={!model || !plates}>
            {plates ? "Download report" : "Preparing images…"}
          </Button>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {model ? (
        <ReportDocument model={model} plates={plates} />
      ) : (
        <p className="px-6 py-10 text-center text-ink-muted">
          Run an inspection before building a report.
        </p>
      )}
    </Modal>
  );
}
