import type { ProductLineId } from "../product-lines";
import type { DefectDefinition, DetectionsByPhoto, Photo } from "../types";

/** One photo submitted for inference, with the defect vocabulary for its line. */
export interface DetectionRequest {
  photo: Photo;
  lineId: ProductLineId;
  /** The line's knowledge base — the model may only report these defects. */
  defects: readonly DefectDefinition[];
}

/**
 * The seam between the console and whatever actually runs inference.
 *
 * The UI depends on this interface only, so swapping the bundled mock for a
 * real HTTP or WebSocket backed model is a one-file change in
 * `src/domain/inference/index.ts` — no component has to be touched.
 */
export interface Detector {
  /** Runs inference over every photo of one unit. */
  inspect(requests: readonly DetectionRequest[]): Promise<DetectionsByPhoto>;
}
