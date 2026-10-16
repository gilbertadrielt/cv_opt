"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Modal built on the native `<dialog>` element.
 *
 * `showModal()` gives focus containment, focus restoration on close, `inert`
 * on the rest of the page, and Escape-to-dismiss from the platform — all the
 * parts a hand-rolled overlay usually gets subtly wrong.
 */
export interface ModalProps {
  /** Accessible name for the dialog. */
  title: string;
  onClose: () => void;
  /** Rendered in the sticky header beside the title. */
  toolbar?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Modal({ title, onClose, toolbar, className, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    // The dialog scrolls internally; stop the page behind it from scrolling too.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      // Fires for Escape as well as programmatic close, so the parent's
      // open-state always follows the element's.
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        // The dialog box itself is a child; a click landing on the element
        // means the backdrop was hit.
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-4rem)] w-[calc(100vw-2.5rem)] max-w-[830px]",
        "overflow-y-auto border border-rule-strong bg-white p-0 text-ink",
        className,
      )}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-panel px-5 py-3">
        <strong className="mr-auto text-[13px] font-semibold">{title}</strong>
        {toolbar}
      </div>
      {children}
    </dialog>
  );
}
