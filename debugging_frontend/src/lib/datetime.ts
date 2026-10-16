const pad2 = (value: number) => String(value).padStart(2, "0");

/** Local wall-clock stamp for the bench log, e.g. "2026-09-05 14:03". */
export function formatStamp(date: Date = new Date()): string {
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Run identifier in the form `RUN-20260905-01`. `sequence` is the run's
 * position within the station's session, matching how the bench log is read.
 */
export function formatRunId(sequence: number, date: Date = new Date()): string {
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  return `RUN-${day}-${pad2(sequence)}`;
}

/** Feedback identifier in the form `FB-001`. */
export function formatFeedbackId(sequence: number): string {
  return `FB-${String(sequence).padStart(3, "0")}`;
}
