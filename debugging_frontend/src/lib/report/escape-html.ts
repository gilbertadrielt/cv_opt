const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes text for interpolation into the exported report.
 *
 * Photo names come from files the inspector picked, so they are untrusted:
 * a file named `<img onerror=…>.jpg` must not become markup when the report is
 * opened. Covers both quote styles so the helper is safe in attributes too.
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}
