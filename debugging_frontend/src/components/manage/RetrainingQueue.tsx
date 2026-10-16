"use client";

import { findProductLine, requireProductLine, type ProductLineId } from "@/domain/product-lines";
import { useFeedback } from "@/state/FeedbackProvider";
import { Hint } from "@/components/ui/Field";
import { ChipRow } from "./MarkedRegionList";

/** How many recent submissions to list; the rest are summarised by the count above. */
const VISIBLE_SUBMISSIONS = 6;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Examples waiting to be folded into the next training run.
 *
 * The count is scoped to the selected line — that is the model the inspector is
 * trying to improve — while the list below shows the most recent submissions
 * across all lines, so a mistake on the wrong line is easy to spot.
 */
export function RetrainingQueue({ lineId }: { lineId: ProductLineId }) {
  const { submissions, countFor } = useFeedback();
  const line = requireProductLine(lineId);
  const pending = countFor(lineId);

  return (
    <section className="mt-7">
      <h3 className="mb-1 text-[13px] font-semibold">Retraining queue</h3>
      <Hint className="mt-0">
        {plural(pending, "example")} waiting for {line.name} · model {line.model}
      </Hint>

      {submissions.length > 0 ? (
        <ul className="mt-2.5">
          {submissions.slice(0, VISIBLE_SUBMISSIONS).map((submission) => (
            <ChipRow key={submission.id}>
              <span className="font-mono text-ink-faint numeric">{submission.id}</span>
              <span>{findProductLine(submission.lineId)?.name ?? submission.lineId}</span>
              <span className="ml-auto font-mono text-2xs text-ink-faint numeric">
                {plural(submission.regions.length, "region")} · {submission.submittedAt}
              </span>
            </ChipRow>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
