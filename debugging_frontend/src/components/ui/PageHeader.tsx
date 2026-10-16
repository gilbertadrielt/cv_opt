/** Title block for the full-width pages (History, Manage). */
export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="mb-1 text-[19px] font-semibold tracking-tight">{title}</h1>
      {children ? <p className="max-w-[68ch] text-[13px] text-ink-muted">{children}</p> : null}
    </header>
  );
}
