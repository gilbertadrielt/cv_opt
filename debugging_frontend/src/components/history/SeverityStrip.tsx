import { SEVERITY } from "@/domain/severity";
import { severityOf } from "@/domain/inspection";
import type { DefectDefinition, Detection } from "@/domain/types";
import { severityClasses } from "@/lib/severity-styles";

/**
 * One tick per finding, coloured by severity — a run's shape at a glance in a
 * table cell. The equivalent text is in the `title` and for screen readers,
 * since colour alone carries the pattern.
 */
export function SeverityStrip({
  detections,
  defects,
}: {
  detections: readonly Detection[];
  defects: readonly DefectDefinition[];
}) {
  if (detections.length === 0) {
    return <span className="font-mono text-xs text-ink-faint">clear</span>;
  }

  const severities = detections.map((detection) => severityOf(detection, defects));
  const summary = severities.map((severity) => SEVERITY[severity].label).join(", ");

  return (
    <span className="flex items-center gap-[3px]" title={summary}>
      {severities.map((severity, index) => (
        <span
          key={index}
          aria-hidden
          className={`block h-1 w-3 ${severityClasses(severity).fill}`}
        />
      ))}
      <span className="sr-only">{summary}</span>
    </span>
  );
}
