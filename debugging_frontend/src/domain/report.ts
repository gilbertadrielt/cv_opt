import { allDetections, countBySeverity, dispositionFor, resolveDefect, type DispositionResult } from "./inspection";
import type { DefectDefinition, DetectionsByPhoto, Photo, ProductLine } from "./types";

/**
 * A denormalised, render-ready view of a completed inspection.
 *
 * Both the on-screen report and the exported HTML file are built from this one
 * model, so a change to the disposition rule or the finding order shows up in
 * both without the two implementations drifting apart.
 */

export interface ReportFinding {
  detectionId: string;
  /** 1-based position within its plate — matches the numbered box on the image. */
  position: number;
  defect: DefectDefinition;
  confidence: number;
}

export interface ReportPlate {
  photo: Photo;
  findings: ReportFinding[];
}

export interface ReportTotals {
  photos: number;
  regions: number;
  critical: number;
}

export interface ReportModel {
  runId: string;
  completedAt: string;
  line: ProductLine;
  plates: ReportPlate[];
  totals: ReportTotals;
  disposition: DispositionResult;
}

export interface ReportInput {
  runId: string;
  completedAt: string;
  line: ProductLine;
  photos: readonly Photo[];
  detections: DetectionsByPhoto;
  defects: readonly DefectDefinition[];
}

export function buildReportModel({
  runId,
  completedAt,
  line,
  photos,
  detections,
  defects,
}: ReportInput): ReportModel {
  const plates: ReportPlate[] = photos.map((photo) => ({
    photo,
    findings: (detections[photo.id] ?? []).map((detection, index) => ({
      detectionId: detection.id,
      position: index + 1,
      defect: resolveDefect(detection.defectKey, defects),
      confidence: detection.confidence,
    })),
  }));

  const flat = allDetections(detections);
  const critical = countBySeverity(flat, defects, "critical");

  return {
    runId,
    completedAt,
    line,
    plates,
    totals: { photos: photos.length, regions: flat.length, critical },
    disposition: dispositionFor(critical, flat.length),
  };
}
