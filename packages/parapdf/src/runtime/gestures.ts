import type { AnnotationTool } from "../pdfjs/editor.ts";
import { type Layout, type ScrollMode, type Viewport, zoomTarget } from "./layout.ts";
import {
  type Edges,
  type Motion,
  positionOf,
  scrollEdges,
  sizeOf,
  viewportOf,
} from "./scrolling.ts";

/** A ctrl/pinch wheel gesture or a Safari gesture commits this long after its last event. */
const ZOOM_COMMIT_DELAY = 150;
/**
 * Two touches start zooming once the distance between them changed by this
 * many CSS pixels, and only pan before: otherwise the jitter of a two-finger
 * drag or tap changed the zoom by a fraction and rendered every page again.
 */
const PINCH_SLOP = 16;
/** Safari's events for trackpad pinches, which iPadOS also sends for touch pinches. */
const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;
/** A one-finger swipe flips pages in "page" mode once it moved this many CSS pixels. */
const SWIPE_DISTANCE = 50;
/** …and stayed within this angle of an axis. */
const SWIPE_ANGLE = Math.PI / 6;
/** How long a flip by swipe holds the fling the swipe left behind (see `#stopFling()`). */
const FLING_STOP = 1000;
/** What the reader does that ends that hold at once. */
const FLING_ENDS = ["touchstart", "pointerdown", "wheel", "keydown"] as const;
/** Elements whose keys and touches belong to them rather than to page flipping. */
export const CONTROLS = "input, select, textarea, button, [contenteditable], .parapdf-editor-layer";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A zoom gesture in progress: the wheel with ctrl or meta (also trackpad
 * pinches in Chromium and Firefox), two touches, or Safari's gesture events.
 * A CSS transform previews it until it commits.
 */
interface ZoomGesture {
  source: "wheel" | "touch" | "gesture";
  /** Zoom relative to the committed scale. */
  factor: number;
  /** The point the gesture zooms around, in the content's unscaled CSS pixels. */
  originX: number;
  originY: number;
  /** How far a two-finger drag moved that point on screen. */
  panX: number;
  panY: number;
  /** What the preview adds to the pan to show the content where the commit puts it. */
  shiftX: number;
  shiftY: number;
  /**
   * How the content the preview shows moves. It is kept apart from
   * scrolling's: a zoom's commit jumps to another scroll position, which,
   * measured against the preview's last move, would look like a fling.
   */
  motion: Motion;
  /** Pending commit of a wheel or Safari gesture. */
  timer: number;
}

/** Two touches on the viewport, zooming around their midpoint and panning with it. */
interface Pinch {
  ids: readonly [number, number];
  zoom: ZoomGesture;
  /** Midpoint of the touches when the pinch started, in client coordinates. */
  startX: number;
  startY: number;
  startDistance: number;
  /** The distance the zoom is relative to, from when the touches moved past PINCH_SLOP; 0 before. */
  baseDistance: number;
  /** Whether the touches moved since they were last read (see readTouches). */
  moved: boolean;
}

/** Safari's GestureEvent, which TypeScript's DOM library does not declare. */
interface SafariGestureEvent extends UIEvent {
  /** The distance between the touches, or the trackpad's magnification, relative to the start. */
  readonly scale: number;
  /** The pointer's position on macOS, the midpoint of the touches on iPadOS. */
  readonly clientX?: number;
  readonly clientY?: number;
}

/** What gestures need from the viewer. */
export interface GestureHost {
  /** The scroll container and its sized content, while a viewport is attached. */
  scroller(): HTMLElement | null;
  content(): HTMLElement | null;
  state(): {
    layout: Layout | null;
    scale: number;
    scrollMode: ScrollMode;
    annotationTool: AnnotationTool;
  };
  minScale(): number;
  maxScale(): number;
  /** The pages laid out at `scale` as they are laid out now, without applying it. */
  layoutAt(scale: number): Layout;
  /**
   * Commit a gesture's zoom: `scale`, with the content point `point` under
   * `anchor` (viewport coordinates).
   */
  zoomTo(scale: number, anchor: { x: number; y: number }, point: { x: number; y: number }): void;
  /** Flip to the next or previous row from the edge crossed along `axis`; whether it did. */
  flip(direction: 1 | -1, axis: "x" | "y"): boolean;
  /** Update the mounted window and the scheduler at the next animation frame. */
  requestUpdate(): void;
}

/**
 * The viewport's gestures: zooming with the ctrl or meta wheel, two-touch
 * pinches, and Safari's gesture events, previewed with a CSS transform until
 * they commit, and in "page" mode one-finger swipes that flip pages.
 */
export class ViewerGestures {
  readonly #host: GestureHost;
  #zoom: ZoomGesture | null = null;
  /** Touch pointers down on the viewport, in client coordinates. */
  readonly #touches = new Map<number, { x: number; y: number }>();
  #pinch: Pinch | null = null;
  /**
   * A one-finger touch in "page" mode that may flip pages: where it went
   * down, which edges the page shown was scrolled to then, and the text
   * selected then.
   */
  #swipe: { id: number; x: number; y: number; edges: Edges; selection: string } | null = null;
  /** Gives the scroller its overflow back after a flip stopped a fling; null without one. */
  #flingStop: (() => void) | null = null;
  /** Removes the window listeners that follow the touches down on the viewport. */
  #touchListeners: AbortController | null = null;
  /** The scale of Safari's gesture in progress at its latest event; null without one. */
  #gestureScale: number | null = null;
  /** The gesture scale at which a gesture zoom's factor is 1. */
  #gestureBase = 1;

  constructor(host: GestureHost) {
    this.#host = host;
  }

  /** Listen to `scroller`'s gestures; returns the function that stops. */
  attach(scroller: HTMLElement): () => void {
    scroller.addEventListener("wheel", this.#onWheel, { passive: false });
    scroller.addEventListener("pointerdown", this.#onPointerDown, { passive: true });
    // Touch events, not pointer events: browsers cancel a touch's pointer
    // once they pan, even with nothing to scroll, but go on reporting its touches.
    scroller.addEventListener("touchstart", this.#onSwipeStart, { passive: true });
    scroller.addEventListener("touchend", this.#onSwipeEnd, { passive: true });
    scroller.addEventListener("touchcancel", this.#onSwipeEnd, { passive: true });
    // Not passive: Safari zooms the whole page unless they are prevented.
    for (const type of GESTURE_EVENTS) {
      scroller.addEventListener(type, this.#onGesture, { passive: false });
    }
    return () => {
      scroller.removeEventListener("wheel", this.#onWheel);
      scroller.removeEventListener("pointerdown", this.#onPointerDown);
      scroller.removeEventListener("touchstart", this.#onSwipeStart);
      scroller.removeEventListener("touchend", this.#onSwipeEnd);
      scroller.removeEventListener("touchcancel", this.#onSwipeEnd);
      this.#swipe = null;
      this.#flingStop?.();
      for (const type of GESTURE_EVENTS) scroller.removeEventListener(type, this.#onGesture);
    };
  }

  /** How the content a zoom preview shows moves; null without a preview. */
  get motion(): Motion | null {
    return this.#zoom?.motion ?? null;
  }

  #edges(): Edges | null {
    const scroller = this.#host.scroller();
    return scroller ? scrollEdges(scroller) : null;
  }

  /**
   * A finger down in "page" mode may swipe to the next or previous page.
   * A second finger, a tool that draws, and form fields keep their touches.
   */
  #onSwipeStart = (event: TouchEvent): void => {
    this.#swipe = null;
    const touch = event.changedTouches[0];
    const { scrollMode, annotationTool } = this.#host.state();
    if (event.touches.length !== 1 || !touch || scrollMode !== "page") return;
    if (annotationTool !== "none") return;
    const target = event.target instanceof Element ? event.target : null;
    const edges = target?.closest(CONTROLS) ? null : this.#edges();
    if (!edges) return;
    this.#swipe = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      edges,
      selection: document.getSelection()?.toString() ?? "",
    };
  };

  /**
   * A swipe of SWIPE_DISTANCE along an axis flips pages in "page" mode,
   * like turning paper: to the left or up for the next row, the other way
   * for the previous one, which shows from the edge the swipe crossed. It
   * flips only past an edge the page shown was already scrolled to when the
   * finger went down and still is: within a zoomed page, a swipe scrolls,
   * and the next swipe from the edge flips. Pinches and selections by long
   * press do not flip.
   */
  #onSwipeEnd = (event: TouchEvent): void => {
    const swipe = this.#swipe;
    if (!swipe || event.touches.length > 0) return;
    this.#swipe = null;
    const touch = [...event.changedTouches].find(({ identifier }) => identifier === swipe.id);
    if (!touch || event.type === "touchcancel" || this.#zoom) return;
    if ((document.getSelection()?.toString() ?? "") !== swipe.selection) return;
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const along = horizontal ? dx : dy;
    const across = horizontal ? dy : dx;
    if (Math.abs(along) < SWIPE_DISTANCE) return;
    if (Math.abs(across) > Math.abs(along) * Math.tan(SWIPE_ANGLE)) return;
    const edges = this.#edges();
    if (!edges) return;
    const next = along < 0;
    const edge = horizontal ? (next ? "atRight" : "atLeft") : next ? "atBottom" : "atTop";
    if (!swipe.edges[edge] || !edges[edge]) return;
    if (this.#host.flip(next ? 1 : -1, horizontal ? "x" : "y")) this.#stopFling();
  };

  /**
   * Stop the fling a swipe left behind, which would otherwise scroll the
   * page a flip showed: Chromium scrolled a zoomed page flipped to its top
   * 102 CSS pixels down. Taking the scroller's overflow away stops it, for
   * FLING_STOP ms or until the reader touches, presses, turns the wheel, or
   * presses a key, which then scroll as before: Chromium's fling went on
   * once the overflow was back, after a frame and still after 300 ms, by 5
   * pixels. The stable scrollbar gutter keeps the layout as it is.
   */
  #stopFling(): void {
    const scroller = this.#host.scroller();
    if (!scroller || this.#flingStop) return;
    const { scrollLeft, scrollTop } = scroller;
    const overflow = scroller.style.overflow;
    scroller.style.overflow = "hidden";
    const restore = () => {
      if (this.#flingStop !== restore) return;
      this.#flingStop = null;
      clearTimeout(timer);
      for (const type of FLING_ENDS) scroller.removeEventListener(type, restore, { capture: true });
      scroller.style.overflow = overflow;
      scroller.scrollTo(scrollLeft, scrollTop);
    };
    const timer = setTimeout(restore, FLING_STOP);
    for (const type of FLING_ENDS)
      scroller.addEventListener(type, restore, { capture: true, passive: true });
    this.#flingStop = restore;
  }

  #onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const zoom =
      this.#zoom?.source === "wheel"
        ? this.#zoom
        : this.#startZoom("wheel", event.clientX, event.clientY);
    if (!zoom) return;
    zoom.factor = this.#zoomFactor(zoom.factor * Math.exp(-event.deltaY * 0.01));
    this.#previewZoom(zoom);
    clearTimeout(zoom.timer);
    zoom.timer = window.setTimeout(this.#commitZoom, ZOOM_COMMIT_DELAY);
  };

  /**
   * Touches pinch through pointer events. The viewport's `touch-action:
   * pan-x pan-y` keeps the browser from zooming the page instead; Chromium
   * then does not scroll with two fingers either, so it does not cancel
   * their pointers, and a two-finger drag pans through the pinch.
   */
  #onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    this.#touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!this.#touchListeners) {
      // On the window, so that a finger is followed after it leaves the
      // viewport or the element it went down on is removed.
      this.#touchListeners = new AbortController();
      const options = { capture: true, passive: true, signal: this.#touchListeners.signal };
      window.addEventListener("pointermove", this.#onTouchMove, options);
      window.addEventListener("pointerup", this.#onTouchEnd, options);
      window.addEventListener("pointercancel", this.#onTouchEnd, options);
    }
    if (!this.#pinch && this.#touches.size >= 2) this.#startPinch();
  };

  #onTouchMove = (event: PointerEvent): void => {
    const touch = this.#touches.get(event.pointerId);
    if (!touch) return;
    touch.x = event.clientX;
    touch.y = event.clientY;
    const pinch = this.#pinch;
    if (!pinch?.ids.includes(event.pointerId)) return;
    // Read at the next frame, once the other touch's move has arrived too.
    pinch.moved = true;
    this.#host.requestUpdate();
  };

  /**
   * Pan the pinch's preview with the midpoint of its touches, and zoom it
   * once their distance changed by PINCH_SLOP. The viewer calls this once a
   * frame, after all of their moves arrived, and it runs before the pinch
   * commits: browsers deliver the moves of two fingers one after the other,
   * so at each move the distance measured the moved finger against where
   * the other was a frame before. A two-finger drag then zoomed once one
   * frame's movement changed that by PINCH_SLOP: at 17 CSS pixels a frame
   * with one finger above the other, and at 100 with the fingers side by
   * side and 300 apart, where a flick of 150 a frame committed a zoom of 0.894.
   */
  readTouches(): void {
    const pinch = this.#pinch;
    if (!pinch?.moved) return;
    pinch.moved = false;
    if (this.#zoom !== pinch.zoom) {
      // Something else committed the preview, a resize for one: pinch on from here.
      this.#startPinch();
      return;
    }
    const a = this.#touches.get(pinch.ids[0]);
    const b = this.#touches.get(pinch.ids[1]);
    if (!a || !b) return;
    const zoom = pinch.zoom;
    zoom.panX = (a.x + b.x) / 2 - pinch.startX;
    zoom.panY = (a.y + b.y) / 2 - pinch.startY;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (
      pinch.baseDistance === 0 &&
      distance > 0 &&
      Math.abs(distance - pinch.startDistance) >= PINCH_SLOP
    ) {
      pinch.baseDistance = distance;
    }
    if (pinch.baseDistance > 0) zoom.factor = this.#zoomFactor(distance / pinch.baseDistance);
    this.#previewZoom(zoom);
  }

  #onTouchEnd = (event: PointerEvent): void => {
    if (!this.#touches.has(event.pointerId)) return;
    // Moves that no frame has read yet came before the lift.
    if (this.#pinch?.ids.includes(event.pointerId)) this.readTouches();
    this.#touches.delete(event.pointerId);
    if (this.#touches.size === 0) {
      this.#touchListeners?.abort();
      this.#touchListeners = null;
    }
    const pinch = this.#pinch;
    if (!pinch?.ids.includes(event.pointerId)) return;
    this.#pinch = null;
    const zoom = pinch.zoom;
    if (this.#zoom === zoom) {
      if (event.type === "pointercancel" && this.#gestureScale !== null) {
        // Safari took the touches over, for a pan of its own perhaps, and
        // still reports the pinch through gesture events: they finish it.
        zoom.source = "gesture";
        this.#gestureBase = this.#gestureScale / zoom.factor;
        zoom.timer = window.setTimeout(this.#commitZoom, ZOOM_COMMIT_DELAY);
      } else {
        this.#commitZoom();
      }
    }
    // Two fingers still down go on pinching.
    if (this.#touches.size >= 2) this.#startPinch();
  };

  /** Start pinching with the first two touches down on the viewport. */
  #startPinch(): void {
    this.#pinch = null;
    const [first, second] = this.#touches;
    if (!first || !second) return;
    const [[firstId, a], [secondId, b]] = [first, second];
    const startX = (a.x + b.x) / 2;
    const startY = (a.y + b.y) / 2;
    const zoom = this.#startZoom("touch", startX, startY);
    if (!zoom) return;
    this.#pinch = {
      ids: [firstId, secondId],
      zoom,
      startX,
      startY,
      startDistance: Math.hypot(b.x - a.x, b.y - a.y),
      baseDistance: 0,
      moved: false,
    };
  }

  /**
   * Safari's gesture events: trackpad pinches on macOS, where they are the
   * only report of the pinch, and touch pinches on iPadOS, which pointer
   * events report too. Preventing them is what stops Safari's page zoom.
   */
  #onGesture = (event: Event): void => {
    event.preventDefault();
    const { type, scale, clientX, clientY } = event as SafariGestureEvent;
    if (type === "gestureend") this.#gestureScale = null;
    else if (scale > 0) this.#gestureScale = scale;
    if (this.#pinch || !(scale > 0)) return;
    let zoom = this.#zoom;
    if (zoom?.source !== "gesture") {
      const scroller = this.#host.scroller();
      if (type === "gestureend" || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      zoom = this.#startZoom(
        "gesture",
        clientX ?? rect.left + rect.width / 2,
        clientY ?? rect.top + rect.height / 2,
      );
      if (!zoom) return;
      this.#gestureBase = scale;
    }
    zoom.factor = this.#zoomFactor(scale / this.#gestureBase);
    this.#previewZoom(zoom);
    clearTimeout(zoom.timer);
    if (type === "gestureend") this.#commitZoom();
    else zoom.timer = window.setTimeout(this.#commitZoom, ZOOM_COMMIT_DELAY);
  };

  /**
   * Start previewing a zoom gesture around a point in client coordinates.
   * Another gesture still in progress commits first.
   */
  #startZoom(source: ZoomGesture["source"], clientX: number, clientY: number): ZoomGesture | null {
    if (this.#zoom) this.#commitZoom();
    const scroller = this.#host.scroller();
    if (!scroller || !this.#host.content() || !this.#host.state().layout) return null;
    const rect = scroller.getBoundingClientRect();
    this.#zoom = {
      source,
      factor: 1,
      originX: scroller.scrollLeft + clientX - rect.left - scroller.clientLeft,
      originY: scroller.scrollTop + clientY - rect.top - scroller.clientTop,
      panX: 0,
      panY: 0,
      shiftX: 0,
      shiftY: 0,
      motion: {
        position: positionOf(this.#host.state().scrollMode, viewportOf(scroller)),
        at: performance.now(),
        velocity: 0,
      },
      timer: 0,
    };
    return this.#zoom;
  }

  /** A gesture's zoom factor, kept within the scale limits. */
  #zoomFactor(factor: number): number {
    const scale = this.#host.state().scale;
    return clamp(factor, this.#host.minScale() / scale, this.#host.maxScale() / scale);
  }

  /**
   * Preview a gesture on the compositor; layout waits for the commit, but the
   * pages the preview brings into view mount and draw at the committed zoom
   * before it (see shownViewport). The preview shows the content where the
   * commit will put it: the gesture's point stays under it unless that would
   * scroll past the start or end of the document, or a page the zoom narrows
   * below the viewport's width is centered again. Previewing the
   * unconstrained place made the content jump when the gesture committed, by
   * 334 CSS pixels on an iPad pinching in near the document's start.
   */
  #previewZoom(zoom: ZoomGesture): void {
    const content = this.#host.content();
    const scroller = this.#host.scroller();
    const layout = this.#host.state().layout;
    if (!content || !scroller || !layout) return;
    const left = scroller.scrollLeft;
    const top = scroller.scrollTop;
    // The scroll position the commit asks for, and the one it gets.
    let next = layout;
    let target = { left: left - zoom.panX, top: top - zoom.panY };
    const scale = layout.scale * zoom.factor;
    if (Math.abs(scale - layout.scale) >= 1e-4) {
      next = this.#host.layoutAt(scale);
      target = zoomTarget(
        layout,
        next,
        sizeOf(scroller),
        { x: zoom.originX + zoom.panX - left, y: zoom.originY + zoom.panY - top },
        { x: zoom.originX, y: zoom.originY },
      );
    }
    const maxLeft = Math.max(0, next.totalWidth - scroller.clientWidth);
    const maxTop = Math.max(0, next.totalHeight - scroller.clientHeight);
    zoom.shiftX = target.left - clamp(target.left, 0, maxLeft);
    zoom.shiftY = target.top - clamp(target.top, 0, maxTop);
    content.style.transformOrigin = `${zoom.originX}px ${zoom.originY}px`;
    content.style.transform = `translate(${zoom.panX + zoom.shiftX}px, ${zoom.panY + zoom.shiftY}px) scale(${zoom.factor})`;
    this.#host.requestUpdate();
  }

  /** Whether a gesture in progress previews another zoom, not just a pan. */
  zooming(): boolean {
    const zoom = this.#zoom;
    const scale = this.#host.state().scale;
    return zoom !== null && Math.abs(scale * zoom.factor - scale) >= 1e-4;
  }

  /**
   * The part of the content the viewport shows, in the content's CSS pixels.
   * A gesture's preview shows another part than the scroll position: its
   * transform draws the content point p at origin + (p - origin) * factor +
   * pan + shift, so the viewport maps back through the inverse. The mounted
   * window and the scheduler follow it, so the pages a long two-finger drag
   * or a zoom out brings into view mount and draw before the gesture commits.
   */
  shownViewport(scroller: HTMLElement): Viewport {
    const viewport = viewportOf(scroller);
    const zoom = this.#zoom;
    if (!zoom) return viewport;
    const { originX, originY, factor } = zoom;
    return {
      left: originX + (viewport.left - zoom.panX - zoom.shiftX - originX) / factor,
      top: originY + (viewport.top - zoom.panY - zoom.shiftY - originY) / factor,
      width: viewport.width / factor,
      height: viewport.height / factor,
      scrollerWidth: viewport.scrollerWidth,
      scrollerHeight: viewport.scrollerHeight,
    };
  }

  #commitZoom = (): void => {
    // A pinch commits with the moves of its touches that no frame read yet.
    if (this.#zoom && this.#pinch?.zoom === this.#zoom) this.readTouches();
    const zoom = this.#zoom;
    this.#zoom = null;
    if (!zoom) return;
    clearTimeout(zoom.timer);
    const scroller = this.#host.scroller();
    const content = this.#host.content();
    if (!scroller || !content) return;
    // Where the gesture's point shows, read while the preview still scales
    // the content: the viewport may have scrolled past the unscaled end.
    const left = scroller.scrollLeft;
    const top = scroller.scrollTop;
    content.style.transform = "";
    const scale = this.#host.state().scale;
    if (Math.abs(scale * zoom.factor - scale) < 1e-4) {
      // A two-finger drag that never pinched only scrolls.
      scroller.scrollLeft = left - zoom.panX;
      scroller.scrollTop = top - zoom.panY;
      return;
    }
    this.#host.zoomTo(
      scale * zoom.factor,
      { x: zoom.originX + zoom.panX - left, y: zoom.originY + zoom.panY - top },
      { x: zoom.originX, y: zoom.originY },
    );
  };

  /** Commit a gesture in progress before something else changes the layout under its preview. */
  finish(): void {
    if (this.#zoom) this.#commitZoom();
  }

  /** Forget a gesture without committing it: its viewport goes away. */
  drop(): void {
    if (this.#zoom) clearTimeout(this.#zoom.timer);
    this.#zoom = null;
    this.#pinch = null;
    this.#touches.clear();
    this.#touchListeners?.abort();
    this.#touchListeners = null;
    this.#gestureScale = null;
    const content = this.#host.content();
    if (content) content.style.transform = "";
  }
}
