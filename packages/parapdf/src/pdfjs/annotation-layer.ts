import type * as Pdfjs from "pdfjs-dist";
import type { Destination } from "./destinations.ts";
import {
  formLayerOf,
  type OptionalContentConfig,
  RenderCancelledError,
  type Rotation,
  viewportOf,
} from "./draw.ts";
import type { LoadedPdfjs } from "./loader.ts";
import type { StructTreeBuilder } from "./struct-tree.ts";

/** How activated links leave the annotation layer: always through the viewer. */
export interface LinkHandlers {
  navigate(dest: Destination): void;
  /** PDF named actions such as `NextPage` or `GoBack`. */
  namedAction(action: string): void;
  /** Links to other documents open in a new tab (the default) or stay inert. */
  externalLinks?: "new-tab" | "disabled";
  /** A file attachment annotation or a link to an embedded file was activated. */
  openAttachment?(attachment: { filename: string; content: Uint8Array }): void;
  /** A link that shows and hides layers was activated: pdf.js's SetOCGState action. */
  setLayers?(action: unknown): void;
}

export interface AnnotationLayerRequest {
  /**
   * Receives positioned links, comment popups, and, with `forms`, form
   * fields; sized by the `--total-scale-factor` CSS variable.
   */
  container: HTMLElement;
  /** CSS pixels per PDF point. */
  cssScale: number;
  rotation?: Rotation;
  links: LinkHandlers;
  /**
   * Show form fields as HTML that the reader can fill in. The page's drawings
   * then pass this container as their `formLayer`.
   */
  forms?: boolean;
  /** Hide the annotations of hidden layers; the document's default when absent. */
  layers?: OptionalContentConfig;
  /** The page's structure tree, built with its text layer, which labels its annotations. */
  structTree?: StructTreeBuilder | null;
  /** The annotation editor the layer hands the annotations pdf.js edits to. */
  editor?: AnnotationLayerEditing | null;
  /** The document's scripts, which form fields hand their events to (`forms`). */
  scripting?: AnnotationLayerScripting | null;
}

/** pdf.js's event bus, as annotation elements dispatch to it. */
interface EventBus {
  dispatch(name: string, event: Record<string, unknown>): void;
}

/** What a page's form fields need of the document's scripts. */
export interface AnnotationLayerScripting {
  /** Hand the scripts an event of a field: a keystroke, a focus, a click, … */
  dispatch(event: object): void;
}

/**
 * What a page's annotation layer and drawing need of the viewer's
 * annotation editor, so that the annotations of the file that pdf.js edits
 * become its editors.
 */
export interface AnnotationLayerEditing {
  /** pdf.js's AnnotationEditorUIManager, which the layer reports them to. */
  readonly uiManager: object;
  /** Where a double click on one asks the editor to edit it. */
  readonly eventBus: EventBus;
  /**
   * A tool is chosen: the page's drawing leaves them out, and draws images
   * among them into canvases of their own, which the layer takes, as it
   * takes those of form fields (see `formLayerOf`).
   */
  readonly editing: boolean;
}

export interface AnnotationLayerHandle {
  /** pdf.js's layer, which the page's annotation editor layer takes the file's annotations from. */
  readonly layer: Pdfjs.AnnotationLayer;
  update(cssScale: number, rotation: Rotation): void;
}

export interface AnnotationLayerTask {
  readonly promise: Promise<AnnotationLayerHandle>;
  cancel(): void;
}

/**
 * The part of pdf.js's link service interface that link annotations call.
 * Internal links and named actions go to the viewer; pdf.js's own viewer
 * components are never involved.
 */
function createLinkService(
  links: LinkHandlers,
  doc: Pdfjs.PDFDocumentProxy,
  editorBus: EventBus | undefined,
  scripting: AnnotationLayerScripting | null,
) {
  const external = links.externalLinks !== "disabled";
  return {
    externalLinkEnabled: external,
    // Where annotations the editor edits ask for it on a double click, and
    // form fields hand their events to the document's scripts.
    eventBus:
      scripting || editorBus
        ? {
            dispatch(name: string, event: Record<string, unknown>) {
              if (name !== "dispatcheventinsandbox") editorBus?.dispatch(name, event);
              else if (event.detail) scripting?.dispatch(event.detail);
            },
          }
        : undefined,
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      // Without an href the element is neither focusable nor a link, and the
      // text it covered stays readable in the text layer.
      if (!external) return;
      link.href = url;
      link.title = url;
      // External pages open in a new tab so the document keeps its position.
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
    },
    getDestinationHash(dest: unknown) {
      return typeof dest === "string" && dest ? `#${encodeURIComponent(dest)}` : "#";
    },
    getAnchorUrl(anchor: string) {
      return `#${anchor}`;
    },
    goToDestination(dest: Destination) {
      links.navigate(dest);
    },
    executeNamedAction(action: string) {
      links.namedAction(action);
    },
    executeSetOCGState(action: unknown) {
      links.setLayers?.(action);
    },
    async getAttachmentContent(id: string) {
      return doc.getAttachmentContent(id).catch(() => null);
    },
  };
}

/** What pdf.js's annotation elements call to hand over an embedded file. */
const createDownloadManager = (links: LinkHandlers) => ({
  openOrDownloadData(content: Uint8Array, filename: string) {
    links.openAttachment?.({ filename, content });
  },
});

/**
 * Points the icons pdf.js named after the transparent image's fragment mark
 * (`LoadedPdfjs.imageResourcesPath`) at their own URLs. pdf.js builds an
 * icon's URL from one base, which files a bundler emits under names of their
 * own do not share; an icon without a file keeps the transparent image.
 */
function placeIcons(container: HTMLElement, base: string, icons: Readonly<Record<string, string>>) {
  for (const image of container.querySelectorAll("img")) {
    const src = image.getAttribute("src");
    if (!src?.startsWith(base)) continue;
    const url = icons[src.slice(base.length)];
    if (url) image.src = url;
  }
}

/**
 * Build focusable link elements for the links of `page`, once it has
 * loaded, and its other annotations that are not drawn: comment popups,
 * file attachments, and, with `forms`, form fields.
 */
export function buildAnnotationLayer(
  { pdfjs, imageResourcesPath, iconUrls }: LoadedPdfjs,
  doc: Pdfjs.PDFDocumentProxy,
  page: Promise<Pdfjs.PDFPageProxy>,
  {
    container,
    cssScale,
    rotation,
    links,
    forms = false,
    layers,
    structTree,
    editor,
    scripting = null,
  }: AnnotationLayerRequest,
): AnnotationLayerTask {
  let cancelled = false;
  // The fields of every page, which radio buttons and fields shown on
  // several pages use to keep their widgets in step; pdf.js keeps them.
  const fieldObjects = forms ? doc.getFieldObjects().catch(() => null) : null;
  const promise = page.then(async (page): Promise<AnnotationLayerHandle> => {
    const [annotations, fields] = await Promise.all([
      page.getAnnotations({ intent: "display" }),
      fieldObjects,
    ]);
    if (cancelled) throw new RenderCancelledError("annotation layer cancelled");
    const viewport = viewportOf(page, cssScale, rotation);
    const linkService = createLinkService(links, doc, editor?.eventBus, forms ? scripting : null);
    // Without forms, form fields stay in the drawing (pdf.js's default
    // annotation mode), so only links, popups, and other annotations
    // that are not fields become HTML here. With an editor, the drawings
    // made while a tool is chosen hand the layer the canvases of images
    // it edits, whether or not one was chosen as the layer was built.
    const form = forms || editor ? formLayerOf(container) : null;
    const layer = new pdfjs.AnnotationLayer({
      div: container,
      accessibilityManager: null,
      annotationCanvasMap: form?.canvases ?? null,
      annotationEditorUIManager: (editor?.uiManager ?? null) as never,
      page,
      viewport,
      structTreeLayer: structTree ?? null,
      commentManager: null,
      linkService,
      annotationStorage: doc.annotationStorage,
    });
    await layer.render({
      annotations,
      div: container as HTMLDivElement,
      page,
      viewport,
      linkService: linkService as never,
      downloadManager: createDownloadManager(links) as never,
      annotationStorage: doc.annotationStorage,
      imageResourcesPath,
      renderForms: forms,
      // Given only for a document with scripts (src/features/forms/scripts.ts).
      enableScripting: forms && scripting !== null,
      hasJSActions: forms && scripting !== null,
      fieldObjects: fields,
      ...(layers ? { optionalContentConfig: layers } : {}),
    });
    if (iconUrls) placeIcons(container, imageResourcesPath, iconUrls);
    if (form) form.layer = layer;
    return {
      layer,
      update(nextScale, nextRotation) {
        layer.update({ viewport: viewportOf(page, nextScale, nextRotation) } as never);
      },
    };
  });
  return {
    promise,
    cancel() {
      cancelled = true;
    },
  };
}
