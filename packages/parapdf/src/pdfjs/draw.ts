import type * as Pdfjs from "pdfjs-dist";
import type { LoadedPdfjs } from "./loader.ts";

/** pdf.js's state of a document's layers (optional content), which drawings take. */
export type OptionalContentConfig = Awaited<
  ReturnType<Pdfjs.PDFDocumentProxy["getOptionalContentConfig"]>
>;

/** Clockwise view rotation in degrees, on top of any rotation the page itself has. */
export type Rotation = 0 | 90 | 180 | 270;

/** A page drawn in two colors: its background and everything else. */
export interface PageColors {
  background: string;
  foreground: string;
}

/** A rectangle of a page in pixels at a drawing's scale. */
export interface DrawRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawRequest {
  /** Device pixels per PDF point. */
  scale: number;
  rotation?: Rotation;
  canvas: HTMLCanvasElement;
  /** Draw only this part of the page; the canvas takes its size. The whole page when absent. */
  region?: DrawRegion;
  /**
   * Draw what a printout shows, with the values typed into form fields:
   * the document's `annotationStorage.print`. Without it, what a screen
   * shows.
   */
  print?: Pdfjs.PDFDocumentProxy["annotationStorage"]["print"];
  /**
   * The container of this page's annotation layer when it shows form fields
   * as HTML (`AnnotationLayerRequest.forms`): the drawing leaves the fields
   * out, and what the layer needs drawn for them goes to it.
   */
  formLayer?: HTMLElement;
  /** Colors to draw the page in instead of its own, for high-contrast reading. */
  colors?: PageColors;
  /**
   * Which layers to draw, for the intent drawn: a configuration for
   * printing with `print`. The document's default when absent.
   */
  layers?: OptionalContentConfig | Promise<OptionalContentConfig>;
}

export interface DrawTask {
  /** Resolves once the pixels are on `canvas`; rejects with a cancellation error after `cancel`. */
  readonly promise: Promise<void>;
  cancel(): void;
}

export class RenderCancelledError extends Error {
  override readonly name = "RenderCancelledError";
}

const cancellationNames = new Set([
  "RenderCancelledError",
  // pdf.js names for a cancelled page render and a cancelled text layer.
  "RenderingCancelledException",
  "AbortException",
]);

export const isRenderCancelled = (error: unknown): boolean =>
  error instanceof Error && cancellationNames.has(error.name);

/** The page at `scale` turned by the view on top of its own rotation. */
export const viewportOf = (
  page: Pdfjs.PDFPageProxy,
  scale: number,
  rotation: Rotation = 0,
): Pdfjs.PageViewport => page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });

/**
 * Form layers by container. With forms shown as HTML, pdf.js draws check
 * boxes and radio buttons into canvases of their own, one per state, which
 * the page's annotation layer shows over its input: each drawing fills the
 * container's map, and the layer takes the canvases from it once built, and
 * again after every later drawing.
 */
const formLayers = new WeakMap<
  HTMLElement,
  { canvases: Map<string, HTMLCanvasElement>; layer: Pdfjs.AnnotationLayer | null }
>();

export function formLayerOf(container: HTMLElement): {
  canvases: Map<string, HTMLCanvasElement>;
  layer: Pdfjs.AnnotationLayer | null;
} {
  let entry = formLayers.get(container);
  if (!entry) {
    entry = { canvases: new Map(), layer: null };
    formLayers.set(container, entry);
  }
  return entry;
}

/** Draw `page`, once it has loaded, into `request.canvas`, through pdf.js's core display API. */
export function drawPage(
  { pdfjs }: LoadedPdfjs,
  page: Promise<Pdfjs.PDFPageProxy>,
  { scale, rotation, canvas, region, print, formLayer, colors, layers }: DrawRequest,
): DrawTask {
  let task: Pdfjs.RenderTask | undefined;
  let cancelled = false;
  const promise = page.then(async (page) => {
    if (cancelled) throw new RenderCancelledError("render cancelled before it started");
    const viewport = viewportOf(page, scale, rotation);
    const form = formLayer ? formLayerOf(formLayer) : null;
    const parameters = {
      canvas,
      viewport,
      ...(colors ? { pageColors: colors } : {}),
      ...(layers ? { optionalContentConfigPromise: Promise.resolve(layers) } : {}),
      ...(print
        ? {
            intent: "print",
            annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE,
            printAnnotationStorage: print,
          }
        : form
          ? {
              annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
              annotationCanvasMap: form.canvases,
            }
          : {}),
    };
    if (region) {
      // Shift the page so the region's corner lands on the canvas origin.
      canvas.width = region.width;
      canvas.height = region.height;
      task = page.render({ ...parameters, transform: [1, 0, 0, 1, -region.x, -region.y] });
    } else {
      // Whole pixels, as pdf.js's viewer sizes them, past a scale's
      // rounding error: a thumbnail 240 px wide came out at 239.99….
      canvas.width = Math.floor(viewport.width + 1e-6);
      canvas.height = Math.floor(viewport.height + 1e-6);
      task = page.render(parameters);
    }
    await task.promise;
    form?.layer?.refreshCanvases();
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}

/**
 * Draw `source`, a drawing kept from another canvas of a page, into
 * `canvas`, sized to it, with the context pdf.js draws with, so that the
 * page shows it at once and later drawings draw over it.
 */
export function drawKept(
  { contextOptions }: LoadedPdfjs,
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
): void {
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", contextOptions) as CanvasRenderingContext2D | null;
  context?.drawImage(source, 0, 0);
}
