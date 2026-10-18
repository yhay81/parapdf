/**
 * Keeps a drag selection from jumping across a page. Ported from the
 * selection handling of `TextLayerBuilder` in PDF.js
 * `web/text_layer_builder.js` (pdfjs-dist 6.4.299; Copyright Mozilla
 * Foundation, Apache License 2.0; see NOTICE.md).
 *
 * Every text layer ends with an `.endOfContent` element. While a selection
 * touches a layer, the layer has the `selecting` class, and the viewer CSS
 * stretches that element over the page so that dragging past the last run
 * does not select from the page's start. WebKit and Chromium before 148
 * instead extend such a selection to wherever `.endOfContent` sits in the
 * DOM, so the element moves next to the run where the selection is changing.
 *
 * pdf.js shares one set of document listeners among all its text layers;
 * here every viewer owns a tracker, so destroying one viewer cannot switch
 * off selection handling in another (pdf.js issue 22129).
 */
export class TextSelectionTracker {
  /** Each tracked text layer with its `.endOfContent` element. */
  readonly #layers = new Map<HTMLElement, HTMLElement>();
  #listeners: AbortController | null = null;
  #pointerDown = false;
  #previousRange: Range | null = null;
  #keepsSelectionInRuns: boolean | undefined;

  /** Tracks a rendered text layer whose last child is `end`. */
  add(layer: HTMLElement, end: HTMLElement): void {
    this.#layers.set(layer, end);
    this.#listen();
  }

  /** Stops tracking a text layer before its content is removed. */
  remove(layer: HTMLElement): void {
    this.#layers.delete(layer);
    if (this.#layers.size === 0) this.#stop();
  }

  /** Stops tracking every text layer, for example when the document closes. */
  clear(): void {
    this.#layers.clear();
    this.#stop();
  }

  #stop(): void {
    this.#listeners?.abort();
    this.#listeners = null;
    this.#pointerDown = false;
    this.#previousRange = null;
  }

  #reset(layer: HTMLElement, end: HTMLElement): void {
    layer.append(end);
    end.style.width = "";
    end.style.height = "";
    layer.classList.remove("selecting");
  }

  #resetAll(): void {
    for (const [layer, end] of this.#layers) this.#reset(layer, end);
  }

  #listen(): void {
    if (this.#listeners) return;
    this.#listeners = new AbortController();
    const options = { signal: this.#listeners.signal };
    const release = () => {
      this.#pointerDown = false;
      this.#resetAll();
    };
    document.addEventListener(
      "mousedown",
      (event) => {
        const layer =
          event.target instanceof Element ? event.target.closest(".parapdf-text-layer") : null;
        if (layer instanceof HTMLElement && this.#layers.has(layer)) {
          layer.classList.add("selecting");
        }
      },
      options,
    );
    document.addEventListener(
      "pointerdown",
      () => {
        this.#pointerDown = true;
      },
      options,
    );
    document.addEventListener("pointerup", release, options);
    document.addEventListener("pointercancel", release, options);
    window.addEventListener("blur", release, options);
    document.addEventListener(
      "keyup",
      () => {
        if (!this.#pointerDown) this.#resetAll();
      },
      options,
    );
    document.addEventListener("selectionchange", () => this.#onSelectionChange(), options);
  }

  #onSelectionChange(): void {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.#resetAll();
      return;
    }
    // Firefox makes one range per page when a selection spans pages.
    const active = new Set<HTMLElement>();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const layer of this.#layers.keys()) {
        if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
      }
    }
    for (const [layer, end] of this.#layers) {
      if (active.has(layer)) layer.classList.add("selecting");
      else this.#reset(layer, end);
    }

    this.#keepsSelectionInRuns ??= keepsSelectionInRuns();
    if (this.#keepsSelectionInRuns) return;
    // Move `.endOfContent` next to the end of the selection that is changing,
    // so a jump covers at most the run being dragged over.
    const range = selection.getRangeAt(0);
    const previous = this.#previousRange;
    const modifyStart =
      previous !== null &&
      (range.compareBoundaryPoints(Range.END_TO_END, previous) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, previous) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    if (!modifyStart && range.endOffset === 0) {
      // The selection ends before the anchor's first character: use the
      // closest earlier node that has content.
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor?.previousSibling ?? null;
      } while (anchor && !anchor.hasChildNodes());
    }
    const parent = anchor?.parentElement;
    const layer = parent?.closest(".parapdf-text-layer");
    const end = layer instanceof HTMLElement ? this.#layers.get(layer) : undefined;
    if (anchor && parent && layer instanceof HTMLElement && end) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      end.style.userSelect = "text";
      parent.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
    }
    this.#previousRange = range.cloneRange();
  }
}

interface UserAgentData {
  brands: { brand: string; version: string }[];
}

/** Firefox, and Chromium from version 148, stop a selection at the runs without help. */
function keepsSelectionInRuns(): boolean {
  if (CSS.supports("-moz-user-select", "none")) return true;
  const { userAgentData } = navigator as Navigator & { userAgentData?: UserAgentData };
  const version = userAgentData
    ? userAgentData.brands.find(({ brand }) => brand === "Chromium")?.version
    : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  return version !== undefined && Number.parseInt(version, 10) >= 148;
}
