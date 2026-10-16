"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { detector } from "@/domain/inference";
import { requireProductLine, type ProductLineId } from "@/domain/product-lines";
import type { InspectionRun, Photo } from "@/domain/types";
import { formatRunId, formatStamp } from "@/lib/datetime";
import {
  initialInspectionState,
  inspectionReducer,
  type InspectionState,
} from "./inspection-reducer";
import { useKnowledgeBase } from "./KnowledgeBaseProvider";
import { useToast } from "./ToastProvider";

/**
 * Owns the inspection workflow: the photos on the bench, the run in progress,
 * and the log of completed runs behind the History page.
 *
 * State transitions live in `inspection-reducer.ts`. This provider handles the
 * two concerns a pure reducer cannot: awaiting the detector, and the lifetime
 * of the object URLs backing each photo.
 */

interface InspectionContextValue extends InspectionState {
  selectLine: (lineId: ProductLineId | null) => void;
  /** Accepts anything file-shaped from a drop or a file input; non-images are rejected. */
  addPhotos: (files: FileList | File[]) => void;
  removePhoto: (photoId: string) => void;
  selectPhoto: (photoId: string) => void;
  focusDetection: (detectionId: string | null) => void;
  runInspection: () => void;
  openRun: (run: InspectionRun) => void;
  resetRun: () => void;
}

const InspectionContext = createContext<InspectionContextValue | null>(null);

/** A photo is safe to revoke only once no archived run still points at it. */
function isRetainedByRun(runs: readonly InspectionRun[], photoId: string): boolean {
  return runs.some((run) => run.photos.some((photo) => photo.id === photoId));
}

export function InspectionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(inspectionReducer, initialInspectionState);
  const { knowledgeBase } = useKnowledgeBase();
  const { showToast } = useToast();

  const photoSequence = useRef(0);
  /**
   * Increments whenever the inputs change. An inference result whose token no
   * longer matches belongs to a superseded run and is dropped, so removing a
   * photo mid-run cannot land findings for a photo that is no longer on the bench.
   */
  const runToken = useRef(0);

  const releasePhoto = useCallback(
    (photo: Photo) => {
      if (!isRetainedByRun(state.runs, photo.id)) URL.revokeObjectURL(photo.url);
    },
    [state.runs],
  );

  const selectLine = useCallback((lineId: ProductLineId | null) => {
    runToken.current += 1;
    dispatch({ type: "line/select", lineId });
  }, []);

  const addPhotos = useCallback(
    (files: FileList | File[]) => {
      const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
      const rejected = Array.from(files).length - images.length;
      if (rejected > 0) {
        showToast(`Skipped ${rejected} file${rejected === 1 ? "" : "s"} — photos only.`);
      }
      if (images.length === 0) return;

      runToken.current += 1;
      dispatch({
        type: "photos/add",
        photos: images.map((file) => ({
          id: `photo-${(photoSequence.current += 1)}`,
          name: file.name,
          url: URL.createObjectURL(file),
        })),
      });
    },
    [showToast],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      const photo = state.photos.find((candidate) => candidate.id === photoId);
      if (!photo) return;
      runToken.current += 1;
      releasePhoto(photo);
      dispatch({ type: "photos/remove", photoId });
    },
    [state.photos, releasePhoto],
  );

  const selectPhoto = useCallback((photoId: string) => {
    dispatch({ type: "photos/select", photoId });
  }, []);

  const focusDetection = useCallback((detectionId: string | null) => {
    dispatch({ type: "detection/focus", detectionId });
  }, []);

  const resetRun = useCallback(() => {
    runToken.current += 1;
    state.photos.forEach(releasePhoto);
    dispatch({ type: "run/reset" });
  }, [state.photos, releasePhoto]);

  const openRun = useCallback((run: InspectionRun) => {
    runToken.current += 1;
    dispatch({ type: "run/open", run });
  }, []);

  const { lineId, photos, runs } = state;

  const runInspection = useCallback(() => {
    if (!lineId) {
      dispatch({ type: "run/fail", message: "Choose a product line before running." });
      return;
    }
    if (photos.length === 0) {
      dispatch({ type: "run/fail", message: "Add at least one photo before running." });
      return;
    }

    const token = (runToken.current += 1);
    const line = requireProductLine(lineId);
    const defects = knowledgeBase[lineId];
    const batch = photos.map((photo) => ({ photo, lineId, defects }));

    dispatch({ type: "run/start" });

    void detector
      .inspect(batch)
      .then((detections) => {
        if (token !== runToken.current) return;
        dispatch({
          type: "run/complete",
          run: {
            id: formatRunId(runs.length + 1),
            completedAt: formatStamp(),
            lineId,
            model: line.model,
            photos: [...photos],
            detections,
          },
        });
      })
      .catch(() => {
        if (token !== runToken.current) return;
        dispatch({
          type: "run/fail",
          message: "Inference did not complete. Check the station link and run again.",
        });
      });
  }, [lineId, photos, runs.length, knowledgeBase]);

  const value = useMemo<InspectionContextValue>(
    () => ({
      ...state,
      selectLine,
      addPhotos,
      removePhoto,
      selectPhoto,
      focusDetection,
      runInspection,
      openRun,
      resetRun,
    }),
    [
      state,
      selectLine,
      addPhotos,
      removePhoto,
      selectPhoto,
      focusDetection,
      runInspection,
      openRun,
      resetRun,
    ],
  );

  return <InspectionContext.Provider value={value}>{children}</InspectionContext.Provider>;
}

export function useInspection(): InspectionContextValue {
  const value = useContext(InspectionContext);
  if (!value) throw new Error("useInspection must be used within an InspectionProvider");
  return value;
}
