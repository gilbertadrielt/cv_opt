/**
 * Core domain vocabulary for FA-Bench.
 *
 * Everything in `src/domain` is framework-free: no React, no DOM, no Next.js.
 * That keeps the inspection rules testable in isolation and makes it obvious
 * which parts of the app are business logic and which are presentation.
 */

// Type-only, so this is erased at compile time and creates no runtime cycle
// with `product-lines.ts`, which imports `ProductLine` from here.
import type { ProductLineId } from "./product-lines";

/** How badly a defect compromises the unit. Ordered worst-first by `SEVERITY_ORDER`. */
export type Severity = "critical" | "major" | "cosmetic";

/**
 * Physical form factor of a product line. The family — not the individual
 * line — determines which defects are physically possible on a unit.
 */
export type ProductFamily = "lga" | "board" | "oam";

export interface ProductLine {
  readonly id: string;
  /** Marketing name shown to the inspector. */
  readonly name: string;
  /** Socket / package description, e.g. "AM5 · LGA-1718". */
  readonly packaging: string;
  readonly family: ProductFamily;
  /** Identifier of the vision model trained for this line. */
  readonly model: string;
}

/** A defect the model can report, plus the operational context an inspector needs. */
export interface DefectDefinition {
  /** Stable slug used to link a detection back to its definition. */
  key: string;
  name: string;
  severity: Severity;
  /** What the defect physically looks like on the unit. */
  description: string;
  /** Failures this defect tends to produce once the unit is back in service. */
  impacts: string[];
}

/** Box coordinates are normalised to 0–1 so they survive any render size. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One region the model flagged on one photo. */
export interface Detection {
  id: string;
  /** References `DefectDefinition.key` within the knowledge base for the line. */
  defectKey: string;
  /** 0–1. */
  confidence: number;
  box: BoundingBox;
}

/** A photo taken at the station and loaded into the console. */
export interface Photo {
  id: string;
  name: string;
  /** Object URL owned by the session; see `PhotoLibrary` for lifecycle rules. */
  url: string;
}

/** Detections keyed by `Photo.id`. */
export type DetectionsByPhoto = Record<string, Detection[]>;

/** A completed inspection, retained so it can be reopened from History. */
export interface InspectionRun {
  id: string;
  /** Human-readable local timestamp, e.g. "2026-09-05 14:03". */
  completedAt: string;
  lineId: ProductLineId;
  /** Snapshot of the model id at run time — the line's model may change later. */
  model: string;
  photos: Photo[];
  detections: DetectionsByPhoto;
}

/** A region an inspector drew by hand to correct the model. */
export interface AnnotatedRegion {
  id: string;
  defectKey: string;
  box: BoundingBox;
}

/** One corrected example queued for retraining. */
export interface FeedbackSubmission {
  id: string;
  lineId: ProductLineId;
  photo: Photo;
  regions: AnnotatedRegion[];
  submittedAt: string;
}

/** Final call on what happens to the unit once inspection completes. */
export type Disposition =
  | "scrap"
  | "rework-review"
  | "pass";
