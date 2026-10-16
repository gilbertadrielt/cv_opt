import { severityClasses } from "@/lib/severity-styles";
import { cn } from "@/lib/cn";
import type { Severity } from "@/domain/types";

/**
 * The severity chip that prefixes every finding.
 *
 * Purely decorative — severity is always spelled out in adjacent text, so the
 * colour is never the only carrier of the information.
 */
export function SeveritySwatch({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0", severityClasses(severity).fill, className)}
    />
  );
}
