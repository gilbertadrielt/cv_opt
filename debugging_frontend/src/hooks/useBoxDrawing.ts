"use client";

import { useCallback, useRef, useState } from "react";
import type { BoundingBox } from "@/domain/types";

/** Boxes smaller than this in either axis are treated as a stray click, not an annotation. */
const MIN_SIZE = 0.02;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Drag-to-draw a normalised bounding box over an element.
 *
 * Uses Pointer Events with pointer capture, so a drag that leaves the image —
 * which is exactly what happens when marking a defect at the edge of a part —
 * still tracks correctly and still completes. Coordinates are clamped to the
 * frame, so the resulting box is always within the photo.
 */
export function useBoxDrawing({
  enabled,
  onComplete,
}: {
  enabled: boolean;
  onComplete: (box: BoundingBox) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<BoundingBox | null>(null);
  // Mirrors `box` so the pointer-up handler can read the final geometry without
  // running a side effect inside a state updater.
  const boxRef = useRef<BoundingBox | null>(null);

  const updateBox = useCallback((next: BoundingBox | null) => {
    boxRef.current = next;
    setBox(next);
  }, []);

  const pointIn = useCallback((event: React.PointerEvent) => {
    const frame = frameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled || event.button !== 0) return;
      const point = pointIn(event);
      if (!point) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      originRef.current = point;
      updateBox({ x: point.x, y: point.y, width: 0, height: 0 });
    },
    [enabled, pointIn, updateBox],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const origin = originRef.current;
      if (!origin) return;
      const point = pointIn(event);
      if (!point) return;

      updateBox({
        x: Math.min(origin.x, point.x),
        y: Math.min(origin.y, point.y),
        width: Math.abs(point.x - origin.x),
        height: Math.abs(point.y - origin.y),
      });
    },
    [pointIn, updateBox],
  );

  const finish = useCallback(() => {
    if (!originRef.current) return;
    originRef.current = null;

    const drawn = boxRef.current;
    updateBox(null);

    if (drawn && drawn.width >= MIN_SIZE && drawn.height >= MIN_SIZE) onComplete(drawn);
  }, [onComplete, updateBox]);

  return {
    /** Attach to the element the box is drawn over. */
    frameRef,
    /** The box being dragged right now, or `null`. */
    box,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
