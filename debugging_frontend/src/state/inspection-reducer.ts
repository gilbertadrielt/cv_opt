import type { ProductLineId } from "@/domain/product-lines";
import type { DetectionsByPhoto, InspectionRun, Photo } from "@/domain/types";

/**
 * State machine for the Inspect workspace.
 *
 * Kept as a pure reducer, separate from the provider, so the transitions can be
 * reasoned about (and tested) without React. The provider owns the two things
 * a reducer must not: asynchronous inference and object-URL lifetimes.
 */

export type InspectionStatus = "idle" | "running" | "done";

/** Identity of the completed run currently on the stage. */
export interface RunMeta {
  id: string;
  completedAt: string;
}

export interface InspectionState {
  lineId: ProductLineId | null;
  photos: Photo[];
  detections: DetectionsByPhoto;
  status: InspectionStatus;
  activePhotoId: string | null;
  /** Detection the inspector has expanded; its box is highlighted, the rest dimmed. */
  focusedDetectionId: string | null;
  runMeta: RunMeta | null;
  error: string | null;
  /** Completed runs, newest first. Backs the History page. */
  runs: InspectionRun[];
}

export const initialInspectionState: InspectionState = {
  lineId: null,
  photos: [],
  detections: {},
  status: "idle",
  activePhotoId: null,
  focusedDetectionId: null,
  runMeta: null,
  error: null,
  runs: [],
};

export type InspectionAction =
  | { type: "line/select"; lineId: ProductLineId | null }
  | { type: "photos/add"; photos: Photo[] }
  | { type: "photos/remove"; photoId: string }
  | { type: "photos/select"; photoId: string }
  | { type: "detection/focus"; detectionId: string | null }
  | { type: "run/start" }
  | { type: "run/fail"; message: string }
  | { type: "run/complete"; run: InspectionRun }
  | { type: "run/open"; run: InspectionRun }
  | { type: "run/reset" };

/**
 * Findings only mean anything against the photos and product line they were
 * produced from, so any change to those inputs discards them rather than
 * leaving stale boxes on screen.
 */
function withResultsCleared(state: InspectionState): InspectionState {
  return {
    ...state,
    detections: {},
    status: "idle",
    runMeta: null,
    focusedDetectionId: null,
    error: null,
  };
}

/** After removing a photo, fall through to its neighbour instead of emptying the stage. */
function nextActivePhotoId(photos: Photo[], removedId: string): string | null {
  const index = photos.findIndex((photo) => photo.id === removedId);
  const remaining = photos.filter((photo) => photo.id !== removedId);
  if (remaining.length === 0) return null;
  return (remaining[index] ?? remaining[remaining.length - 1]).id;
}

export function inspectionReducer(
  state: InspectionState,
  action: InspectionAction,
): InspectionState {
  switch (action.type) {
    case "line/select": {
      if (action.lineId === state.lineId) return state;
      // A different line means a different model and a different defect
      // vocabulary — the previous findings no longer apply.
      return { ...withResultsCleared(state), lineId: action.lineId };
    }

    case "photos/add": {
      if (action.photos.length === 0) return state;
      const photos = [...state.photos, ...action.photos];
      return {
        ...withResultsCleared(state),
        photos,
        activePhotoId: state.activePhotoId ?? action.photos[0].id,
      };
    }

    case "photos/remove": {
      if (!state.photos.some((photo) => photo.id === action.photoId)) return state;
      return {
        ...withResultsCleared(state),
        photos: state.photos.filter((photo) => photo.id !== action.photoId),
        activePhotoId:
          state.activePhotoId === action.photoId
            ? nextActivePhotoId(state.photos, action.photoId)
            : state.activePhotoId,
      };
    }

    case "photos/select":
      return { ...state, activePhotoId: action.photoId, focusedDetectionId: null };

    case "detection/focus":
      return { ...state, focusedDetectionId: action.detectionId };

    case "run/start":
      return { ...state, status: "running", error: null, focusedDetectionId: null };

    case "run/fail":
      return { ...state, status: "idle", error: action.message };

    case "run/complete":
      return {
        ...state,
        status: "done",
        detections: action.run.detections,
        runMeta: { id: action.run.id, completedAt: action.run.completedAt },
        activePhotoId: state.activePhotoId ?? action.run.photos[0]?.id ?? null,
        error: null,
        runs: [action.run, ...state.runs],
      };

    // Reopening from History puts an archived run back on the stage without
    // re-recording it.
    case "run/open":
      return {
        ...state,
        lineId: action.run.lineId,
        photos: action.run.photos,
        detections: action.run.detections,
        status: "done",
        activePhotoId: action.run.photos[0]?.id ?? null,
        focusedDetectionId: null,
        runMeta: { id: action.run.id, completedAt: action.run.completedAt },
        error: null,
      };

    case "run/reset":
      return { ...withResultsCleared(state), photos: [], activePhotoId: null };

    default: {
      // Exhaustiveness check: adding an action without a case is a type error.
      const unhandled: never = action;
      return unhandled;
    }
  }
}
