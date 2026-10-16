import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "default" | "primary";
export type ButtonSize = "md" | "sm";

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm border font-medium transition-colors disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  default:
    "border-rule-strong bg-white text-ink hover:border-ink-faint disabled:border-rule-strong disabled:bg-panel-sunken disabled:text-ink-faint",
  primary:
    "border-ink bg-ink text-panel hover:border-black hover:bg-black disabled:border-rule-strong disabled:bg-panel-sunken disabled:text-ink-faint",
};

const SIZES: Record<ButtonSize, string> = {
  md: "px-3.5 py-2.5",
  sm: "px-2.5 py-1 text-xs",
};

/**
 * Exported separately so links that act as buttons (`ButtonLink`) share exactly
 * these styles instead of re-declaring them and drifting.
 */
export function buttonClasses({
  variant = "default",
  size = "md",
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleOptions {}

/**
 * `type` defaults to "button": these controls sit inside forms often enough
 * that an accidental submit is the more likely bug than a missing one.
 */
export function Button({
  variant,
  size,
  fullWidth,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, fullWidth, className })} {...props} />;
}
