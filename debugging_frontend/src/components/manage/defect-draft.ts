import { toDefectKey } from "@/domain/knowledge-base";
import type { DefectDefinition, Severity } from "@/domain/types";

/**
 * The editable form of a defect.
 *
 * Impacts are edited as one textarea rather than a list of inputs — inspectors
 * write these in bulk, and a line-per-impact box matches how they think about
 * them. Conversion in both directions lives here so the form component stays
 * presentational and the rules stay testable.
 */
export interface DefectDraft {
  key: string;
  name: string;
  severity: Severity;
  description: string;
  /** One impact per line. */
  impactText: string;
}

export const EMPTY_DRAFT: DefectDraft = {
  key: "",
  name: "",
  severity: "major",
  description: "",
  impactText: "",
};

export function draftFromDefect(defect: DefectDefinition): DefectDraft {
  return {
    key: defect.key,
    name: defect.name,
    severity: defect.severity,
    description: defect.description,
    impactText: defect.impacts.join("\n"),
  };
}

export type DraftResult =
  | { ok: true; defect: DefectDefinition }
  | { ok: false; error: string };

/**
 * Validates and normalises a draft. The key is derived from the name when the
 * inspector did not supply one, which is the usual case for a new defect.
 */
export function draftToDefect(draft: DefectDraft): DraftResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: "Give the defect a name before saving." };

  const key = toDefectKey(draft.key || name);
  if (!key) return { ok: false, error: "The defect name needs at least one letter or number." };

  return {
    ok: true,
    defect: {
      key,
      name,
      severity: draft.severity,
      description: draft.description.trim(),
      impacts: draft.impactText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    },
  };
}
