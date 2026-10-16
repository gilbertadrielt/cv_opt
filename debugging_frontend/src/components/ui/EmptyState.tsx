import { cn } from "@/lib/cn";

/**
 * The "nothing here yet" panel.
 *
 * `tone` picks the surface it sits on: `stage` for the dark photo area,
 * `bench` for the light pages. Same structure either way so the two never
 * drift apart visually.
 */
export interface EmptyStateProps {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "bench" | "stage";
  className?: string;
}

const TONES = {
  bench: {
    container: "border border-dashed border-rule-strong bg-panel px-5 py-11 text-center",
    title: "text-ink",
    body: "text-ink-muted",
  },
  stage: {
    container: "max-w-[290px] text-center",
    title: "text-stage-heading",
    body: "text-stage-ink-dim",
  },
} as const;

export function EmptyState({
  title,
  children,
  action,
  tone = "bench",
  className,
}: EmptyStateProps) {
  const styles = TONES[tone];

  return (
    <div className={cn(styles.container, className)}>
      <h3 className={cn("mb-1.5 font-medium", styles.title)}>{title}</h3>
      {children ? <p className={cn("leading-relaxed", styles.body)}>{children}</p> : null}
      {action ? <div className="mt-3.5">{action}</div> : null}
    </div>
  );
}
