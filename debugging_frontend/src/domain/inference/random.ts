/**
 * Deterministic pseudo-randomness.
 *
 * The mock detector is seeded from the photo name so the same photo always
 * produces the same findings. That keeps demos and manual QA reproducible —
 * re-running an inspection never silently changes the result underneath you.
 */

/** FNV-1a hash of a string, used to turn a photo name into a 32-bit seed. */
export function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Produces the next value in `[0, 1)`. */
export type RandomSource = () => number;

/** mulberry32 — small, fast, and good enough for placeholder detections. */
export function createRandomSource(seed: number): RandomSource {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uniform value in `[min, max)`. */
export function randomBetween(next: RandomSource, min: number, max: number): number {
  return min + next() * (max - min);
}

/** Removes and returns a random element, or `undefined` when `items` is empty. */
export function takeRandom<T>(next: RandomSource, items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  const [picked] = items.splice(Math.floor(next() * items.length), 1);
  return picked;
}
