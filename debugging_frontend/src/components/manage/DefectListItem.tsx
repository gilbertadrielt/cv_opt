import { SEVERITY } from "@/domain/severity";
import type { DefectDefinition } from "@/domain/types";
import { DefectDetails } from "@/components/DefectDetails";
import { Button } from "@/components/ui/Button";
import { SeveritySwatch } from "@/components/ui/SeveritySwatch";

/** One knowledge base entry, as the inspector reads it before deciding to edit. */
export function DefectListItem({
  defect,
  onEdit,
}: {
  defect: DefectDefinition;
  onEdit: () => void;
}) {
  return (
    <li className="border-x border-t border-rule bg-panel px-4.5 py-4">
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <SeveritySwatch severity={defect.severity} />
        <span className="font-medium">{defect.name}</span>
        <span className="font-mono text-2xs text-ink-faint">
          {defect.key} · {SEVERITY[defect.severity].label}
        </span>
        <Button size="sm" className="ml-auto" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <DefectDetails defect={defect} className="max-w-[72ch] pl-[18px]" />
    </li>
  );
}
