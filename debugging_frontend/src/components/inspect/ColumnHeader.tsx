/** Header bar shared by the Setup and Findings columns. */
export function ColumnHeader({ title, meta }: { title: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-rule px-4.5 pt-3.5 pb-3">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {meta ? <span className="font-mono text-xs text-ink-faint numeric">{meta}</span> : null}
    </div>
  );
}
