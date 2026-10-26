/** Hands `bytes` to the browser as a download named `filename`. */
export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  type = "application/octet-stream",
): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start reading the blob only after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The last path segment of a URL, decoded, when it names a file; null otherwise. */
export function filenameFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url, "http://localhost/");
    const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
    return name || null;
  } catch {
    return null;
  }
}
