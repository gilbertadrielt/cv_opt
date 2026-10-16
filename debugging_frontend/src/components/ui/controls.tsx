"use client";

import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Field } from "./Field";

/**
 * Labelled form controls.
 *
 * Each control generates its own id and renders its own `<Field>`, so a call
 * site cannot accidentally ship an input without a label — the accessible name
 * comes for free rather than being remembered.
 */

const CONTROL =
  "w-full rounded-sm border border-rule-strong bg-white px-2.5 py-2 text-ink disabled:bg-panel-sunken disabled:text-ink-faint";

interface LabelledProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** Applied to the wrapping field, not the control. */
  fieldClassName?: string;
}

export type SelectProps = LabelledProps & SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ label, hint, fieldClassName, className, id, ...props }: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={controlId} hint={hint} className={fieldClassName}>
      <select id={controlId} className={cn(CONTROL, className)} {...props} />
    </Field>
  );
}

export type TextInputProps = LabelledProps & InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ label, hint, fieldClassName, className, id, ...props }: TextInputProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={controlId} hint={hint} className={fieldClassName}>
      <input id={controlId} className={cn(CONTROL, className)} {...props} />
    </Field>
  );
}

export type TextAreaProps = LabelledProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ label, hint, fieldClassName, className, id, ...props }: TextAreaProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={controlId} hint={hint} className={fieldClassName}>
      <textarea
        id={controlId}
        className={cn(CONTROL, "min-h-16 resize-y leading-relaxed", className)}
        {...props}
      />
    </Field>
  );
}
