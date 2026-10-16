import type { Detection, DetectionsByPhoto } from "../types";
import type { DetectionRequest, Detector } from "./detector";
import {
  createRandomSource,
  randomBetween,
  seedFromString,
  takeRandom,
  type RandomSource,
} from "./random";

/** Roughly matches the wall time of a real model pass, so the UI's busy state is exercised. */
const SIMULATED_LATENCY_MS = 1150;

/** Region geometry, as a fraction of the photo. Boxes stay clear of the edges. */
const BOX = {
  minWidth: 0.11,
  maxWidth: 0.31,
  minHeight: 0.1,
  maxHeight: 0.28,
  marginX: 0.06,
  marginY: 0.07,
} as const;

/** The model never reports below this; a real detector would apply its own threshold. */
const MIN_CONFIDENCE = 0.71;
const MAX_CONFIDENCE = 0.99;

/**
 * Weighted region count. Most returned units carry one or two flagged regions;
 * a small share come back clean.
 */
function pickRegionCount(next: RandomSource): number {
  if (next() < 0.12) return 0;
  if (next() < 0.55) return 1;
  if (next() < 0.87) return 2;
  return 3;
}

function detectOne({ photo, lineId, defects }: DetectionRequest): Detection[] {
  // Seeding on name + line means the same photo re-run against the same line
  // reproduces its findings exactly, while a different line can differ.
  const next = createRandomSource(seedFromString(photo.name + lineId));
  const remaining = [...defects];
  const count = Math.min(pickRegionCount(next), remaining.length);
  const detections: Detection[] = [];

  for (let i = 0; i < count; i++) {
    const defect = takeRandom(next, remaining);
    if (!defect) break;

    const width = randomBetween(next, BOX.minWidth, BOX.maxWidth);
    const height = randomBetween(next, BOX.minHeight, BOX.maxHeight);

    detections.push({
      id: `${photo.id}-${i}`,
      defectKey: defect.key,
      confidence: randomBetween(next, MIN_CONFIDENCE, MAX_CONFIDENCE),
      box: {
        x: randomBetween(next, BOX.marginX, 1 - BOX.marginX - width),
        y: randomBetween(next, BOX.marginY, 1 - BOX.marginY - height),
        width,
        height,
      },
    });
  }

  return detections.sort((a, b) => b.confidence - a.confidence);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stand-in for the vision model. Produces plausible, deterministic findings so
 * the console can be built and demonstrated before the model is wired up.
 */
export function createMockDetector(latencyMs = SIMULATED_LATENCY_MS): Detector {
  return {
    async inspect(requests) {
      await delay(latencyMs);
      const results: DetectionsByPhoto = {};
      for (const request of requests) {
        results[request.photo.id] = detectOne(request);
      }
      return results;
    },
  };
}
