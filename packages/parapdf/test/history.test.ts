import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HISTORY_LIMIT, historyOf, Positions } from "../src/features/history.ts";
import type { ViewerExtension } from "../src/view/extensions.ts";
import type { ViewerPosition } from "../src/view/navigation.ts";
import type { ViewerController } from "../src/view/viewer.ts";

const at = (pageIndex: number): ViewerPosition => ({
  pageIndex,
  x: 0,
  y: 0,
  current: pageIndex,
  scale: 1,
  zoomMode: "custom",
});

/** A viewer as the history calls it: its extensions, positions, and restored positions. */
function fakeViewer() {
  const extensions = new Set<ViewerExtension>();
  const restored: number[] = [];
  const slots = new Map<symbol, unknown>();
  let position: ViewerPosition | null = at(0);
  const viewer = {
    slot<T>(key: symbol, create: () => T): T {
      if (!slots.has(key)) slots.set(key, create());
      return slots.get(key) as T;
    },
    peekSlot<T>(key: symbol): T | undefined {
      return slots.get(key) as T | undefined;
    },
    clearSlot(key: symbol): void {
      slots.delete(key);
    },
    extend(extension: ViewerExtension) {
      extensions.add(extension);
      return () => extensions.delete(extension);
    },
    position: () => position,
    restorePosition(entry: ViewerPosition) {
      restored.push(entry.pageIndex);
      position = entry;
    },
  } as unknown as ViewerController;
  const hear = (hook: keyof ViewerExtension, ...args: unknown[]) => {
    for (const extension of extensions) {
      (extension[hook] as ((...values: unknown[]) => void) | undefined)?.(...args);
    }
  };
  return {
    viewer,
    extensions,
    restored,
    hear,
    /** Where the viewer is now; null as it has no viewport. */
    place(at: ViewerPosition | null) {
      position = at;
    },
    /** Jump from where the viewer is to page `pageIndex`, as a link does. */
    jump(pageIndex: number) {
      hear("jumping");
      position = at(pageIndex);
    },
  };
}

describe("history positions", () => {
  it("goes back and forward, and a new jump forgets forward", () => {
    const positions = new Positions<number>();
    assert.equal(positions.canGoBack, false);
    positions.push(1);
    positions.push(2);
    assert.equal(positions.back(3), 2);
    assert.equal(positions.canGoForward, true);
    assert.equal(positions.forward(2), 3);
    assert.equal(positions.back(3), 2);
    positions.push(5);
    assert.equal(positions.canGoForward, false);
    assert.equal(positions.back(6), 5);
    assert.equal(positions.back(5), 1);
    assert.equal(positions.back(1), null);
  });

  it("keeps the latest jumps only", () => {
    const positions = new Positions<number>();
    for (let jump = 0; jump < HISTORY_LIMIT + 5; jump++) positions.push(jump);
    let oldest = -1;
    for (let entry = positions.back(null); entry !== null; entry = positions.back(null)) {
      oldest = entry;
    }
    assert.equal(oldest, 5);
  });
});

describe("the history feature", () => {
  it("keeps the positions jumps start from and returns to them", () => {
    const fake = fakeViewer();
    const history = historyOf(fake.viewer);
    const { back, forward } = history.get();
    fake.jump(4);
    fake.jump(9);
    assert.deepEqual(history.get(), {
      canGoBack: true,
      canGoForward: false,
      back,
      forward,
    });
    back();
    assert.deepEqual(fake.restored, [4]);
    assert.deepEqual(history.get(), {
      canGoBack: true,
      canGoForward: true,
      back,
      forward,
    });
    forward();
    assert.deepEqual(fake.restored, [4, 9]);
  });

  it("keeps its positions while the viewer has no viewport to leave or show them in", () => {
    const fake = fakeViewer();
    const history = historyOf(fake.viewer);
    const { back, forward } = history.get();
    fake.jump(4);
    fake.jump(9);
    fake.place(null);
    back();
    forward();
    assert.deepEqual(fake.restored, []);
    assert.deepEqual(history.get(), {
      canGoBack: true,
      canGoForward: false,
      back,
      forward,
    });
    fake.place(at(9));
    back();
    back();
    assert.deepEqual(fake.restored, [4, 0]);
  });

  it("follows the GoBack and GoForward named actions of links", () => {
    const fake = fakeViewer();
    historyOf(fake.viewer);
    fake.jump(3);
    fake.hear("namedAction", "GoBack");
    fake.hear("namedAction", "GoForward");
    fake.hear("namedAction", "Print");
    assert.deepEqual(fake.restored, [0, 3]);
  });

  it("keeps the positions while the viewer lets its document go, to show it again", () => {
    const fake = fakeViewer();
    const history = historyOf(fake.viewer);
    const { back, forward } = history.get();
    fake.jump(2);
    fake.hear("closed", true);
    assert.deepEqual(history.get(), {
      canGoBack: true,
      canGoForward: false,
      back,
      forward,
    });
    back();
    assert.deepEqual(fake.restored, [0]);
  });

  it("forgets the positions when the viewer forgets its session", () => {
    const fake = fakeViewer();
    const history = historyOf(fake.viewer);
    const { back, forward } = history.get();
    fake.jump(2);
    fake.hear("closed", true);
    fake.hear("closed", false);
    assert.deepEqual(history.get(), {
      canGoBack: false,
      canGoForward: false,
      back,
      forward,
    });
  });

  it("shares one persistent history store per viewer", () => {
    const fake = fakeViewer();
    const other = fakeViewer();
    const history = historyOf(fake.viewer);
    assert.equal(historyOf(fake.viewer), history);
    assert.notEqual(historyOf(other.viewer), history);
  });
});
