"use client";

import { SEVERITY } from "@/domain/severity";
import type { DefectDefinition, Detection } from "@/domain/types";
import { cn } from "@/lib/cn";
import { DefectDetails } from "@/components/DefectDetails";
import { SeveritySwatch } from "@/components/ui/SeveritySwatch";

/**
 * One flagged region.
 *
 * Selecting the row highlights the matching box on the stage and dims the
 * others, which is how an inspector ties a written finding to a place on the
 * part. Only the header line is the control — the explanatory body is flow
 * content and cannot legally live inside a `<button>`.
 */
export function FindingItem({
  detection,
  defect,
  position,
  isFocused,
  onToggleFocus,
}: {
  detection: Detection;
  defect: DefectDefinition;
  position: number;
  isFocused: boolean;
  onToggleFocus: () => void;
}) {
  const severity = SEVERITY[defect.severity];
  const { box } = detection;

  return (
    <li
      className={cn(
        "border-b border-l-2 border-b-rule transition-colors",
        isFocused ? "border-l-ink bg-panel-sunken" : "border-l-transparent hover:bg-panel-sunken",
      )}
    >
      <button
        type="button"
        onClick={onToggleFocus}
        aria-pressed={isFocused}
        className="w-full px-4.5 pt-3.5 text-left"
      >
        <span className="mb-1.5 flex items-center gap-2">
          <SeveritySwatch severity={defect.severity} />
          <span className="flex-1 font-medium">
            {position} · {defect.name}
          </span>
          <span className="font-mono text-2xs text-ink-faint numeric">
            {(detection.confidence * 100).toFixed(1)}%
          </span>
        </span>

        <span className="block pl-4 font-mono text-2xs text-ink-faint numeric">
          {severity.label} · x{box.x.toFixed(2)} y{box.y.toFixed(2)} w{box.width.toFixed(2)} h
          {box.height.toFixed(2)}
        </span>
      </button>

      <DefectDetails defect={defect} className="px-4.5 pb-3.5 pl-[34px]" />
    </li>
  );
}
