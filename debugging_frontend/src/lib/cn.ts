type ClassValue = string | false | null | undefined;

/**
 * Joins class names, dropping falsy entries so conditionals read inline:
 * `cn("fab-base", isActive && "text-ink")`.
 *
 * Deliberately not a class *merger*: variants in this app are composed so they
 * never set the same Tailwind property twice, which keeps the output
 * predictable without pulling in `tailwind-merge`.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
