import type { AnnotationLabels } from "./editor-types.ts";

/*
 * The labels of what pdf.js's editors show, in the application's language
 * (`AnnotationLabels`): pdf.js marks its text with Fluent ids, which only
 * its own viewer translates.
 */

/**
 * pdf.js's localization ids of the elements its editors create, and the
 * label each gets: buttons and color options a title and an accessible
 * name, everything else an accessible name.
 */
const LABELS: Record<string, keyof AnnotationLabels> = {
  "pdfjs-editor-highlight-editor": "highlight",
  "pdfjs-free-text2": "freeText",
  "pdfjs-editor-ink-editor": "ink",
  "pdfjs-editor-stamp-editor": "stamp",
  "pdfjs-editor-signature-editor1": "signature",
  "pdfjs-editor-remove-highlight-button": "removeHighlight",
  "pdfjs-editor-remove-freetext-button": "removeFreeText",
  "pdfjs-editor-remove-ink-button": "removeInk",
  "pdfjs-editor-remove-stamp-button": "removeStamp",
  "pdfjs-editor-remove-signature-button": "removeSignature",
  "pdfjs-editor-colorpicker-button": "color",
  "pdfjs-editor-colorpicker-dropdown": "colors",
  "pdfjs-editor-color-picker-free-text-input": "textColor",
  "pdfjs-editor-color-picker-ink-input": "inkColor",
  "pdfjs-editor-colorpicker-yellow": "yellow",
  "pdfjs-editor-colorpicker-green": "green",
  "pdfjs-editor-colorpicker-blue": "blue",
  "pdfjs-editor-colorpicker-pink": "pink",
  "pdfjs-editor-colorpicker-red": "red",
  "pdfjs-editor-resizer-top-left": "resizeTopLeft",
  "pdfjs-editor-resizer-top-middle": "resizeTopMiddle",
  "pdfjs-editor-resizer-top-right": "resizeTopRight",
  "pdfjs-editor-resizer-middle-right": "resizeMiddleRight",
  "pdfjs-editor-resizer-bottom-right": "resizeBottomRight",
  "pdfjs-editor-resizer-bottom-middle": "resizeBottomMiddle",
  "pdfjs-editor-resizer-bottom-left": "resizeBottomLeft",
  "pdfjs-editor-resizer-middle-left": "resizeMiddleLeft",
};

/** Gives `element` the label of its localization id, if ParaPDF has one. */
function label(element: Element, labels: AnnotationLabels): void {
  const id = element.getAttribute("data-l10n-id");
  const key = id ? LABELS[id] : undefined;
  if (!key) return;
  let text = labels[key];
  if (key === "signature") {
    // pdf.js passes the signature's description as the message's argument.
    const args = element.getAttribute("data-l10n-args");
    const description = args ? (JSON.parse(args) as { description?: string }).description : "";
    if (description) text = `${text}: ${description}`;
  }
  if (key === "freeText") element.setAttribute("default-content", labels.freeTextPlaceholder);
  if (element.getAttribute("aria-label") !== text) element.setAttribute("aria-label", text);
  const titled =
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element.getAttribute("role") === "option";
  if (titled && element.getAttribute("title") !== text) element.setAttribute("title", text);
}

/**
 * Labels what pdf.js's editors add to `container` from now on, and what is
 * there already. pdf.js marks its text with Fluent ids, which only its own
 * viewer translates.
 */
export function labelElements(container: HTMLElement, labels: AnnotationLabels): MutationObserver {
  const labelTree = (node: Node) => {
    if (!(node instanceof Element)) return;
    label(node, labels);
    for (const element of node.querySelectorAll("[data-l10n-id]")) label(element, labels);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") label(record.target as Element, labels);
      else for (const node of record.addedNodes) labelTree(node);
    }
  });
  observer.observe(container, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-l10n-id", "data-l10n-args"],
  });
  labelTree(container);
  return observer;
}

/**
 * What pdf.js's editors ask of a localization: messages for the alt text
 * of images, which ParaPDF does not show, and nothing else; they mark
 * elements with ids instead, which `labelElements` labels.
 */
export const l10n = {
  getLanguage: () => document.documentElement.lang || "en",
  getDirection: () => "ltr",
  get: async (_id: string, _args?: unknown, fallback?: string) => fallback ?? "",
  translate: async () => {},
  translateOnce: async () => {},
  pause() {},
  resume() {},
  destroy() {},
};
