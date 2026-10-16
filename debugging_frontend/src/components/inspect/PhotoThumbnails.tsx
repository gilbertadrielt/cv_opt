"use client";

import { cn } from "@/lib/cn";
import type { Photo } from "@/domain/types";
import { PhotoImage } from "@/components/ui/PhotoImage";

/**
 * The loaded photos, numbered to match the plate numbers in the report.
 *
 * Select and remove are separate sibling buttons rather than nested controls,
 * which keeps the markup valid and both actions reachable by keyboard.
 */
export function PhotoThumbnails({
  photos,
  activePhotoId,
  onSelect,
  onRemove,
}: {
  photos: readonly Photo[];
  activePhotoId: string | null;
  onSelect: (photoId: string) => void;
  onRemove: (photoId: string) => void;
}) {
  if (photos.length === 0) return null;

  return (
    <ul className="mt-3 grid grid-cols-3 gap-1.5">
      {photos.map((photo, index) => {
        const isActive = photo.id === activePhotoId;

        return (
          <li
            key={photo.id}
            className={cn(
              "relative aspect-square border border-rule-strong bg-stage",
              isActive && "outline-2 outline-offset-1 outline-ink",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(photo.id)}
              aria-pressed={isActive}
              className="block size-full"
            >
              <PhotoImage src={photo.url} alt="" className="size-full object-cover" />
              <span className="sr-only">Show {photo.name}</span>
            </button>

            <span className="absolute bottom-0.5 left-0.5 min-w-4 rounded-xs bg-stage/85 px-1 text-center font-mono text-3xs text-white numeric">
              {index + 1}
            </span>

            <button
              type="button"
              onClick={() => onRemove(photo.id)}
              aria-label={`Remove ${photo.name}`}
              className="absolute top-0.5 right-0.5 flex size-[17px] items-center justify-center rounded-xs bg-stage/85 text-xs leading-none text-white hover:bg-critical"
            >
              <span aria-hidden>×</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
