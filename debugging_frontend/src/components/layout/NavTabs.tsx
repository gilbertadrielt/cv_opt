"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useInspection } from "@/state/InspectionProvider";

const TABS = [
  { href: "/inspect", label: "Inspect" },
  { href: "/history", label: "History" },
  { href: "/manage", label: "Manage" },
] as const;

/**
 * The three sections of the console.
 *
 * Real routes rather than local view state: an inspector can bookmark or
 * reload a section, and the browser's back button behaves as expected.
 */
export function NavTabs() {
  const pathname = usePathname();
  const { runs } = useInspection();

  const countFor = (href: string) => (href === "/history" ? runs.length : 0);

  return (
    <nav aria-label="Sections" className="flex">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const count = countFor(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative border-r border-rule px-[22px] py-3.5 transition-colors",
              active
                ? "bg-bench font-medium text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
            {count > 0 ? (
              <span className="ml-2 font-mono text-xs text-ink-faint numeric">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
