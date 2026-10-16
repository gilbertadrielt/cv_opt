/**
 * Hands a generated file to the browser's download flow.
 *
 * The object URL is revoked on the next tick rather than immediately: some
 * browsers read the blob asynchronously after the click, and revoking too early
 * produces a silently empty file.
 */
export function downloadFile(filename: string, contents: BlobPart, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
