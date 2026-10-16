import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { MONO_FONT_VARIABLE, SANS_FONT_VARIABLE } from "@/lib/font-variables";

/**
 * IBM Plex is the house face of industrial tooling — it was drawn for dense,
 * technical UI and its mono cut aligns figures cleanly in the readouts and
 * tables this console is mostly made of.
 *
 * Self-hosted by `next/font`, so the shop floor needs no connection to Google
 * and the layout never shifts as fonts swap in.
 *
 * The CSS variable names are written out as literals because `next/font` reads
 * its arguments at build time and rejects anything else. `VariablesInSync`
 * below fails the build if they ever drift from the shared constants that
 * `lib/annotate.ts` uses to read the family back at runtime.
 */
export const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/** Compile-time equality check; `A` must be assignable to `B`. */
type Exact<A extends B, B> = A;

export type VariablesInSync = [
  Exact<typeof SANS_FONT_VARIABLE, "--font-plex-sans">,
  Exact<typeof MONO_FONT_VARIABLE, "--font-plex-mono">,
];
