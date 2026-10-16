"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  createInitialKnowledgeBase,
  upsertDefect,
  type KnowledgeBase,
} from "@/domain/knowledge-base";
import type { ProductLineId } from "@/domain/product-lines";
import type { DefectDefinition } from "@/domain/types";

/**
 * The per-line defect vocabulary, owned by the inspectors on the floor.
 *
 * Held in memory for now. This provider is the single place that would change
 * when the knowledge base moves behind an API — `saveDefect` becomes a mutation
 * and `knowledgeBase` becomes fetched state; no consumer has to be touched.
 */

interface KnowledgeBaseContextValue {
  knowledgeBase: KnowledgeBase;
  /** The line's defects, or an empty list when no line is selected. */
  defectsFor: (lineId: ProductLineId | null | undefined) => DefectDefinition[];
  /** Adds a defect, or replaces the one keyed `replacingKey` when editing. */
  saveDefect: (lineId: ProductLineId, defect: DefectDefinition, replacingKey?: string) => void;
}

const KnowledgeBaseContext = createContext<KnowledgeBaseContextValue | null>(null);

const NO_DEFECTS: DefectDefinition[] = [];

export function KnowledgeBaseProvider({ children }: { children: React.ReactNode }) {
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>(createInitialKnowledgeBase);

  const defectsFor = useCallback(
    (lineId: ProductLineId | null | undefined) => (lineId ? knowledgeBase[lineId] : NO_DEFECTS),
    [knowledgeBase],
  );

  const saveDefect = useCallback(
    (lineId: ProductLineId, defect: DefectDefinition, replacingKey?: string) => {
      setKnowledgeBase((previous) => ({
        ...previous,
        [lineId]: upsertDefect(previous[lineId], defect, replacingKey),
      }));
    },
    [],
  );

  const value = useMemo(
    () => ({ knowledgeBase, defectsFor, saveDefect }),
    [knowledgeBase, defectsFor, saveDefect],
  );

  return <KnowledgeBaseContext.Provider value={value}>{children}</KnowledgeBaseContext.Provider>;
}

export function useKnowledgeBase(): KnowledgeBaseContextValue {
  const value = useContext(KnowledgeBaseContext);
  if (!value) throw new Error("useKnowledgeBase must be used within a KnowledgeBaseProvider");
  return value;
}
