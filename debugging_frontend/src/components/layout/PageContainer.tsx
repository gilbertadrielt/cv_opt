/**
 * Scrolling body for the full-width pages.
 *
 * The Inspect workspace deliberately does not use this — it fills the viewport
 * and scrolls per column instead.
 */
export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-6 pt-8 pb-15">{children}</div>
    </div>
  );
}
