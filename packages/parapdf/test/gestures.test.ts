import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { type GestureHost, ViewerGestures } from "../src/view/gestures.ts";
import { computeLayout, type Direction, type ScrollMode } from "../src/view/layout.ts";

/** An element: touches on one that is a control stay its own. */
class FakeElement extends EventTarget {
  control = false;
  closest(): FakeElement | null {
    return this.control ? this : null;
  }
}
globalThis.Element = FakeElement as unknown as typeof Element;

/** The window, which follows the touches, new for each test, and the text selected. */
const windowOf = () =>
  Object.assign(new EventTarget(), {
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
  });
let fakeWindow = windowOf();
let selected = "";
Object.assign(globalThis, { document: { getSelection: () => ({ toString: () => selected }) } });

/** A scroller placed at (100, 50) in the window, which clamps its scroll position. */
class FakeScroller extends FakeElement {
  clientWidth = 1000;
  clientHeight = 800;
  offsetWidth = 1000;
  clientLeft = 0;
  clientTop = 0;
  scrollWidth = 1000;
  scrollHeight = 800;
  readonly style = { overflow: "" };
  #left = 0;
  #top = 0;
  get scrollLeft(): number {
    return this.#left;
  }
  set scrollLeft(left: number) {
    this.#left = Math.min(Math.max(0, left), this.scrollWidth - this.clientWidth);
  }
  get scrollTop(): number {
    return this.#top;
  }
  set scrollTop(top: number) {
    this.#top = Math.min(Math.max(0, top), this.scrollHeight - this.clientHeight);
  }
  scrollTo(left: number, top: number): void {
    this.scrollLeft = left;
    this.scrollTop = top;
  }
  getBoundingClientRect() {
    return { left: 100, top: 50, width: this.clientWidth, height: this.clientHeight };
  }
}

const LETTER = { width: 612, height: 792 };

function setUp(
  options: { scrollMode?: ScrollMode; direction?: Direction; scale?: number; pages?: number } = {},
) {
  const { scrollMode = "vertical", direction = "ltr", scale = 1, pages = 5 } = options;
  const sizes = Array.from({ length: pages }, () => LETTER);
  const layoutAt = (at: number) => computeLayout(sizes, at, { gap: 10, scrollMode, direction });
  const state = { layout: layoutAt(scale), scale, scrollMode, direction };
  const scroller = new FakeScroller();
  scroller.scrollWidth = Math.max(1000, state.layout.totalWidth);
  scroller.scrollHeight = Math.max(800, state.layout.totalHeight);
  const content = { style: { transform: "", transformOrigin: "" } };
  const zooms: {
    scale: number;
    anchor: { x: number; y: number };
    point: { x: number; y: number };
  }[] = [];
  const flips: string[] = [];
  const host = {
    flipped: true,
    claimed: false,
    updates: 0,
  };
  const gestureHost: GestureHost = {
    scroller: () => scroller as unknown as HTMLElement,
    content: () => content as unknown as HTMLElement,
    state: () => state,
    pointerClaimed: () => host.claimed,
    minScale: () => 0.25,
    maxScale: () => 10,
    layoutAt,
    zoomTo: (at, anchor, point) => zooms.push({ scale: at, anchor, point }),
    flip: (to, axis) => {
      flips.push(`${to} ${axis}`);
      return host.flipped;
    },
    requestUpdate: () => void host.updates++,
  };
  const gestures = new ViewerGestures(gestureHost);
  const detach = gestures.attach(scroller as unknown as HTMLElement);
  return { scroller, content, state, zooms, flips, host, gestures, detach };
}

/** Dispatch a cancelable event of `type` with `fields`; whether it was not prevented. */
const fire = (target: EventTarget, type: string, fields: object = {}) =>
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), fields));

const wheel = (scroller: EventTarget, deltaY: number, x = 600, y = 450) =>
  fire(scroller, "wheel", { ctrlKey: true, metaKey: false, deltaY, clientX: x, clientY: y });

/** A touch pointer's event: down on the scroller, the others on the window. */
const pointer = (type: string, pointerId: number, x: number, y: number) =>
  fire(type === "pointerdown" ? currentScroller : fakeWindow, type, {
    pointerType: "touch",
    pointerId,
    clientX: x,
    clientY: y,
  });
let currentScroller: EventTarget = new EventTarget();

/** The translation, scale, and origin the preview's transform holds. */
function previewOf(content: { style: { transform: string; transformOrigin: string } }) {
  const [x = 0, y = 0, factor = 1] = (
    content.style.transform.match(/-?[\d.e+-]+(?=px|\))/g) ?? []
  ).map(Number);
  const [originX = 0, originY = 0] = content.style.transformOrigin.split(" ").map(parseFloat);
  return { x, y, factor, originX, originY };
}

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fakeWindow = windowOf();
  Object.assign(globalThis, { window: fakeWindow });
  selected = "";
});

afterEach(() => {
  mock.timers.reset();
});

describe("wheel zoom", () => {
  it("previews a ctrl or ⌘ wheel zoom around the pointer and commits it once the wheel stops", () => {
    const { scroller, content, zooms } = setUp();
    assert.equal(wheel(scroller, -50), false);
    assert.equal(wheel(scroller, -50, 700, 500), false);
    assert.equal(content.style.transformOrigin, "500px 400px");
    close(previewOf(content).factor, Math.E);
    mock.timers.tick(149);
    assert.equal(zooms.length, 0);
    mock.timers.tick(1);
    assert.equal(content.style.transform, "");
    assert.equal(zooms.length, 1);
    close(zooms[0]?.scale ?? 0, Math.E);
    // The point it started at stays where it was in the viewport.
    assert.deepEqual(
      [zooms[0]?.anchor, zooms[0]?.point],
      [
        { x: 500, y: 400 },
        { x: 500, y: 400 },
      ],
    );
  });

  it("leaves the wheel without ctrl or ⌘ to scrolling", () => {
    const { scroller, content } = setUp();
    assert.equal(fire(scroller, "wheel", { deltaY: -100, clientX: 600, clientY: 450 }), true);
    assert.equal(content.style.transform, "");
  });

  it("keeps a wheel zoom within the scale limits", () => {
    const { scroller, zooms } = setUp({ scale: 2 });
    wheel(scroller, 10_000);
    mock.timers.tick(150);
    wheel(scroller, -10_000);
    mock.timers.tick(150);
    assert.deepEqual(
      zooms.map(({ scale }) => scale),
      [0.25, 10],
    );
  });

  it("is not zooming until the zoom differs from the scale", () => {
    const { scroller, gestures } = setUp();
    wheel(scroller, 0);
    assert.equal(gestures.zooming(), false);
    assert.notEqual(gestures.motion, null);
    wheel(scroller, -1);
    assert.equal(gestures.zooming(), true);
  });
});

describe("pinch zoom", () => {
  /** Two fingers 200 CSS pixels apart around (400, 300) in the window. */
  const pinching = (options?: Parameters<typeof setUp>[0]) => {
    const set = setUp(options);
    currentScroller = set.scroller;
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    return set;
  };

  it("pans with the fingers and zooms once their distance changed by the slop", () => {
    const { content, gestures, zooms, host } = pinching();
    pointer("pointermove", 1, 300, 270);
    pointer("pointermove", 2, 515, 270);
    // The moves wait for the frame they asked for, which reads both.
    assert.equal(content.style.transform, "");
    assert.ok(host.updates > 0);
    gestures.readTouches();
    // 15 CSS pixels farther apart, the fingers only pan: up, as the page
    // narrower than the viewport does not pan sideways.
    assert.deepEqual(previewOf(content), { x: 0, y: -30, factor: 1, originX: 300, originY: 250 });
    assert.equal(gestures.zooming(), false);
    pointer("pointermove", 2, 520, 270);
    gestures.readTouches();
    assert.equal(previewOf(content).factor, 1);
    // From there, twice as far apart is twice the size.
    pointer("pointermove", 2, 740, 270);
    pointer("pointerup", 2, 740, 270);
    assert.equal(zooms.length, 1);
    assert.deepEqual(zooms[0], {
      scale: 2,
      anchor: { x: 300 + 120, y: 250 - 30 },
      point: { x: 300, y: 250 },
    });
    assert.equal(content.style.transform, "");
  });

  it("only scrolls for a two-finger drag that never pinched", () => {
    const { scroller, gestures, zooms } = pinching();
    pointer("pointermove", 1, 250, 220);
    pointer("pointermove", 2, 450, 220);
    gestures.readTouches();
    pointer("pointerup", 1, 250, 220);
    assert.equal(zooms.length, 0);
    assert.deepEqual([scroller.scrollLeft, scroller.scrollTop], [0, 80]);
  });

  it("previews no drag past the start of the document, where the commit stops", () => {
    const { content, gestures } = pinching();
    pointer("pointermove", 1, 300, 400);
    pointer("pointermove", 2, 500, 400);
    gestures.readTouches();
    assert.deepEqual([previewOf(content).x, previewOf(content).y], [0, 0]);
  });

  it("previews a zoom out where the commit puts the content, and shows that viewport", () => {
    const { scroller, content, gestures } = pinching();
    pointer("pointermove", 1, 310, 300);
    pointer("pointermove", 2, 490, 300);
    gestures.readTouches();
    pointer("pointermove", 1, 355, 300);
    pointer("pointermove", 2, 445, 300);
    gestures.readTouches();
    // At half the size, the page centers again, 100 to the right of where
    // its point would stay, and the document cannot scroll above its start.
    assert.deepEqual(previewOf(content), {
      x: 100,
      y: -120,
      factor: 0.5,
      originX: 300,
      originY: 250,
    });
    assert.deepEqual(gestures.shownViewport(scroller as unknown as HTMLElement), {
      left: -500,
      top: -10,
      width: 2000,
      height: 1600,
      scrollerWidth: 1000,
      scrollerHeight: 800,
    });
  });

  it("commits the moves no frame read yet as a finger lifts", () => {
    const { zooms } = pinching();
    pointer("pointermove", 2, 520, 300);
    pointer("pointerup", 2, 520, 300);
    assert.equal(zooms.length, 0);
    const second = pinching();
    pointer("pointermove", 2, 520, 300);
    second.gestures.readTouches();
    pointer("pointermove", 2, 740, 300);
    pointer("pointercancel", 2, 740, 300);
    assert.equal(second.zooms[0]?.scale, 2);
  });

  it("pinches on from where something else committed its preview", () => {
    const { content, gestures, zooms } = pinching();
    pointer("pointermove", 2, 520, 300);
    gestures.readTouches();
    pointer("pointermove", 2, 740, 300);
    gestures.readTouches();
    // A resize commits the preview.
    gestures.finish();
    assert.equal(zooms.length, 1);
    pointer("pointermove", 2, 750, 300);
    gestures.readTouches();
    // The fingers start over from where they are, short of the slop.
    pointer("pointermove", 2, 760, 300);
    gestures.readTouches();
    assert.equal(previewOf(content).factor, 1);
    assert.equal(gestures.zooming(), false);
  });

  it("goes on pinching with the fingers still down when one of two lifts", () => {
    const { content, gestures, zooms } = pinching();
    pointer("pointerdown", 3, 400, 500);
    pointer("pointermove", 2, 520, 300);
    gestures.readTouches();
    pointer("pointermove", 2, 740, 300);
    pointer("pointerup", 1, 300, 300);
    assert.equal(zooms.length, 1);
    // Fingers 2 and 3 pinch on, around the midpoint between them.
    pointer("pointermove", 3, 400, 520);
    gestures.readTouches();
    assert.equal(content.style.transformOrigin, `${(740 + 400) / 2 - 100}px ${400 - 50}px`);
    assert.equal(previewOf(content).factor, 1);
    pointer("pointerup", 2, 740, 300);
    pointer("pointerup", 3, 400, 520);
    assert.equal(getEventListeners(fakeWindow, "pointermove").length, 0);
    assert.equal(zooms.length, 1);
  });

  it("ignores mice and pens, and touches no pinch holds", () => {
    const { scroller, content, gestures } = setUp();
    currentScroller = scroller;
    fire(scroller, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 0, clientY: 0 });
    fire(scroller, "pointerdown", { pointerType: "pen", pointerId: 2, clientX: 9, clientY: 9 });
    assert.equal(getEventListeners(fakeWindow, "pointermove").length, 0);
    pointer("pointerdown", 3, 300, 300);
    pointer("pointermove", 3, 200, 200);
    gestures.readTouches();
    pointer("pointerup", 3, 200, 200);
    assert.equal(content.style.transform, "");
    assert.equal(getEventListeners(fakeWindow, "pointerup").length, 0);
  });
});

describe("Safari's gesture events", () => {
  it("zoom relative to their start and commit at their end", () => {
    const { scroller, content, zooms } = setUp();
    assert.equal(fire(scroller, "gesturestart", { scale: 1.2, clientX: 600, clientY: 450 }), false);
    fire(scroller, "gesturechange", { scale: 1.8, clientX: 600, clientY: 450 });
    close(previewOf(content).factor, 1.5);
    fire(scroller, "gestureend", { scale: 2.4, clientX: 600, clientY: 450 });
    assert.equal(zooms.length, 1);
    close(zooms[0]?.scale ?? 0, 2);
    assert.deepEqual(zooms[0]?.point, { x: 500, y: 400 });
  });

  it("zoom around the viewport's center without a pointer", () => {
    const { scroller, content } = setUp();
    fire(scroller, "gesturestart", { scale: 1 });
    fire(scroller, "gesturechange", { scale: 2 });
    assert.equal(content.style.transformOrigin, "500px 400px");
  });

  it("commit a gesture that never ends after a while", () => {
    const { scroller, zooms } = setUp();
    fire(scroller, "gesturestart", { scale: 1 });
    fire(scroller, "gesturechange", { scale: 2 });
    mock.timers.tick(150);
    assert.equal(zooms[0]?.scale, 2);
  });

  it("commit a wheel zoom in progress before they start", () => {
    const { scroller, zooms } = setUp();
    wheel(scroller, -50);
    fire(scroller, "gesturestart", { scale: 1 });
    assert.equal(zooms.length, 1);
    fire(scroller, "gestureend", { scale: 1.5 });
    mock.timers.tick(1000);
    assert.equal(zooms.length, 2);
  });

  it("leave a pinch to the touches while they report it, and finish it once Safari takes them", () => {
    const { scroller, content, gestures, zooms } = setUp();
    currentScroller = scroller;
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    fire(scroller, "gesturestart", { scale: 1 });
    pointer("pointermove", 2, 520, 300);
    gestures.readTouches();
    pointer("pointermove", 2, 740, 300);
    gestures.readTouches();
    fire(scroller, "gesturechange", { scale: 2.2 });
    assert.equal(previewOf(content).factor, 2);
    // Safari cancels the pointers and goes on with gesture events.
    pointer("pointercancel", 1, 300, 300);
    assert.equal(zooms.length, 0);
    fire(scroller, "gesturechange", { scale: 3.3 });
    close(previewOf(content).factor, 3);
    fire(scroller, "gestureend", { scale: 3.3 });
    close(zooms[0]?.scale ?? 0, 3);
  });

  it("let a pinch cancelled without them commit at once", () => {
    const { scroller, gestures, zooms } = setUp();
    currentScroller = scroller;
    pointer("pointerdown", 1, 300, 300);
    pointer("pointerdown", 2, 500, 300);
    pointer("pointermove", 2, 520, 300);
    gestures.readTouches();
    pointer("pointermove", 2, 740, 300);
    pointer("pointercancel", 2, 740, 300);
    assert.equal(zooms[0]?.scale, 2);
  });
});

describe("swipes in page mode", () => {
  const touch = (x: number, y: number) => ({ identifier: 7, clientX: x, clientY: y });

  /** A one-finger swipe from (500, 400) by `dx` and `dy`. */
  const swipe = (scroller: EventTarget, dx: number, dy: number, end = "touchend") => {
    const start = touch(500, 400);
    fire(scroller, "touchstart", { touches: [start], changedTouches: [start] });
    const moved = touch(500 + dx, 400 + dy);
    fire(scroller, end, { touches: [], changedTouches: [moved] });
  };

  /** Page mode, with the page shown fitting the viewport. */
  const paged = (direction: Direction = "ltr") => {
    const set = setUp({ scrollMode: "page", direction });
    set.scroller.scrollHeight = 800;
    return set;
  };

  it("flip onward for a swipe left or up, back for one right or down", () => {
    const { scroller, flips } = paged();
    swipe(scroller, -100, 0);
    swipe(scroller, 0, -100);
    swipe(scroller, 100, 0);
    swipe(scroller, 0, 100);
    assert.deepEqual(flips, ["1 x", "1 y", "-1 x", "-1 y"]);
  });

  it("flip sideways the other way for pages read from the right", () => {
    const { scroller, flips } = paged("rtl");
    swipe(scroller, -100, 0);
    swipe(scroller, 100, 0);
    swipe(scroller, 0, -100);
    assert.deepEqual(flips, ["-1 x", "1 x", "1 y"]);
  });

  it("flip once they moved far enough within 30 degrees of an axis", () => {
    const { scroller, flips } = setUp({ scrollMode: "page" });
    swipe(scroller, -49, 0);
    swipe(scroller, -100, 58);
    swipe(scroller, -100, 57);
    swipe(scroller, -50, 0);
    assert.deepEqual(flips, ["1 x", "1 x"]);
  });

  it("flip only past an edge the page was at as the finger went down and still is", () => {
    const { scroller, flips } = setUp({ scrollMode: "page" });
    scroller.scrollHeight = 1600;
    // At the top, a swipe up scrolls the page.
    swipe(scroller, 0, -100);
    assert.deepEqual(flips, []);
    scroller.scrollTop = 800;
    swipe(scroller, 0, -100);
    assert.deepEqual(flips, ["1 y"]);
    // A swipe that scrolled the page away from the edge does not flip.
    const start = touch(500, 400);
    fire(scroller, "touchstart", { touches: [start], changedTouches: [start] });
    scroller.scrollTop = 700;
    fire(scroller, "touchend", { touches: [], changedTouches: [touch(500, 300)] });
    assert.deepEqual(flips, ["1 y"]);
  });

  it("do not flip outside page mode, or for a cancelled touch", () => {
    const vertical = setUp();
    swipe(vertical.scroller, -100, 0);
    assert.deepEqual(vertical.flips, []);
    const paged = setUp({ scrollMode: "page" });
    swipe(paged.scroller, -100, 0, "touchcancel");
    assert.deepEqual(paged.flips, []);
  });

  it("leave a second finger, a selection, a zoom, a claimed pointer, and controls alone", () => {
    const { scroller, flips, host } = setUp({ scrollMode: "page" });
    const [first, second] = [touch(500, 400), { ...touch(600, 400), identifier: 8 }];
    fire(scroller, "touchstart", { touches: [first], changedTouches: [first] });
    fire(scroller, "touchstart", { touches: [first, second], changedTouches: [second] });
    fire(scroller, "touchend", { touches: [first], changedTouches: [second] });
    fire(scroller, "touchend", { touches: [], changedTouches: [touch(300, 400)] });
    // A long press selects text.
    fire(scroller, "touchstart", { touches: [first], changedTouches: [first] });
    selected = "word";
    fire(scroller, "touchend", { touches: [], changedTouches: [touch(300, 400)] });
    selected = "";
    wheel(scroller, -50);
    swipe(scroller, -100, 0);
    mock.timers.tick(150);
    host.claimed = true;
    swipe(scroller, -100, 0);
    host.claimed = false;
    scroller.control = true;
    swipe(scroller, -100, 0);
    assert.deepEqual(flips, []);
  });

  it("hold the fling a flip leaves behind until the reader acts or a second passes", () => {
    const { scroller, flips, detach } = setUp({ scrollMode: "page" });
    scroller.scrollHeight = 1600;
    scroller.scrollTop = 800;
    swipe(scroller, 0, -100);
    assert.deepEqual(flips, ["1 y"]);
    assert.equal(scroller.style.overflow, "hidden");
    // The fling would scroll the page the flip showed.
    scroller.scrollTop = 100;
    mock.timers.tick(999);
    assert.equal(scroller.style.overflow, "hidden");
    mock.timers.tick(1);
    assert.equal(scroller.style.overflow, "");
    assert.equal(scroller.scrollTop, 800);
    swipe(scroller, 0, -100);
    fire(scroller, "keydown");
    assert.equal(scroller.style.overflow, "");
    swipe(scroller, 0, -100);
    detach();
    assert.equal(scroller.style.overflow, "");
    assert.equal(getEventListeners(scroller, "keydown").length, 0);
  });

  it("hold nothing when the flip goes nowhere", () => {
    const { scroller, flips, host } = setUp({ scrollMode: "page" });
    host.flipped = false;
    swipe(scroller, -100, 0);
    assert.deepEqual(flips, ["1 x"]);
    assert.equal(scroller.style.overflow, "");
  });
});

describe("a viewport's gestures", () => {
  it("drop a gesture in progress without committing it", () => {
    const { scroller, content, gestures, zooms } = setUp();
    currentScroller = scroller;
    wheel(scroller, -50);
    pointer("pointerdown", 1, 300, 300);
    gestures.drop();
    assert.equal(content.style.transform, "");
    assert.equal(gestures.motion, null);
    assert.equal(getEventListeners(fakeWindow, "pointermove").length, 0);
    mock.timers.tick(1000);
    assert.deepEqual(zooms, []);
  });

  it("commit a gesture in progress before the layout changes under it, once", () => {
    const { scroller, gestures, zooms } = setUp();
    wheel(scroller, -50);
    gestures.finish();
    gestures.finish();
    mock.timers.tick(1000);
    assert.equal(zooms.length, 1);
  });

  it("stop listening to the viewport once it detaches", () => {
    const { scroller, detach } = setUp();
    detach();
    for (const type of ["wheel", "pointerdown", "touchstart", "touchend", "touchcancel"]) {
      assert.equal(getEventListeners(scroller, type).length, 0, type);
    }
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      assert.equal(getEventListeners(scroller, type).length, 0, type);
    }
  });
});
