"use client";

import { resolveDefect } from "@/domain/inspection";
import type { AnnotatedRegion, DefectDefinition } from "@/domain/types";
import { Hint } from "@/components/ui/Field";
import { SeveritySwatch } from "@/components/ui/SeveritySwatch";

/** Shared row rhythm for the marked regions and the queue below it. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 border-b border-rule py-2.5 last:border-b-0">
      {children}
    </li>
  );
}

/** The boxes drawn on the current photo. Each one becomes a labelled training example. */
export function MarkedRegionList({
  regions,
  defects,
  onRemove,
}: {
  regions: readonly AnnotatedRegion[];
  defects: readonly DefectDefinition[];
  onRemove: (regionId: string) => void;
}) {
  if (regions.length === 0) {
    return (
      <Hint className="mt-0">
        Nothing marked yet. Each region you draw becomes one labelled training example.
      </Hint>
    );
  }

  return (
    <ul className="mb-4">
      {regions.map((region, index) => {
        const defect = resolveDefect(region.defectKey, defects);

        return (
          <ChipRow key={region.id}>
            <SeveritySwatch severity={defect.severity} />
            <span className="font-mono text-ink-faint numeric">{index + 1}</span>
            <span>{defect.name}</span>
            <button
              type="button"
              onClick={() => onRemove(region.id)}
              className="ml-auto px-1.5 py-0.5 text-ink-faint hover:text-critical"
            >
              Remove
              <span className="sr-only"> region {index + 1}</span>
            </button>
          </ChipRow>
        );
      })}
    </ul>
  );
}
