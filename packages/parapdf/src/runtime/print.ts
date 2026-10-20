import type { LayerState, PageSize, PdfEngineDocument } from "../engine/types.ts";

export interface PrintOptions {
  /** Dots per inch the pages are drawn at (default 150, as pdf.js's viewer prints). */
  resolution?: number;
  /** Called after each page is drawn, with the pages drawn and how many there are. */
  onProgress?(done: number, total: number): void;
  /** Aborting stops drawing pages and prints nothing. */
  signal?: AbortSignal;
}

interface PrintJobOptions extends PrintOptions {
  /** The layers the viewer shows, which print as they show. */
  layers?: LayerState | null;
}

const CONTAINER_CLASS = "parapdf-print";

/** The print job in progress, which a new one replaces. */
let current: { cleanUp(): void } | null = null;

/**
 * The print styles: only the drawn pages print, one per sheet, each scaled
 * to fit it, on sheets the size of the first page, as in pdf.js's viewer.
 */
const printCss = (first: PageSize) => `
@page { size: ${first.width}pt ${first.height}pt; margin: 0; }
@media screen { .${CONTAINER_CLASS} { display: none; } }
@media print {
  html, body { height: 100% !important; margin: 0 !important; padding: 0 !important; background: none !important; }
  body > :not(.${CONTAINER_CLASS}) { display: none !important; }
  .${CONTAINER_CLASS} { display: block; height: 100%; }
  .${CONTAINER_CLASS} > div {
    break-after: page;
    break-inside: avoid;
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
  .${CONTAINER_CLASS} img { max-width: 100%; max-height: 100%; display: block; }
}
`;

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  );

/**
 * Print every page of `doc` through the browser's print dialog. The pages
 * are drawn one at a time for printing, with the values typed into form
 * fields, into images that a print-only container holds until the dialog
 * closes. Resolves once the browser returns from its print call.
 */
export async function printDocument(
  doc: PdfEngineDocument,
  { resolution = 150, onProgress, signal, layers }: PrintJobOptions = {},
): Promise<void> {
  current?.cleanUp();
  signal?.throwIfAborted();
  const scale = resolution / 72;
  const urls: string[] = [];
  const container = document.createElement("div");
  container.className = CONTAINER_CLASS;
  const style = document.createElement("style");
  let cleaned = false;
  const job = {
    cleanUp() {
      if (cleaned) return;
      cleaned = true;
      container.remove();
      style.remove();
      for (const url of urls) URL.revokeObjectURL(url);
      window.removeEventListener("afterprint", job.cleanUp);
      if (current === job) current = null;
    },
  };
  current = job;
  try {
    const first = await doc.pageSize(0);
    style.textContent = printCss(first);
    const images: HTMLImageElement[] = [];
    for (let pageIndex = 0; pageIndex < doc.pageCount; pageIndex++) {
      signal?.throwIfAborted();
      const canvas = document.createElement("canvas");
      const task = doc.render({
        pageIndex,
        scale,
        canvas,
        intent: "print",
        ...(layers ? { layers } : {}),
      });
      const abort = () => task.cancel();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await task.promise;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
      const url = URL.createObjectURL(await toBlob(canvas));
      urls.push(url);
      // The image keeps the pixels; the canvas gives its memory back.
      canvas.width = 0;
      canvas.height = 0;
      const sheet = document.createElement("div");
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      sheet.append(image);
      container.append(sheet);
      images.push(image);
      onProgress?.(pageIndex + 1, doc.pageCount);
    }
    signal?.throwIfAborted();
    document.head.append(style);
    document.body.append(container);
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    signal?.throwIfAborted();
    // Some browsers return from print() before the dialog closes: the pages
    // stay until it does.
    window.addEventListener("afterprint", job.cleanUp, { once: true });
    window.print();
  } catch (error) {
    job.cleanUp();
    throw error;
  }
}
