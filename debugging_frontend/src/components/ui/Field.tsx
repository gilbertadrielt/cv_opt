import { cn } from "@/lib/cn";

export interface FieldProps {
  label: React.ReactNode;
  /**
   * Id of the control this labels. Omit for groups that have no single focusable
   * control (a drop zone, a set of thumbnails) — the label renders as plain text
   * rather than a `<label>` that would point at nothing.
   */
  htmlFor?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Shared label / control / hint stack, so every form row lines up identically. */
export function Field({ label, htmlFor, hint, className, children }: FieldProps) {
  const labelClass = "mb-1.5 block text-xs text-ink-muted";

  return (
    <div className={cn("mb-5", className)}>
      {htmlFor ? (
        <label className={labelClass} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      {children}
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

/** Small print under a control: model ids, counts, instructions. */
export function Hint({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("mt-2 text-2xs leading-relaxed text-ink-faint", className)}>{children}</p>;
}
