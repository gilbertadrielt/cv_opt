"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ProductLineId } from "@/domain/product-lines";
import type { AnnotatedRegion, FeedbackSubmission, Photo } from "@/domain/types";
import { formatFeedbackId, formatStamp } from "@/lib/datetime";

/**
 * The retraining queue: examples an inspector corrected by hand because the
 * model got them wrong.
 *
 * Submissions retain their photo, so the object URL behind a queued example is
 * deliberately never revoked while the session lives.
 */

export interface FeedbackDraft {
  lineId: ProductLineId;
  photo: Photo;
  regions: AnnotatedRegion[];
}

interface FeedbackContextValue {
  /** Newest first. */
  submissions: FeedbackSubmission[];
  submit: (draft: FeedbackDraft) => void;
  countFor: (lineId: ProductLineId) => number;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [submissions, setSubmissions] = useState<FeedbackSubmission[]>([]);

  const submit = useCallback(({ lineId, photo, regions }: FeedbackDraft) => {
    setSubmissions((previous) => [
      {
        id: formatFeedbackId(previous.length + 1),
        lineId,
        photo,
        regions,
        submittedAt: formatStamp(),
      },
      ...previous,
    ]);
  }, []);

  const countFor = useCallback(
    (lineId: ProductLineId) =>
      submissions.filter((submission) => submission.lineId === lineId).length,
    [submissions],
  );

  const value = useMemo(
    () => ({ submissions, submit, countFor }),
    [submissions, submit, countFor],
  );

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback(): FeedbackContextValue {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback must be used within a FeedbackProvider");
  return value;
}
