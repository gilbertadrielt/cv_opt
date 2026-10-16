import { DEFECT_CATALOG } from "./defect-catalog";
import { PRODUCT_LINES, type ProductLineId } from "./product-lines";
import type { DefectDefinition, ProductFamily } from "./types";

/** Defects keyed by product line. Each line owns an editable copy of its list. */
export type KnowledgeBase = Record<ProductLineId, DefectDefinition[]>;

const C = DEFECT_CATALOG;

/**
 * Which defects are physically possible on each package family. A board-level
 * AIB has no substrate to crack; an LGA package has no PCIe edge connector.
 */
const FAMILY_DEFECTS: Record<ProductFamily, readonly DefectDefinition[]> = {
  lga: [
    C.padDeformation,
    C.substrateCrack,
    C.dieEdgeChip,
    C.heatSpreaderGouge,
    C.landSideCapacitor,
    C.thermalDiscoloration,
    C.surfaceContamination,
  ],
  board: [
    C.connectorDeformation,
    C.edgeConnectorWear,
    C.pcbDelamination,
    C.missingComponent,
    C.thermalDiscoloration,
    C.heatsinkDamage,
    C.surfaceContamination,
  ],
  oam: [
    C.padDeformation,
    C.substrateCrack,
    C.dieEdgeChip,
    C.coldPlateScoring,
    C.thermalDiscoloration,
    C.surfaceContamination,
  ],
};

function cloneDefect(defect: DefectDefinition): DefectDefinition {
  return { ...defect, impacts: [...defect.impacts] };
}

/**
 * Seeds every line with a deep copy of its family's defects, so editing one
 * line never mutates the shared catalogue or a sibling line.
 */
export function createInitialKnowledgeBase(): KnowledgeBase {
  return Object.fromEntries(
    PRODUCT_LINES.map((line) => [line.id, FAMILY_DEFECTS[line.family].map(cloneDefect)]),
  ) as KnowledgeBase;
}

export function findDefect(
  defects: readonly DefectDefinition[],
  key: string,
): DefectDefinition | undefined {
  return defects.find((defect) => defect.key === key);
}

/**
 * Derives a stable slug from a defect name, e.g. "Deformed contact pad" →
 * "deformed-contact-pad". Used when an inspector adds a defect without
 * supplying a key of their own.
 */
export function toDefectKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Inserts `defect` into a line's list, replacing the entry identified by
 * `replacingKey` when editing. Returns a new array — callers hold immutable
 * state and rely on reference changes to re-render.
 */
export function upsertDefect(
  defects: readonly DefectDefinition[],
  defect: DefectDefinition,
  replacingKey?: string,
): DefectDefinition[] {
  const index = replacingKey ? defects.findIndex((d) => d.key === replacingKey) : -1;
  if (index === -1) return [...defects, defect];

  const next = [...defects];
  next[index] = defect;
  return next;
}
