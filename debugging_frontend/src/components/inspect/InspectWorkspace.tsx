"use client";

import { useState } from "react";
import { ReportDialog } from "@/components/report/ReportDialog";
import { FindingsPanel } from "./FindingsPanel";
import { InspectionStage } from "./InspectionStage";
import { SetupPanel } from "./SetupPanel";

/**
 * The three-column bench: set up on the left, the part in the middle, what was
 * found on the right — left to right in the order the work happens.
 *
 * Fixed side columns and a fluid stage, because the photo is what benefits from
 * extra width. Below `lg` the columns stack so the console is still usable on a
 * tablet at the bay.
 */
export function InspectWorkspace() {
  const [isReportOpen, setReportOpen] = useState(false);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[264px_minmax(0,1fr)_330px] lg:overflow-hidden">
      <SetupPanel />
      <InspectionStage />
      <FindingsPanel onBuildReport={() => setReportOpen(true)} />

      {isReportOpen ? <ReportDialog onClose={() => setReportOpen(false)} /> : null}
    </div>
  );
}
