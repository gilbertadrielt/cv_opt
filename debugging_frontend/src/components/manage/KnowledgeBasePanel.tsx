"use client";

import { useState } from "react";
import {
  DEFAULT_PRODUCT_LINE_ID,
  requireProductLine,
  type ProductLineId,
} from "@/domain/product-lines";
import type { DefectDefinition } from "@/domain/types";
import { useKnowledgeBase } from "@/state/KnowledgeBaseProvider";
import { useToast } from "@/state/ToastProvider";
import { ProductLineSelect } from "@/components/ProductLineSelect";
import { Button } from "@/components/ui/Button";
import { DefectEditorForm } from "./DefectEditorForm";
import { DefectListItem } from "./DefectListItem";
import { draftFromDefect, draftToDefect, EMPTY_DRAFT, type DefectDraft } from "./defect-draft";

/**
 * Editor for a product line's defect vocabulary.
 *
 * One editor is open at a time, and it opens in place of the row being edited,
 * so the inspector always sees the entry in the context of its neighbours.
 */
type EditorState = { mode: "closed" } | { mode: "add" } | { mode: "edit"; key: string };

export function KnowledgeBasePanel() {
  const [lineId, setLineId] = useState<ProductLineId>(DEFAULT_PRODUCT_LINE_ID);
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [draft, setDraft] = useState<DefectDraft>(EMPTY_DRAFT);

  const { defectsFor, saveDefect } = useKnowledgeBase();
  const { showToast } = useToast();

  const defects = defectsFor(lineId);
  const line = requireProductLine(lineId);

  function closeEditor() {
    setEditor({ mode: "closed" });
    setDraft(EMPTY_DRAFT);
  }

  function startAdd() {
    setEditor({ mode: "add" });
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(defect: DefectDefinition) {
    setEditor({ mode: "edit", key: defect.key });
    setDraft(draftFromDefect(defect));
  }

  function commit() {
    const result = draftToDefect(draft);
    if (!result.ok) {
      showToast(result.error);
      return;
    }

    const isEdit = editor.mode === "edit";
    saveDefect(lineId, result.defect, isEdit ? editor.key : undefined);
    showToast(isEdit ? "Defect updated" : "Defect added");
    closeEditor();
  }

  const editorForm = (
    <DefectEditorForm
      draft={draft}
      onChange={setDraft}
      onSubmit={commit}
      onCancel={closeEditor}
      submitLabel={editor.mode === "edit" ? "Save changes" : "Add defect"}
    />
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3.5">
        <ProductLineSelect
          value={lineId}
          onChange={(next) => {
            // A half-finished entry belongs to the line it was started on.
            if (next) setLineId(next);
            closeEditor();
          }}
          fieldClassName="mb-0 min-w-[250px]"
        />
        <Button onClick={startAdd}>Add a defect</Button>
        <p className="ml-auto font-mono text-2xs text-ink-faint numeric">
          {defects.length} mappings · model {line.model}
        </p>
      </div>

      <ul className="border-b border-rule">
        {editor.mode === "add" ? (
          <li className="border-x border-t border-rule">{editorForm}</li>
        ) : null}

        {defects.map((defect) =>
          editor.mode === "edit" && editor.key === defect.key ? (
            <li key={defect.key} className="border-x border-t border-rule">
              {editorForm}
            </li>
          ) : (
            <DefectListItem
              key={defect.key}
              defect={defect}
              onEdit={() => startEdit(defect)}
            />
          ),
        )}
      </ul>
    </>
  );
}
