import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Store } from "../src/document/store.ts";
import {
  annotationSlot,
  bindAnnotationTool,
  sameAnnotationLabels,
} from "../src/features/annotation-slot.ts";
import {
  type AnnotationEditing,
  type AnnotationEditingOptions,
  type AnnotationEditingStore,
  attachAnnotationEditing,
} from "../src/features/annotations.ts";
import type {
  AnnotationEditingState,
  AnnotationLabels,
  AnnotationStyles,
  AnnotationTool,
} from "../src/pdfjs/editor-types.ts";
import { activeTracked, createTrackedSnapshot, hasTrackedChange } from "../src/react/context.ts";
import { ViewerController } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, settle, show } from "./fake-pdfjs.ts";

const READY_STATE: AnnotationEditingState = {
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  isEmpty: true,
  selected: null,
};

const READY_STYLES: AnnotationStyles = {
  highlight: { color: "#ffff98", thickness: 12 },
  freetext: { color: "#000000", fontSize: 10 },
  ink: { color: "#000000", thickness: 1, opacity: 1 },
};

function fakeEditing() {
  let store = new Store<AnnotationEditingStore>({
    tool: "none",
    state: null,
    styles: null,
  });
  const setLabelsCalls: Partial<AnnotationLabels>[] = [];
  const setToolCalls: AnnotationTool[] = [];
  let detached = 0;

  const editing: AnnotationEditing = {
    get store() {
      return store;
    },
    async setTool(tool) {
      setToolCalls.push(tool);
      store.set({ tool });
    },
    setStyle() {},
    undo() {},
    redo() {},
    deleteSelected() {},
    selectAll() {},
    setComment: () => false,
    setAltText: () => false,
    addImage: async () => false,
    addSignature: async () => false,
    export: () => [],
    import: async () => 0,
    setLabels(labels) {
      setLabelsCalls.push(labels);
    },
    detach() {
      detached++;
      store.set({ tool: "none", state: null, styles: null });
    },
  };

  return {
    editing,
    attach(_viewer: ViewerController, options: AnnotationEditingOptions): AnnotationEditing {
      store = options.store as unknown as Store<AnnotationEditingStore>;
      return editing;
    },
    get store() {
      return store;
    },
    setLabelsCalls,
    setToolCalls,
    get detached() {
      return detached;
    },
    open() {
      store.set({ tool: "none", state: READY_STATE, styles: READY_STYLES });
    },
  };
}

function withViewportGlobals<T>(run: () => Promise<T>): Promise<T> {
  const names = ["window", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"];
  const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.assign(globalThis, {
    window: {
      devicePixelRatio: 1,
      setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  return run().finally(() => {
    names.forEach((name, index) => {
      const descriptor = before[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  });
}

function fakeViewport() {
  const listeners = new Map<string, Set<EventListener>>();
  const element = () =>
    ({
      clientWidth: 800,
      clientHeight: 600,
      scrollTop: 0,
      scrollLeft: 0,
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type: string, fn: EventListener) {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(fn);
      },
      removeEventListener(type: string, fn: EventListener) {
        listeners.get(type)?.delete(fn);
      },
      contains: () => false,
    }) as unknown as HTMLElement;
  return { scroller: element(), content: element() };
}

describe("annotationSlot and useAnnotations", () => {
  it("shares a single Store instance with attachAnnotationEditing, returns idle controls pre-mount, and keeps action references stable", () => {
    const realViewer = new ViewerController();
    const realSlot = annotationSlot(realViewer);
    const unmountReal = realSlot.mount(attachAnnotationEditing, undefined);
    assert.ok(realSlot.editing);
    assert.equal(realSlot.editing.store, realSlot.store);
    unmountReal();
    realSlot.detachNow();

    const viewer = new ViewerController();
    const slot = annotationSlot(viewer);
    const initial = slot.store.get();
    assert.equal(initial.tool, "none");
    assert.equal(initial.state, null);
    assert.equal(initial.styles, null);

    // Track only action methods, as a toolbar button (`const { setTool } = useAnnotations()`) does.
    const tracked = createTrackedSnapshot(initial);
    const setToolRef = tracked.proxy.setTool;
    const undoRef = tracked.proxy.undo;
    assert.deepEqual([...tracked.tracked], ["setTool", "undo"]);

    const fake = fakeEditing();
    const unmount = slot.mount(fake.attach, undefined);
    fake.open();
    void fake.editing.setTool("highlight");

    const updated = slot.store.get();
    assert.equal(updated.tool, "highlight");
    assert.equal(updated.state, READY_STATE);
    assert.equal(updated.setTool, setToolRef);
    assert.equal(updated.undo, undoRef);
    assert.equal(hasTrackedChange(tracked.raw, updated, activeTracked(tracked)), false);

    // detachNow() synchronously clears slot.editing and resets the store to STOPPED even if an adapter left state behind.
    fake.editing.detach = () => {};
    unmount();
    slot.detachNow();
    assert.equal(slot.editing, null);
    assert.equal(slot.store.get().tool, "none");
    assert.equal(slot.store.get().state, null);
    assert.equal(slot.store.get().styles, null);
  });

  it("compares inline label objects structurally and forwards only real changes", () => {
    assert.equal(sameAnnotationLabels(undefined, undefined), true);
    assert.equal(sameAnnotationLabels({ highlight: "Marker" }, { highlight: "Marker" }), true);
    assert.equal(sameAnnotationLabels({ highlight: "Marker" }, { highlight: "Pen" }), false);
    assert.equal(
      sameAnnotationLabels({ highlight: "Marker" }, { highlight: "Marker", ink: "Pen" }),
      false,
    );

    const viewer = new ViewerController();
    const slot = annotationSlot(viewer);
    const fake = fakeEditing();
    let diverged = 0;
    const heard: AnnotationTool[] = [];
    const control = slot.bindControls(fake.attach, () => diverged++);
    control.sync({ highlight: "Marker" }, { tool: "ink", onToolChange: (t) => heard.push(t) });

    fake.open();
    assert.equal(slot.store.get().tool, "ink");
    assert.equal(heard.length, 0);

    control.sync({ highlight: "Marker" }, { tool: "ink", onToolChange: (t) => heard.push(t) });
    assert.deepEqual(fake.setLabelsCalls, []);

    control.sync({ highlight: "Marker", ink: "Pen" }, { tool: "highlight" });
    assert.equal(slot.store.get().tool, "highlight");
    control.sync(undefined, {});
    assert.deepEqual(fake.setLabelsCalls, [{ highlight: "Marker", ink: "Pen" }, {}]);
    assert.equal(diverged, 0);

    control.disconnect();
  });

  it("survives StrictMode remounts, sibling reattaches, and viewport hides, while detaching when removed from a live viewport", () =>
    withViewportGlobals(async () => {
      const viewer = new ViewerController();
      const slot = annotationSlot(viewer);
      const fake = fakeEditing();
      const { scroller, content } = fakeViewport();
      const detachViewport = viewer.attachViewport(scroller, content);

      // StrictMode mounts twice and cleans up the first mount synchronously before microtasks run.
      const unmount1 = slot.mount(fake.attach, undefined);
      const unmount2 = slot.mount(fake.attach, undefined);
      unmount1();
      await settle();
      assert.equal(fake.detached, 0);
      assert.equal(slot.editing, fake.editing);

      // Simultaneous viewport hide (<Activity mode="hidden"> or unmounting <PdfViewer>):
      // scroller is detached during commit, so kept edits stay on the viewer.
      fake.open();
      detachViewport();
      unmount2();
      await settle();
      assert.equal(fake.detached, 0);
      assert.equal(slot.editing, fake.editing);

      // Sibling mounting after the viewport in the same commit restores the editor's owner without detaching.
      const reattachSibling = viewer.attachViewport(scroller, content);
      const remountSibling = slot.mount(fake.attach, undefined);
      await settle();
      assert.equal(fake.detached, 0, "the same React commit restores the editor's owner");
      assert.equal(slot.editing, fake.editing);
      reattachSibling();
      remountSibling();
      await settle();

      // Reattaching the viewport without an editor owner by the end of the commit detaches kept edits.
      const detachViewport2 = viewer.attachViewport(scroller, content);
      await settle();
      assert.equal(fake.detached, 1);
      assert.equal(slot.editing, null);

      // Mounting again on the live viewport, then unmounting <PdfAnnotationEditor> while viewport stays mounted:
      const fake2 = fakeEditing();
      const unmount3 = slot.mount(fake2.attach, undefined);
      fake2.open();
      unmount3();
      await settle();
      assert.equal(fake2.detached, 1);
      assert.equal(slot.editing, null);
      assert.equal(slot.store.get().state, null);

      detachViewport2();
    }));
});

describe("bindAnnotationTool", () => {
  it("applies controlled tool on open without echoing onToolChange('none') and reconciles divergences", () => {
    const viewer = new ViewerController();
    const slot = annotationSlot(viewer);
    const fake = fakeEditing();
    const unmount = slot.mount(fake.attach, undefined);

    let controlled: AnnotationTool | undefined = "highlight";
    const heard: AnnotationTool[] = [];
    let diverged = 0;

    const controller = bindAnnotationTool(
      viewer,
      slot,
      () => ({
        tool: controlled,
        onToolChange: (next) => heard.push(next),
      }),
      () => diverged++,
    );

    // Opening the editor transitions state from null to non-null at "none":
    // controlled "highlight" applies immediately without reporting "none".
    fake.open();
    assert.deepEqual(heard, []);
    assert.deepEqual(fake.setToolCalls, ["highlight"]);
    assert.equal(slot.store.get().tool, "highlight");

    // Editor switches internally (e.g., Escape -> "none"): reports once and flags divergence.
    fake.store.set({ tool: "none" });
    assert.deepEqual(heard, ["none"]);
    assert.equal(diverged, 1);

    // Parent keeps controlled = "highlight" and re-renders: applyControlled reverts to "highlight" silently.
    controller.applyControlled(controlled);
    assert.equal(slot.store.get().tool, "highlight");
    assert.deepEqual(heard, ["none"]);

    // Parent updates controlled = "ink": applies without echoing onToolChange.
    controlled = "ink";
    controller.applyControlled(controlled);
    assert.equal(slot.store.get().tool, "ink");
    assert.deepEqual(heard, ["none"]);

    controller.disconnect();
    unmount();
  });

  it("applies defaultTool once per opened document session", async () => {
    const viewer = new ViewerController();
    const slot = annotationSlot(viewer);
    const fake = fakeEditing();
    const unmount = slot.mount(fake.attach, undefined);
    const { loader } = fakePdfjs(async () => fakeDocument().proxy);
    const { close } = show(viewer, { url: "/one.pdf" }, loader);
    await settle();

    const heard: AnnotationTool[] = [];
    const controller = bindAnnotationTool(
      viewer,
      slot,
      () => ({
        defaultTool: "ink",
        onToolChange: (next) => heard.push(next),
      }),
      () => {},
    );

    fake.open();
    assert.equal(slot.store.get().tool, "ink");
    assert.equal(heard.length, 0);

    // Reader switches to "none": uncontrolled mode allows it and reports onToolChange("none") without re-applying defaultTool.
    await fake.editing.setTool("none");
    assert.equal(slot.store.get().tool, "none");
    assert.deepEqual(heard, ["none"]);

    close();
    fake.store.set({ tool: "none", state: null, styles: null });

    // Opening a new session applies defaultTool again.
    const second = show(viewer, { url: "/two.pdf" }, loader);
    await settle();
    fake.open();
    assert.equal(slot.store.get().tool, "ink");

    second.close();
    controller.disconnect();
    unmount();
  });
});
