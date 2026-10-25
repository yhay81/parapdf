"use client";

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
 * Over space without text, browsers end a drag selection at the start of an
 * element rather than at the nearest text. The space between and beside the
 * pages belongs to the pages element: WebKit and Firefox send it to the start
 * of the first mounted page, and Chromium the space beside a page to that
 * page's start. A page's box, rounded to whole pixels, can be a pixel wider
 * and taller than its text layer, which pdf.js rounds down; Chromium and
 * WebKit send that last column and row to the page's start. Over the blank
 * space of a page above the selection, which the pointer enters from below,
 * WebKit and Firefox use that page's start. So during a primary-button drag,
 * until the pointer is released, the pages element has the `selecting` class,
 * which leaves only the text layers in it selectable, and in WebKit and
 * Firefox every text layer above the selection has `selecting` and
 * `before-selection`, which make its `.endOfContent` selectable, so its blank
 * space selects up to the page's end. Pages below the selection keep the
 * browser's behaviour, which selects up to their start.
 *
 * A press on the pages element itself, beside or between the pages, would
 * start the selection at that same wrong place. A drag from there starts at
 * the nearest text instead: beside a page, at the start or end of the run
 * nearest to the press, on the side the press is on; in a gap, at the
 * boundary between the pages. The browser still handles the press, so a click
 * there clears the selection, and the layers are marked for that position at
 * once, because Chromium and Firefox hit-test a pointer move before its
 * listeners run. At the first move, before the browser extends anything, the
 * tracker selects the position as a range between two equivalent DOM
 * positions: Chromium extends a drag from the selection only while it is a
 * range and otherwise restarts it from the pressed point. WebKit restarts the
 * drag at the first text the pointer reaches, so until release the tracker
 * puts the anchor back whenever it moves.
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
  /** A primary-button drag from a tracked text layer or the pages element is in progress. */
  #dragging = false;
  /** Where a drag that started on the pages element itself starts its selection. */
  #anchor: Point | null = null;
  /** The anchor is selected at the first pointer move, after the browser has handled the press. */
  #anchorPending = false;
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
    this.#anchor = null;
    this.#anchorPending = false;
    this.#pages?.classList.remove("selecting");
  }

  #reset(layer: HTMLElement, end: HTMLElement): void {
    this.#putBack(layer, end);
    layer.classList.remove("selecting", "before-selection");
  }

  /** Returns `.endOfContent` to the end of its layer at its own size. */
  #putBack(layer: HTMLElement, end: HTMLElement): void {
    // Re-inserting it in place, as pdf.js does at every selectionchange, leaves
    // it without a box until the next style flush, and Firefox hit-tests a
    // pointer move that comes first against the bare layer: the selection ends
    // at the layer's start, all of the page above for a quick drag into it.
    if (layer.lastChild !== end) layer.append(end);
    end.style.width = "";
    end.style.height = "";
  }

  #resetAll(): void {
    for (const [layer, end] of this.#layers) this.#reset(layer, end);
  }

  #listen(): void {
    if (this.#listeners) return;
    this.#listeners = new AbortController();
    const options = { signal: this.#listeners.signal };
    const release = () => {
      const anchor = this.#anchor;
      const selection = document.getSelection();
      if (anchor && !this.#anchorPending && selection) {
        // WebKit may have restarted the drag at the pointer's last move.
        this.#keepAnchor(selection);
        // A drag that selected nothing leaves no selection, not an empty range.
        if (isAt(selection, anchor) && selection.toString() === "") selection.removeAllRanges();
      }
      this.#pointerDown = false;
      this.#endDrag();
      this.#resetAll();
    };
    document.addEventListener(
      "mousedown",
      (event) => {
        this.#anchor = null;
        this.#anchorPending = false;
        const pages = this.#pages;
        const target = event.target instanceof Element ? event.target : null;
        const layer = target?.closest(".parapdf-text-layer");
        // A touch sends its mouse events after the pointer is up: no drag follows.
        const primary = event.button === 0 && this.#pointerDown;
        if (layer instanceof HTMLElement && this.#layers.has(layer)) {
          layer.classList.add("selecting");
          if (primary) {
            this.#dragging = true;
            pages?.classList.add("selecting");
          }
        } else if (
          primary &&
          pages !== null &&
          target === pages &&
          event.detail <= 1 &&
          !(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)
        ) {
          const anchor = this.#nearestPoint(pages, event.clientX, event.clientY);
          this.#anchor = anchor;
          this.#anchorPending = true;
          this.#dragging = true;
          // Mark the layers for the anchor now: Chromium and Firefox hit-test
          // the first move before its listeners run.
          const at = document.createRange();
          at.setStart(anchor.node, anchor.offset);
          this.#mark([at], anchor);
        }
      },
      options,
    );
    document.addEventListener(
      "pointerdown",
      () => {
        this.#pointerDown = true;
        // The mouse press that follows decides whether there is an anchor.
        this.#anchor = null;
        this.#anchorPending = false;
      },
      options,
    );
    // Capture, so the anchor is in place before the browser handles the move.
    document.addEventListener("pointermove", (event) => this.#onPointerMove(event), {
      ...options,
      capture: true,
    });
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

  #onPointerMove(event: PointerEvent): void {
    const anchor = this.#anchor;
    if (!anchor) return;
    if ((event.buttons & 1) === 0) {
      // The release went unseen.
      this.#endDrag();
      return;
    }
    const selection = document.getSelection();
    if (!selection || !anchor.node.isConnected) {
      // The page that held the anchor was unmounted.
      this.#anchor = null;
      return;
    }
    if (this.#anchorPending) {
      this.#anchorPending = false;
      // Only now: an unselectable target would not have started a selection.
      this.#pages?.classList.add("selecting");
      selectAt(selection, anchor);
    } else if (selection.rangeCount === 0 || (isAt(selection, anchor) && !selection.isCollapsed)) {
      return;
    } else {
      this.#keepAnchor(selection);
    }
    // Mark the layers before the browser hit-tests again; selectionchange comes later.
    this.#onSelectionChange();
  }

  /** Puts the anchor of a drag from the pages element back where it started. */
  #keepAnchor(selection: Selection): void {
    const anchor = this.#anchor;
    if (!anchor || selection.rangeCount === 0) return;
    const { focusNode, focusOffset } = selection;
    if (isAt(selection, anchor) || !focusNode) {
      if (selection.isCollapsed) selectAt(selection, anchor);
    } else {
      selection.setBaseAndExtent(anchor.node, anchor.offset, focusNode, focusOffset);
    }
  }

  /**
   * Gives the layers that `ranges` touch the `selecting` class and, in WebKit
   * and Firefox during a drag, the layers that end before `focus` the
   * `selecting` and `before-selection` classes; resets every other layer.
   */
  #mark(ranges: readonly Range[], focus: Point | null): void {
    this.#quirks ??= selectionQuirks();
    // Firefox makes one range per page when a selection spans pages.
    const active = new Set<HTMLElement>();
    for (const range of ranges) {
      for (const layer of this.#layers.keys()) {
        if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
      }
    }
    let above: Range | null = null;
    if (focus && this.#dragging && this.#quirks.endsAtStartOfBlankSpace) {
      above = document.createRange();
      above.setStart(focus.node, focus.offset);
    }
    for (const [layer, end] of this.#layers) {
      if (active.has(layer)) {
        layer.classList.add("selecting");
        layer.classList.remove("before-selection");
      } else if (above && above.comparePoint(layer, layer.childNodes.length) < 0) {
        this.#putBack(layer, end);
        layer.classList.add("selecting", "before-selection");
      } else {
        this.#reset(layer, end);
      }
    }
  }

  /**
   * Where a press at (x, y) on the pages element starts a selection: beside a
   * page, the start or end of the nearest run of its text layer, on the side
   * the press is on; elsewhere, the boundary between the pages around it.
   * The nearest page is the nearest above or below first, then sideways.
   */
  #nearestPoint(pages: HTMLElement, x: number, y: number): Point {
    const children = pages.childNodes;
    const boxes: (DOMRect | null)[] = [];
    let nearest = -1;
    let nearestDy = Number.POSITIVE_INFINITY;
    let nearestDx = Number.POSITIVE_INFINITY;
    for (let index = 0; index < children.length; index++) {
      const page = children[index];
      // "page" mode hides the pages beside the ones it shows.
      if (!(page instanceof HTMLElement) || page.style.visibility === "hidden") {
        boxes.push(null);
        continue;
      }
      const box = page.getBoundingClientRect();
      boxes.push(box);
      const dy = Math.max(box.top - y, y - box.bottom, 0);
      const dx = Math.max(box.left - x, x - box.right, 0);
      if (dy < nearestDy || (dy === nearestDy && dx < nearestDx)) {
        nearest = index;
        nearestDy = dy;
        nearestDx = dx;
      }
    }
    const box = boxes[nearest];
    if (!box) return { node: pages, offset: children.length };
    if (y < box.top) return { node: pages, offset: nearest };
    if (y > box.bottom) return { node: pages, offset: nearest + 1 };
    // Between that page and another beside it, the boundary between them.
    const other = boxes.findIndex(
      (beside, index) =>
        beside !== null &&
        index !== nearest &&
        y >= beside.top &&
        y <= beside.bottom &&
        (x < box.left ? beside.right <= x : beside.left >= x),
    );
    if (other !== -1) return { node: pages, offset: Math.max(nearest, other) };
    const layer = (children[nearest] as HTMLElement).querySelector(".parapdf-text-layer");
    const run =
      layer instanceof HTMLElement && this.#layers.has(layer) ? nearestRun(layer, x, y) : null;
    return run ?? { node: pages, offset: nearest };
  }

  #onSelectionChange(): void {
    // The browser's caret for a press beside the pages gives way at the first move.
    if (this.#anchorPending) return;
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.#resetAll();
      return;
    }
    const ranges: Range[] = [];
    for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
    const { focusNode, focusOffset } = selection;
    this.#mark(ranges, focusNode ? { node: focusNode, offset: focusOffset } : null);

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

/** A boundary point: a node and an offset in it. */
interface Point {
  node: Node;
  offset: number;
}

/** The start or end of the run in `layer` nearest to (x, y), rows first, on the side of x. */
function nearestRun(layer: HTMLElement, x: number, y: number): Point | null {
  let nearest: { text: Text; box: DOMRect } | null = null;
  let nearestDy = Number.POSITIVE_INFINITY;
  let nearestDx = Number.POSITIVE_INFINITY;
  for (const span of layer.getElementsByTagName("span")) {
    const text = span.firstChild;
    if (!(text instanceof Text) || !/\S/.test(text.data)) continue;
    const box = span.getBoundingClientRect();
    const dy = Math.max(box.top - y, y - box.bottom, 0);
    const dx = Math.max(box.left - x, x - box.right, 0);
    if (dy < nearestDy || (dy === nearestDy && dx < nearestDx)) {
      nearest = { text, box };
      nearestDy = dy;
      nearestDx = dx;
    }
  }
  if (!nearest) return null;
  const { text, box } = nearest;
  return { node: text, offset: x < (box.left + box.right) / 2 ? 0 : text.length };
}

/**
 * Selects `point` as a range to another DOM position at the same place:
 * nothing is selected, but Chromium extends a drag from it.
 */
function selectAt(selection: Selection, point: Point): void {
  const { node, offset } = point;
  let other: Point = point;
  if (node instanceof Text) {
    const parent = node.parentNode;
    const index = parent ? Array.prototype.indexOf.call(parent.childNodes, node) : -1;
    if (parent && index >= 0) other = { node: parent, offset: offset === 0 ? index : index + 1 };
  } else {
    const after = node.childNodes[offset];
    const before = node.childNodes[offset - 1];
    if (after) other = { node: after, offset: 0 };
    else if (before) other = { node: before, offset: before.childNodes.length };
  }
  selection.setBaseAndExtent(node, offset, other.node, other.offset);
}

const isAt = (selection: Selection, point: Point): boolean =>
  selection.anchorNode === point.node && selection.anchorOffset === point.offset;

interface UserAgentData {
  brands: { brand: string; version: string }[];
}

interface SelectionQuirks {
  /** Firefox, and Chromium from version 148, stop a selection at the runs without help. */
  keepsSelectionInRuns: boolean;
  /**
   * WebKit and Firefox end a drag selection over a page's blank space at the
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
