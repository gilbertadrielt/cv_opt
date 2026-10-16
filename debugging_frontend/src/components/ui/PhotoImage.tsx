/* eslint-disable @next/next/no-img-element --
 * Every image in this console is either an object URL for a file the inspector
 * just picked, or a data URL produced by the annotation canvas. Neither exists
 * on a server or has intrinsic dimensions known ahead of time, so `next/image`
 * has nothing to optimise and its loader cannot fetch them at all.
 *
 * Centralised here so the exception is stated once, rather than as a disable
 * comment at every call site.
 */
import type { ImgHTMLAttributes } from "react";

export type PhotoImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  /** Pass `""` when a sibling element already names the photo. */
  alt: string;
};

// `alt` is destructured rather than spread so the a11y lint rule can see it;
// the prop type makes it required either way.
export function PhotoImage({ alt, ...props }: PhotoImageProps) {
  return <img alt={alt} {...props} />;
}
