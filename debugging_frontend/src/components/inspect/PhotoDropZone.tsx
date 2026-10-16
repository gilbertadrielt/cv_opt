"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Drop target for station photos.
 *
 * Built on a real `<button>` rather than a `div[role=button]`, so click,
 * Enter/Space, and focus behaviour come from the platform; the drag handlers
 * are additive for mouse users.
 */
export function PhotoDropZone({ onFiles }: { onFiles: (files: FileList | File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setDraggingOver] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDraggingOver(true);
        }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingOver(false);
          onFiles(event.dataTransfer.files);
        }}
        className={cn(
          "w-full rounded-sm border border-dashed px-3.5 py-5.5 text-center transition-colors",
          isDraggingOver
            ? "border-ink bg-panel-sunken"
            : "border-rule-strong bg-white text-ink-muted hover:border-ink-faint",
        )}
      >
        <span className="block">Drop photos here</span>
        <span className="mt-1 block text-xs text-ink-faint">or browse the station folder</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          onFiles(event.target.files ?? []);
          // Reset so picking the same file twice still fires a change event.
          event.target.value = "";
        }}
      />
    </>
  );
}
