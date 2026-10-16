import { STATION } from "@/domain/station";
import { NavTabs } from "./NavTabs";

/** Fixed header: identity of the tool on the left, identity of the bench on the right. */
export function TopRail() {
  return (
    <header className="sticky top-0 z-20 flex items-stretch border-b border-rule-strong bg-panel">
      <div className="flex items-center gap-2.5 border-r border-rule px-5">
        <span aria-hidden className="size-[9px] bg-critical" />
        <span>
          <span className="font-semibold tracking-tight">FA-Bench</span>{" "}
          <span className="text-xs text-ink-faint">Returns inspection</span>
        </span>
      </div>

      <NavTabs />

      <div className="ml-auto flex items-center gap-4 px-5 text-xs text-ink-faint">
        <span>{STATION.name}</span>
        <span className="font-mono">{STATION.operator}</span>
      </div>
    </header>
  );
}
