"use client";

import type { PageArea } from "../view/layout.ts";

/**
 * The DOM the renderer builds for a page inside the host React places: the
 * canvases, and the containers of the text, annotation, editor, and
 * structure layers. React renders the host and what applications draw over
 * the page; everything else in it is the renderer's.
 */
export interface PageElements {
  readonly host: HTMLElement;
  /**
   * Holds the canvases: pixels only, hidden from assistive technology; the
   * text layer carries the content. Highlights and lines the reader draws
   * go here too, over the page's own drawing.
   */
  readonly drawings: HTMLElement;
  base: HTMLCanvasElement;
  /** The detail canvas the page shows. */
  detail: HTMLCanvasElement;
  /** The other detail canvas, which the next detail is drawn into while the page shows one. */
  spare: HTMLCanvasElement;
  /**
   * A tagged page's structure, as pdf.js's viewer keeps it: a canvas's
   * fallback content is read by assistive technology but never drawn.
   */
  readonly structure: HTMLElement | null;
  readonly text: HTMLElement | null;
  readonly annotations: HTMLElement | null;
  /** Receives the annotations the viewer edits on the page, while it edits them. */
  editor: HTMLElement | null;
}

/** Which layers a page gets besides its canvases. */
export interface PageLayers {
  text: boolean;
  annotations: boolean;
  editor: boolean;
}

/** Canvases a page kept when it unmounted, which it takes back as they are. */
export interface KeptCanvases {
  base?: HTMLCanvasElement | undefined;
  detail?: HTMLCanvasElement | undefined;
}

const LAYER_STYLE = "position:absolute;inset:0;width:100%;height:100%";

/**
 * Hands a canvas's pixels back: a zero-sized canvas releases its backing
 * memory at once, which matters on iOS where total canvas memory is capped.
 * It is hidden too: Chromium draws a canvas with pdf.js's opaque context
 * black over its whole box once its size is zero, so a zeroed detail canvas
 * stacked over the shown one covered the page with black. A drawing shows
 * it again once it completes.
 */
export function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.visibility = "hidden";
}

/** Positions a detail canvas over `region` of its page, or over the whole page. */
export function placeDetail(canvas: HTMLCanvasElement, region: PageArea | null): void {
  const { style } = canvas;
  const area = region ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  style.left = `${area.minX * 100}%`;
  style.top = `${area.minY * 100}%`;
  style.width = `${(area.maxX - area.minX) * 100}%`;
  style.height = `${(area.maxY - area.minY) * 100}%`;
}

function createCanvas(document: Document): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = LAYER_STYLE;
  // Canvas pixels are counted by size, and a new canvas is 300 by 150.
  release(canvas);
  return canvas;
}

function createLayer(document: Document, className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

/**
 * Builds a page's DOM at the start of `host`, before what React renders
 * there, with the canvases it kept, which move in without a copy.
 */
export function mountPage(
  host: HTMLElement,
  layers: PageLayers,
  kept: KeptCanvases = {},
): PageElements {
  const document = host.ownerDocument;
  const drawings = createLayer(document, "parapdf-canvas-wrapper");
  drawings.setAttribute("aria-hidden", "true");
  drawings.style.cssText = LAYER_STYLE;
  const base = kept.base ?? createCanvas(document);
  const detail = kept.detail ?? createCanvas(document);
  // Two detail canvases: a new detail is drawn into one while the other shows the old.
  const spare = createCanvas(document);
  drawings.append(base, detail, spare);
  let structure: HTMLElement | null = null;
  if (layers.text) {
    structure = document.createElement("canvas");
    structure.className = "parapdf-structure";
    (structure as HTMLCanvasElement).width = 0;
    (structure as HTMLCanvasElement).height = 0;
  }
  const text = layers.text ? createLayer(document, "parapdf-text-layer") : null;
  const annotations = layers.annotations ? createLayer(document, "parapdf-annotation-layer") : null;
  const editor = layers.editor ? createLayer(document, "parapdf-editor-layer") : null;
  const elements: PageElements = {
    host,
    drawings,
    base,
    detail,
    spare,
    structure,
    text,
    annotations,
    editor,
  };
  host.prepend(...ownNodes(elements));
  return elements;
}

function ownNodes(elements: PageElements): HTMLElement[] {
  const { drawings, structure, text, annotations, editor } = elements;
  return [drawings, structure, text, annotations, editor].filter(
    (element): element is HTMLElement => element !== null,
  );
}

/** Takes the page's DOM out of its host; the canvases it keeps can move into another. */
export function unmountPage(elements: PageElements): void {
  for (const node of ownNodes(elements)) node.remove();
}

/** Gives the page a container for the annotations being edited, after its other layers. */
export function addEditorLayer(elements: PageElements): HTMLElement {
  if (elements.editor) return elements.editor;
  const editor = createLayer(elements.host.ownerDocument, "parapdf-editor-layer");
  (elements.annotations ?? elements.text ?? elements.structure ?? elements.drawings).after(editor);
  elements.editor = editor;
  return editor;
}

export function removeEditorLayer(elements: PageElements): void {
  elements.editor?.remove();
  elements.editor = null;
}
