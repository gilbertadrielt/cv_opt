import { resolveDefect } from "@/domain/inspection";
import { severityMeta } from "@/domain/severity";
import type { DefectDefinition, Detection, Photo } from "@/domain/types";
import { MONO_FONT_VARIABLE } from "./font-variables";

/**
 * Burns detection boxes into a copy of the photo and returns a JPEG data URL.
 *
 * The report has to travel as a single self-contained HTML file, so the
 * annotations cannot stay as DOM overlays — they are rasterised here.
 * Browser-only: callers must run this from a Client Component or effect.
 */

/** Downscale cap. Keeps report files manageable without losing defect detail. */
const MAX_PLATE_WIDTH = 1100;
const JPEG_QUALITY = 0.9;

/** Line and label sizes are derived from plate width so they scale with the image. */
const strokeWidthFor = (width: number) => Math.max(2, Math.round(width / 420));
const fontSizeFor = (width: number) => Math.max(11, Math.round(width / 68));
const labelHeightFor = (width: number) => Math.max(15, Math.round(width / 52));

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * Resolves the app's monospace family from the CSS variable `next/font` sets,
 * since the generated family name is not knowable at build time.
 */
function monoFamily(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(MONO_FONT_VARIABLE)
    .trim();
  return value ? `${value}, ui-monospace, monospace` : "ui-monospace, monospace";
}

function drawDetection(
  ctx: CanvasRenderingContext2D,
  detection: Detection,
  index: number,
  defects: readonly DefectDefinition[],
  canvasWidth: number,
  canvasHeight: number,
) {
  const defect = resolveDefect(detection.defectKey, defects);
  const color = severityMeta(defect.severity).hex;
  const stroke = strokeWidthFor(canvasWidth);

  const x = detection.box.x * canvasWidth;
  const y = detection.box.y * canvasHeight;
  const width = detection.box.width * canvasWidth;
  const height = detection.box.height * canvasHeight;

  ctx.strokeStyle = color;
  ctx.strokeRect(x, y, width, height);

  const label = `${index + 1} ${defect.name}`;
  const labelHeight = labelHeightFor(canvasWidth);
  // Sit the label above the box, or tuck it against the top edge if there's no room.
  const labelTop = Math.max(0, y - labelHeight - stroke);

  ctx.fillStyle = color;
  ctx.fillRect(x - stroke / 2, labelTop, ctx.measureText(label).width + 12, labelHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x + 6 - stroke / 2, labelTop + 3);
}

export async function renderAnnotatedPlate(
  photo: Photo,
  detections: readonly Detection[],
  defects: readonly DefectDefinition[],
): Promise<string | null> {
  if (typeof document === "undefined") return null;

  // Without this the first plate can rasterise in a fallback face.
  await document.fonts?.ready;

  const image = await loadImage(photo.url);
  if (!image) return null;

  const scale = Math.min(1, MAX_PLATE_WIDTH / image.naturalWidth);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0, width, height);
  ctx.lineWidth = strokeWidthFor(width);
  ctx.font = `500 ${fontSizeFor(width)}px ${monoFamily()}`;
  ctx.textBaseline = "top";

  detections.forEach((detection, index) => {
    drawDetection(ctx, detection, index, defects, width, height);
  });

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

/** Renders every plate of a run, preserving photo order. */
export function renderAnnotatedPlates(
  photos: readonly Photo[],
  detectionsByPhoto: Record<string, Detection[]>,
  defects: readonly DefectDefinition[],
): Promise<(string | null)[]> {
  return Promise.all(
    photos.map((photo) => renderAnnotatedPlate(photo, detectionsByPhoto[photo.id] ?? [], defects)),
  );
}
