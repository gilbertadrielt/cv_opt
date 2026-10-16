import { cn } from "@/lib/cn";

/** Run totals across every photo, so the headline numbers don't depend on which angle is on screen. */
export function FindingsSummary({
  flagged,
  critical,
  photos,
}: {
  flagged: number;
  critical: number;
  photos: number;
}) {
  return (
    <dl className="flex gap-5 border-b border-rule px-4.5 py-3.5">
      <Stat value={flagged} label="regions flagged" />
      <Stat value={critical} label="critical" alarming={critical > 0} />
      <Stat value={photos} label="photos" />
    </dl>
  );
}

function Stat({
  value,
  label,
  alarming = false,
}: {
  value: number;
  label: string;
  alarming?: boolean;
}) {
  return (
    <div>
      <dd
        className={cn(
          "font-mono text-[22px] leading-tight font-semibold tracking-tight numeric",
          alarming && "text-critical",
        )}
      >
        {value}
      </dd>
      <dt className="text-2xs text-ink-faint">{label}</dt>
    </div>
  );
}
