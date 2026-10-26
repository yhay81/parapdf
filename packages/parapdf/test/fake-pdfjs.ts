/**
 * pdf.js as the unit tests stand in for it: `getDocument()` and its loading
 * task, and the parts of `PDFDocumentProxy` and `PDFPageProxy` the code
 * under test calls, without a worker, a DOM, or a PDF. The code under test
 * is ParaPDF's own, sessions included; only pdf.js is replaced.
 */
import type * as Pdfjs from "pdfjs-dist";
import { DocumentSession, type PageSize } from "../src/document/session.ts";
import type { LoadedPdfjs } from "../src/pdfjs/loader.ts";

/** A US Letter page. */
export const LETTER: PageSize = { width: 612, height: 792 };

/** Lets the promise callbacks queued so far run. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A drawing that pdf.js started on a page, which the test completes or fails. */
export interface Drawing {
  pageIndex: number;
  /** What was asked for, read back from pdf.js's render parameters. */
  request: {
    scale: number;
    canvas: HTMLCanvasElement;
    region?: { x: number; y: number; width: number; height: number };
    intent?: string;
  };
  resolve(): void;
  reject(error: Error): void;
  /** pdf.js's render task; cancelling it rejects the drawing. */
  task: { promise: Promise<void>; cancel(): void };
  cancellations: number;
}

/** A text item as pdf.js's text content gives it. */
export interface FakeTextItem {
  str: string;
  hasEOL?: boolean;
  /** The item's baseline origin in PDF user space. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * pdf.js's page viewport of a page of `size` at `scale`, turned by
 * `rotation`: its size, and the conversion of a point in PDF user space,
 * y upward, to the viewport, y downward, as PageViewport's transform does it.
 */
function viewport(size: PageSize, scale: number, rotation: number) {
  const { width, height } = size;
  const quarter = rotation % 180 !== 0;
  return {
    scale,
    rotation,
    width: (quarter ? height : width) * scale,
    height: (quarter ? width : height) * scale,
    rawDims: { pageWidth: width, pageHeight: height, pageX: 0, pageY: 0 },
    convertToViewportPoint(x: number, y: number): [number, number] {
      switch (rotation) {
        case 90:
          return [y * scale, x * scale];
        case 180:
          return [(width - x) * scale, y * scale];
        case 270:
          return [(height - y) * scale, (width - x) * scale];
        default:
          return [x * scale, (height - y) * scale];
      }
    },
  };
}

/** pdf.js's exception for a render that was cancelled. */
class RenderingCancelledException extends Error {
  override readonly name = "RenderingCancelledException";
}

/**
 * A page as pdf.js gives it, whose drawings go to `drawings`, whose
 * cleanups to `cleaned`, and whose text reads to `textsRead`; its text is
 * read once `textsReady` resolves.
 */
function fakePage(
  pageIndex: number,
  size: PageSize,
  { drawings, cleaned, textsRead }: { drawings: Drawing[]; cleaned: number[]; textsRead: number[] },
  items: readonly FakeTextItem[],
  textsReady: Promise<unknown>,
): Pdfjs.PDFPageProxy {
  return {
    pageNumber: pageIndex + 1,
    rotate: 0,
    getViewport: ({ scale = 1, rotation = 0 }: { scale?: number; rotation?: number }) =>
      viewport(size, scale, rotation),
    render(parameters: {
      canvas: HTMLCanvasElement;
      viewport: { scale: number };
      transform?: number[];
      intent?: string;
    }) {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const { canvas, transform } = parameters;
      const drawing: Drawing = {
        pageIndex,
        request: {
          scale: parameters.viewport.scale,
          canvas,
          // pdf.js draws a region by shifting the page; the canvas has its size.
          ...(transform
            ? {
                region: {
                  x: -(transform[4] ?? 0),
                  y: -(transform[5] ?? 0),
                  width: canvas.width,
                  height: canvas.height,
                },
              }
            : {}),
          ...(parameters.intent ? { intent: parameters.intent } : {}),
        },
        resolve,
        reject,
        task: {
          promise,
          cancel() {
            drawing.cancellations++;
            reject(new RenderingCancelledException(`Rendering cancelled, page ${pageIndex + 1}`));
          },
        },
        cancellations: 0,
      };
      drawings.push(drawing);
      return drawing.task;
    },
    async getTextContent() {
      textsRead.push(pageIndex);
      await textsReady;
      return {
        items: items.map(({ str, hasEOL = false, x = 0, y = 0, width = 0, height = 10 }) => ({
          str,
          hasEOL,
          transform: [height, 0, 0, height, x, y],
          width,
          height,
        })),
      };
    },
    cleanup() {
      cleaned.push(pageIndex);
      return true;
    },
  } as unknown as Pdfjs.PDFPageProxy;
}

/**
 * pdf.js's state of a document's layers, the parts LayerState calls:
 * `groups` by id, which `setVisibility` and `setOCGState` change.
 */
export function fakeLayers(groups: Record<string, { name: string; visible: boolean }> = {}) {
  const state = Object.fromEntries(Object.entries(groups).map(([id, group]) => [id, { ...group }]));
  return {
    getOrder: () => null,
    getGroup: (id: string) => state[id] ?? null,
    setVisibility(id: string, visible: boolean) {
      const group = state[id];
      if (group) group.visible = visible;
    },
    setOCGState({ state: operations }: { state: unknown[] }) {
      let visible = true;
      for (const operation of operations) {
        if (operation === "ON" || operation === "OFF") visible = operation === "ON";
        else if (typeof operation === "string" && state[operation]) {
          (state[operation] as { visible: boolean }).visible = visible;
        }
      }
    },
    *[Symbol.iterator]() {
      yield* Object.entries(state);
    },
  };
}

export interface FakeDocumentOptions {
  /** Each page's size; one US Letter page by default. */
  pages?: readonly PageSize[];
  /** Each page's text items. */
  texts?: readonly (readonly FakeTextItem[])[];
  /** Pages' texts are read once it resolves; at once by default. */
  textsReady?: Promise<unknown>;
  /** Overrides of the document's own methods and fields. */
  proxy?: Record<string, unknown>;
}

/** pdf.js's document as the code under test calls it, with what it was asked. */
export function fakeDocument({
  pages = [LETTER],
  texts = [],
  textsReady = Promise.resolve(),
  proxy = {},
}: FakeDocumentOptions = {}) {
  const drawings: Drawing[] = [];
  const cleaned: number[] = [];
  /** Zero-based page indexes, in the order their text was asked for. */
  const textsRead: number[] = [];
  /** Zero-based page indexes, in the order pages were asked for. */
  const requested: number[] = [];
  const pageProxies = pages.map((size, index) =>
    fakePage(index, size, { drawings, cleaned, textsRead }, texts[index] ?? [], textsReady),
  );
  const document = {
    numPages: pages.length,
    getPage(pageNumber: number) {
      requested.push(pageNumber - 1);
      const page = pageProxies[pageNumber - 1];
      return page ? Promise.resolve(page) : Promise.reject(new Error("Invalid page request."));
    },
    getPermissions: async () => null,
    getOpenAction: async () => null,
    getPageLayout: async () => "",
    getPageMode: async () => "",
    getOutline: async () => null,
    getPageLabels: async () => null,
    getMetadata: async () => ({ info: {}, metadata: null }),
    getAttachments: async () => null,
    getAttachmentContent: async () => null,
    getOptionalContentConfig: async () => fakeLayers(),
    getDestination: async () => null,
    getPageIndex: async (ref: { num: number }) => ref.num,
    getFieldObjects: async () => null,
    annotationStorage: { size: 0, print: { printing: true } },
    saveDocument: async () => new Uint8Array([2]),
    getData: async () => new Uint8Array([1]),
    ...proxy,
  };
  return {
    proxy: document as unknown as Pdfjs.PDFDocumentProxy,
    drawings,
    cleaned,
    textsRead,
    requested,
  };
}

/** pdf.js's exception for a document whose password is missing or wrong. */
export class PasswordException extends Error {
  override readonly name = "PasswordException";
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

/** pdf.js's codes for why it asks for a password. */
const PasswordResponses = { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 };

/** A loading task as pdf.js's getDocument() returns it. */
export interface FakeLoadingTask {
  promise: Promise<Pdfjs.PDFDocumentProxy>;
  onProgress: ((progress: { loaded: number; total?: number }) => void) | null;
  onPassword: ((update: (password: string | Error) => void, code: number) => void) | null;
  destroy(): Promise<void>;
}

/**
 * Asks for a password as pdf.js's worker does, through the loading task's
 * `onPassword`; resolves with the password given, or null when pdf.js would
 * fail with a PasswordException, as without `onPassword`.
 */
export function askPassword(
  task: FakeLoadingTask,
  reason: "required" | "incorrect",
): Promise<string | null> {
  const onPassword = task.onPassword;
  if (!onPassword) return Promise.resolve(null);
  const code =
    reason === "incorrect" ? PasswordResponses.INCORRECT_PASSWORD : PasswordResponses.NEED_PASSWORD;
  return new Promise((resolve) => {
    onPassword((password) => resolve(password instanceof Error ? null : password), code);
  });
}

/**
 * pdf.js loaded, whose `getDocument()` opens a document as `open` says:
 * `open` gets the loading task, through which it reports progress and asks
 * for passwords, and getDocument's parameters, and resolves with the
 * document. `calls` counts the documents opened and destroyed.
 */
export function fakePdfjs(
  open: (
    task: FakeLoadingTask,
    parameters: { password?: string } & Record<string, unknown>,
  ) => Promise<Pdfjs.PDFDocumentProxy> = async () => fakeDocument().proxy,
) {
  const calls = { opens: 0, destroys: 0, parameters: [] as Record<string, unknown>[] };
  const pdfjs = {
    getDocument(parameters: { password?: string } & Record<string, unknown>) {
      calls.opens++;
      calls.parameters.push(parameters);
      let stop: (error: Error) => void = () => {};
      const task: FakeLoadingTask = {
        promise: Promise.resolve() as unknown as Promise<Pdfjs.PDFDocumentProxy>,
        onProgress: null,
        onPassword: null,
        async destroy() {
          calls.destroys++;
          // Destroying the task stops a load still in progress.
          stop(new Error("Worker was destroyed"));
        },
      };
      // Like pdf.js's worker, `open` reports and asks once getDocument() has returned.
      task.promise = new Promise((resolve, reject) => {
        stop = reject;
        Promise.resolve()
          .then(() => open(task, parameters))
          .then(resolve, reject);
      });
      return task;
    },
    PasswordResponses,
    PasswordException,
    PermissionFlag: {
      PRINT: 0x04,
      MODIFY_CONTENTS: 0x08,
      COPY: 0x10,
      MODIFY_ANNOTATIONS: 0x20,
      FILL_INTERACTIVE_FORMS: 0x100,
      COPY_FOR_ACCESSIBILITY: 0x200,
      ASSEMBLE: 0x400,
      PRINT_HIGH_QUALITY: 0x800,
    },
    AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
    PDFDateString: {
      toDateObject: (value: string) => new Date(`${value.slice(2, 6)}-01-01T00:00:00Z`),
    },
  };
  const loaded = {
    pdfjs,
    worker: {},
    documentParameters: { enableHWA: true },
    imageResourcesPath: "/images/",
    iconUrls: null,
    workerLocation: "/pdf.worker.js",
  } as unknown as LoadedPdfjs;
  return { loader: async () => loaded, loaded, calls };
}

/**
 * A session of a document of `options`, opened through the fake pdf.js, for
 * code that takes a session: the scheduler, printing, and thumbnails.
 */
export async function openSession(options: FakeDocumentOptions = {}) {
  const document = fakeDocument(options);
  const { loader, calls } = fakePdfjs(async () => document.proxy);
  const controller = new AbortController();
  const session = await DocumentSession.open(loader, { url: "/test.pdf" }, controller);
  return { session, controller, calls, ...document };
}
