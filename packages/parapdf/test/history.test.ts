import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachHistory, HISTORY_LIMIT, historyOf, Positions } from "../src/features/history.ts";
import type { ViewerExtension } from "../src/view/extensions.ts";
import type { ViewerPosition } from "../src/view/navigation.ts";
import type { Viewer } from "../src/view/viewer.ts";

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
  let position: ViewerPosition | null = at(0);
  const viewer = {
    extend(extension: ViewerExtension) {
      extensions.add(extension);
      return () => extensions.delete(extension);
    },
    position: () => position,
    restorePosition(entry: ViewerPosition) {
      restored.push(entry.pageIndex);
      position = entry;
    },
  } as unknown as Viewer;
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
    const history = attachHistory(fake.viewer);
    fake.jump(4);
    fake.jump(9);
    assert.deepEqual(history.store.get(), { canGoBack: true, canGoForward: false });
    history.back();
    assert.deepEqual(fake.restored, [4]);
    assert.deepEqual(history.store.get(), { canGoBack: true, canGoForward: true });
    history.forward();
    assert.deepEqual(fake.restored, [4, 9]);
  });

  it("follows the GoBack and GoForward named actions of links", () => {
    const fake = fakeViewer();
    attachHistory(fake.viewer);
    fake.jump(3);
    fake.hear("namedAction", "GoBack");
    fake.hear("namedAction", "GoForward");
    fake.hear("namedAction", "Print");
    assert.deepEqual(fake.restored, [0, 3]);
  });

  it("forgets the positions when the document closes, and detaches", () => {
    const fake = fakeViewer();
    const history = attachHistory(fake.viewer);
    fake.jump(2);
    fake.hear("closed");
    assert.deepEqual(history.store.get(), { canGoBack: false, canGoForward: false });
    history.detach();
    assert.equal(fake.extensions.size, 0, "the viewer hears nothing more of it");
    fake.jump(5);
    assert.equal(history.store.get().canGoBack, false);
  });

  it("is one per viewer until detached", () => {
    const fake = fakeViewer();
    const history = historyOf(fake.viewer);
    assert.equal(historyOf(fake.viewer), history);
    history.detach();
    assert.equal(fake.extensions.size, 0);
    assert.notEqual(historyOf(fake.viewer), history);
  });
});
