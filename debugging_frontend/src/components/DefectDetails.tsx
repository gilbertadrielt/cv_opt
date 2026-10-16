import type { DefectDefinition } from "@/domain/types";
import { cn } from "@/lib/cn";

/**
 * The explanatory half of a defect: what it looks like, and what it does to the
 * unit in service.
 *
 * Shared by the findings list, the knowledge base editor, and the report, so
 * the inspector reads exactly the same wording wherever a defect appears.
 */
export function DefectDetails({
  defect,
  className,
}: {
  defect: DefectDefinition;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-2 text-xs leading-relaxed text-ink-muted">{defect.description}</p>
      {defect.impacts.length > 0 ? (
        <>
          <p className="mb-1 text-2xs text-ink-faint">What it causes in service</p>
          <ImpactList impacts={defect.impacts} />
        </>
      ) : null}
    </div>
  );
}

/** Dashed list of operational consequences. */
export function ImpactList({ impacts, className }: { impacts: readonly string[]; className?: string }) {
  return (
    <ul className={cn("list-none", className)}>
      {impacts.map((impact) => (
        <li
          key={impact}
          className="relative mb-1 pl-3 text-xs leading-snug before:absolute before:top-2 before:left-0 before:h-px before:w-[5px] before:bg-ink-faint"
        >
          {impact}
        </li>
      ))}
    </ul>
  );
}
