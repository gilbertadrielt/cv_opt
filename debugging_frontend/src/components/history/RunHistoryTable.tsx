"use client";

import { useRouter } from "next/navigation";
import { allDetections } from "@/domain/inspection";
import { findProductLine } from "@/domain/product-lines";
import type { InspectionRun } from "@/domain/types";
import { useInspection } from "@/state/InspectionProvider";
import { useKnowledgeBase } from "@/state/KnowledgeBaseProvider";
import { Button } from "@/components/ui/Button";
import { SeverityStrip } from "./SeverityStrip";

const HEADINGS = ["Run", "Time", "Product line", "Photos", "Findings", "Severity", "Model"];

export function RunHistoryTable({ runs }: { runs: readonly InspectionRun[] }) {
  const { openRun } = useInspection();
  const { defectsFor } = useKnowledgeBase();
  const router = useRouter();

  /** Reopening puts the archived run back on the bench, where it can be reviewed and re-reported. */
  function handleOpen(run: InspectionRun) {
    openRun(run);
    router.push("/inspect");
  }

  return (
    <div className="overflow-x-auto border border-rule">
      <table className="w-full border-collapse bg-panel text-left">
        <thead>
          <tr>
            {HEADINGS.map((heading) => (
              <th
                key={heading}
                scope="col"
                className="border-b border-rule px-3.5 py-2.5 text-2xs font-medium whitespace-nowrap text-ink-faint"
              >
                {heading}
              </th>
            ))}
            <th className="border-b border-rule">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const defects = defectsFor(run.lineId);
            const detections = allDetections(run.detections);

            return (
              <tr key={run.id} className="hover:bg-panel-sunken">
                <th
                  scope="row"
                  className="border-b border-rule px-3.5 py-3 text-left font-mono font-normal whitespace-nowrap numeric"
                >
                  {run.id}
                </th>
                <Cell className="font-mono whitespace-nowrap text-ink-muted numeric">
                  {run.completedAt}
                </Cell>
                <Cell>{findProductLine(run.lineId)?.name ?? run.lineId}</Cell>
                <Cell className="font-mono numeric">{run.photos.length}</Cell>
                <Cell className="font-mono numeric">{detections.length}</Cell>
                <Cell>
                  <SeverityStrip detections={detections} defects={defects} />
                </Cell>
                <Cell className="font-mono whitespace-nowrap text-ink-muted">{run.model}</Cell>
                <Cell>
                  <Button size="sm" onClick={() => handleOpen(run)}>
                    Open
                  </Button>
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <td className={`border-b border-rule px-3.5 py-3 align-middle ${className}`}>{children}</td>;
}
