import { createMockDetector } from "./mock-detector";
import type { Detector } from "./detector";

export type { Detection } from "../types";
export type { DetectionRequest, Detector } from "./detector";

/**
 * The detector the app runs against. Point this at a real implementation once
 * the inference service is available — nothing else in the app changes.
 */
export const detector: Detector = createMockDetector();
