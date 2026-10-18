/**
 * Keeps a drag selection from jumping across a page. Ported from the
 * selection handling of `TextLayerBuilder` in PDF.js
 * `web/text_layer_builder.js` (pdfjs-dist 6.4.299; Copyright Mozilla
 * Foundation, Apache License 2.0; see NOTICE.md).
 *
 * Every text layer ends with an `.endOfContent` element. While a selection
 * touches a layer, the layer has the `selecting` class, and the viewer CSS
 * stretches that unselectable element over the page so that dragging past
 * the last run does not select from the page's start. Browsers other than
 * Firefox and Chromium 148 or later may instead extend such a selection to
 * wherever `.endOfContent` sits in the DOM (Playwright's WebKit 27.2 did while
 * the element lacked `-webkit-user-select: none`), so in them the element
 * moves next to the run where the selection is changing.
 *
 * Over space without text, WebKit and Firefox put the end of a drag selection
 * at the start of the element under the pointer, where Chromium picks the
 * nearest text: over the space between and beside the pages, the start of the
 * first mounted page; over the blank space of a page above the selection,
 * which the pointer enters from below, that page's start. So in WebKit and
 * Firefox, from a primary-button press in a text layer until the pointer is
 * released, the pages element has the `selecting` class, which makes that
 * space unselectable, and every text layer above the selection has
 * `selecting` and `before-selection`, which make its `.endOfContent`
 * selectable, so its blank space selects up to the page's end. Pages below
 * the selection keep the browser's behaviour, which selects up to their
 * start.
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
  /** In WebKit and Firefox, a drag that started in a tracked text layer is in progress. */
  #dragging = false;
  #previousRange: Range | null = null;
  #quirks: SelectionQuirks | undefined;
  #pages: HTMLElement | null = null;

  /** Binds the element that holds the pages; returns the function that releases it. */
  attachPages(pages: HTMLElement): () => void {
    this.#pages = pages;
    return () => {
      pages.classList.remove("selecting");
      if (this.#pages === pages) this.#pages = null;
    };
  }

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
    this.#endDrag();
    this.#previousRange = null;
  }

  #endDrag(): void {
    this.#dragging = false;
    this.#pages?.classList.remove("selecting");
  }

  #reset(layer: HTMLElement, end: HTMLElement): void {
    layer.append(end);
    end.style.width = "";
    end.style.height = "";
    layer.classList.remove("selecting", "before-selection");
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
      this.#endDrag();
      this.#resetAll();
    };
    document.addEventListener(
      "mousedown",
      (event) => {
        const layer =
          event.target instanceof Element ? event.target.closest(".parapdf-text-layer") : null;
        if (!(layer instanceof HTMLElement) || !this.#layers.has(layer)) return;
        layer.classList.add("selecting");
        this.#quirks ??= selectionQuirks();
        if (event.button === 0 && this.#quirks.endsAtStartOfBlankSpace) {
          this.#dragging = true;
          this.#pages?.classList.add("selecting");
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
    const focus = selection.focusNode;
    for (const [layer, end] of this.#layers) {
      if (active.has(layer)) {
        layer.classList.add("selecting");
        layer.classList.remove("before-selection");
      } else {
        this.#reset(layer, end);
        if (this.#dragging && focus && precedes(layer, focus)) {
          layer.classList.add("selecting", "before-selection");
        }
      }
    }

    this.#quirks ??= selectionQuirks();
    if (this.#quirks.keepsSelectionInRuns) return;
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

/** Whether `layer` comes before `node` in the document and does not contain it. */
const precedes = (layer: Node, node: Node): boolean =>
  (layer.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
  !layer.contains(node);

interface UserAgentData {
  brands: { brand: string; version: string }[];
}

interface SelectionQuirks {
  /** Firefox, and Chromium from version 148, stop a selection at the runs without help. */
  keepsSelectionInRuns: boolean;
  /**
   * WebKit and Firefox end a drag selection over space without text at the
   * start of the element under the pointer; Chromium at the nearest text.
   */
  endsAtStartOfBlankSpace: boolean;
}

function selectionQuirks(): SelectionQuirks {
  const firefox = CSS.supports("-moz-user-select", "none");
  const { userAgentData } = navigator as Navigator & { userAgentData?: UserAgentData };
  const version = userAgentData
    ? userAgentData.brands.find(({ brand }) => brand === "Chromium")?.version
    : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
  const chromium = version === undefined ? undefined : Number.parseInt(version, 10);
  return {
    keepsSelectionInRuns: firefox || (chromium !== undefined && chromium >= 148),
    endsAtStartOfBlankSpace: chromium === undefined,
  };
}
