"use client";

import { SEVERITY } from "@/domain/severity";
import { isSeverity } from "@/domain/severity";
import { Button } from "@/components/ui/Button";
import { Select, TextArea, TextInput } from "@/components/ui/controls";
import type { DefectDraft } from "./defect-draft";

/**
 * Add / edit form for a knowledge base entry.
 *
 * Controlled from the panel above it so a single draft survives switching
 * between "add" and "edit" without the form owning any state of its own.
 */
export function DefectEditorForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  draft: DefectDraft;
  onChange: (draft: DefectDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const update = <K extends keyof DefectDraft>(field: K, value: DefectDraft[K]) =>
    onChange({ ...draft, [field]: value });

  return (
    <form
      className="bg-white px-4.5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput
          label="Defect name"
          fieldClassName="mb-0"
          value={draft.name}
          onChange={(event) => update("name", event.target.value)}
          placeholder="e.g. Deformed contact pad"
        />
        <Select
          label="Severity"
          fieldClassName="mb-0"
          value={draft.severity}
          onChange={(event) => {
            if (isSeverity(event.target.value)) update("severity", event.target.value);
          }}
        >
          {Object.entries(SEVERITY).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </Select>
      </div>

      <TextArea
        label="What the inspector is looking at"
        fieldClassName="mt-4 mb-0"
        value={draft.description}
        onChange={(event) => update("description", event.target.value)}
        placeholder="Describe the visible signature of this defect."
      />

      <TextArea
        label="Operational errors it can cause — one per line"
        fieldClassName="mt-4 mb-0"
        className="min-h-22"
        value={draft.impactText}
        onChange={(event) => update("impactText", event.target.value)}
        placeholder={"Memory training failures at rated speed\nIntermittent boot after thermal cycling"}
      />

      <div className="mt-4 flex gap-2">
        <Button type="submit">{submitLabel}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
