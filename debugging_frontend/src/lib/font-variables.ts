/**
 * CSS custom property names for the app's fonts.
 *
 * `next/font` generates an opaque family name at build time, so anything that
 * needs the real family at runtime — `<canvas>` text in `annotate.ts` — has to
 * read it back from these variables rather than hard-coding "IBM Plex Mono".
 * Shared here so the loader and the readers cannot drift.
 */
export const SANS_FONT_VARIABLE = "--font-plex-sans";
export const MONO_FONT_VARIABLE = "--font-plex-mono";
