"use client";

import { cn } from "@/lib/cn";

export interface SubTab<T extends string> {
  id: T;
  label: string;
  /** Shown as a small count after the label; omitted when zero or undefined. */
  count?: number;
}

/**
 * In-page tab strip.
 *
 * Implements the ARIA tabs pattern including arrow-key navigation — the panel
 * these switch between is a full editing surface, so keyboard users should not
 * have to tab through every tab to reach it.
 */
export function SubTabs<T extends string>({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: readonly SubTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** Accessible name for the tab list, e.g. "Manage sections". */
  label: string;
}) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === active);
    // Wrap around, as the tabs pattern expects.
    onSelect(tabs[(index + delta + tabs.length) % tabs.length].id);
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="mb-6 flex border-b border-rule"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "relative mr-7 py-2.5 transition-colors",
              selected
                ? "font-medium text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count ? (
              <span className="ml-2 font-mono text-xs text-ink-faint numeric">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Panel body matching a `SubTabs` entry. */
export function SubTabPanel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={-1}>
      {children}
    </div>
  );
}
