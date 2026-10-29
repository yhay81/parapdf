import type { DocumentSession, PageSize } from "../../document/session.ts";
import { drawPage } from "../../pdfjs/draw.ts";
import type { LayerState } from "../../pdfjs/layers.ts";

export interface PrintOptions {
  /** Dots per inch the pages are drawn at (default 150, as pdf.js's viewer prints). */
  resolution?: number;
  /**
   * Turn a page whose orientation differs from the first page's to the
   * sheet's, so that it prints at full size, as pdf.js's viewer prints
   * (default true). Off, such a page prints upright, scaled to fit.
   */
  autoRotate?: boolean;
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

const isPortrait = ({ width, height }: PageSize) => width <= height;

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  );

/**
 * Print every page of `session`'s document through the browser's print
 * dialog. The pages are drawn one at a time for printing, with the values
 * typed into form fields, into images that a print-only container holds
 * until the dialog closes. Resolves once the browser returns from its print
 * call.
 */
export async function printDocument(
  session: DocumentSession,
  { resolution = 150, autoRotate = true, onProgress, signal, layers }: PrintJobOptions = {},
): Promise<void> {
  current?.cleanUp();
  signal?.throwIfAborted();
  const scale = resolution / 72;
  const urls: string[] = [];
  const images: HTMLImageElement[] = [];
  const container = document.createElement("div");
  container.className = CONTAINER_CLASS;
  const style = document.createElement("style");
  let cleaned = false;
  let cancelRender: (() => void) | null = null;
  let drawing: HTMLCanvasElement | null = null;
  const job = {
    cleanUp() {
      if (cleaned) return;
      cleaned = true;
      cancelRender?.();
      // Cancel image requests before revoking URLs they may not have read yet.
      for (const image of images) image.removeAttribute("src");
      container.remove();
      style.remove();
      for (const url of urls) URL.revokeObjectURL(url);
      window.removeEventListener("afterprint", job.cleanUp);
      if (current === job) current = null;
    },
  };
  current = job;
  try {
    const first = await session.pageSize(0);
    if (cleaned) return;
    style.textContent = printCss(first);
    for (let pageIndex = 0; pageIndex < session.pageCount; pageIndex++) {
      if (cleaned) return;
      signal?.throwIfAborted();
      // Turned a quarter counterclockwise, as pdf.js's viewer turns it.
      const turned =
        autoRotate &&
        pageIndex > 0 &&
        isPortrait(await session.pageSize(pageIndex)) !== isPortrait(first);
      if (cleaned) return;
      signal?.throwIfAborted();
      const canvas = document.createElement("canvas");
      drawing = canvas;
      const task = drawPage(session.pdfjs, session.page(pageIndex), {
        scale,
        ...(turned ? { rotation: 270 as const } : {}),
        canvas,
        // What was typed into form fields, and the layers as the viewer
        // shows them, on pdf.js's configuration for printing.
        print: session.proxy.annotationStorage.print,
        ...(layers ? { layers: layers.forPrint() } : {}),
      });
      const abort = () => task.cancel();
      cancelRender = abort;
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await task.promise;
      } finally {
        cancelRender = null;
        signal?.removeEventListener("abort", abort);
      }
      if (cleaned) return;
      const blob = await toBlob(canvas);
      if (cleaned) return;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      // The image keeps the pixels; the canvas gives its memory back.
      canvas.width = 0;
      canvas.height = 0;
      drawing = null;
      const sheet = document.createElement("div");
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      sheet.append(image);
      container.append(sheet);
      images.push(image);
      onProgress?.(pageIndex + 1, session.pageCount);
    }
    if (cleaned) return;
    signal?.throwIfAborted();
    document.head.append(style);
    document.body.append(container);
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    if (cleaned) return;
    signal?.throwIfAborted();
    // Some browsers return from print() before the dialog closes: the pages
    // stay until it does.
    window.addEventListener("afterprint", job.cleanUp, { once: true });
    window.print();
  } catch (error) {
    // A replacement cancels the old render; only the active job reports
    // errors. Its cleanup has already released the old job's resources.
    if (cleaned) return;
    job.cleanUp();
    throw error;
  } finally {
    // A cancelled render or encoding also gives its canvas memory back,
    // once the renderer has stopped using it.
    if (drawing) {
      drawing.width = 0;
      drawing.height = 0;
    }
  }
}
