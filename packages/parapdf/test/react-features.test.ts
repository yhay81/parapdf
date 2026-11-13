import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Store } from "../src/document/store.ts";
import type { AnnotationEditing, AnnotationEditingStore } from "../src/features/annotations.ts";
import type {
  AnnotationEditingState,
  AnnotationLabels,
  AnnotationStyles,
  AnnotationTool,
} from "../src/pdfjs/editor-types.ts";
import {
  annotationSlot,
  bindAnnotationTool,
  sameAnnotationLabels,
  useAnnotationEditing,
  useAnnotations,
} from "../src/react/annotations.ts";
import {
  activeTracked,
  createTrackedSnapshot,
  hasTrackedChange,
  ViewerContext,
} from "../src/react/context.ts";
import { notifyFormChange, useFormChange } from "../src/react/forms.ts";
import { attachViewport, Viewer } from "../src/view/viewer.ts";
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
  const store = new Store<AnnotationEditingStore>({
    tool: "none",
    state: null,
    styles: null,
  });
  const setLabelsCalls: Partial<AnnotationLabels>[] = [];
  const setToolCalls: AnnotationTool[] = [];
  let detached = 0;

  const editing: AnnotationEditing = {
    store,
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
    store,
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

function SsrProbe({ out }: { out: { tool: string; hasEditing: boolean } }) {
  const controls = useAnnotations();
  out.tool = controls.tool;
  out.hasEditing = useAnnotationEditing() !== null;
  useFormChange(() => {});
  return createElement("span", null, controls.tool);
}

describe("annotationSlot and useAnnotations", () => {
  it("keeps editing when a sibling mounts after the viewport in the same commit", () =>
    withViewportGlobals(async () => {
      const viewer = new Viewer();
      const slot = annotationSlot(viewer);
      const fake = fakeEditing();
      const { scroller, content } = fakeViewport();
      const detach = attachViewport(viewer, scroller, content);
      const unmount = slot.mount(() => fake.editing, undefined);
      fake.open();
      detach();
      unmount();
      await settle();

      const reattach = attachViewport(viewer, scroller, content);
      const remount = slot.mount(() => fake.editing, undefined);
      await settle();
      assert.equal(fake.detached, 0, "the same React commit restores the editor's owner");
      assert.equal(slot.editing, fake.editing);
      remount();
      await settle();
      assert.equal(fake.detached, 1, "removing the editor alone still detaches it");
      reattach();
    }));

  it("returns non-null controls before mounting and keeps method references stable across tool updates", () => {
    const viewer = new Viewer();
    const slot = annotationSlot(viewer);
    const initial = slot.controlsStore.get();
    assert.equal(initial.tool, "none");
    assert.equal(initial.state, null);
    assert.equal(initial.styles, null);

    // Track only action methods, as a toolbar button (`const { setTool } = useAnnotations()`) does.
    const tracked = createTrackedSnapshot(initial);
    const setToolRef = tracked.proxy.setTool;
    const undoRef = tracked.proxy.undo;
    assert.deepEqual([...tracked.tracked], ["setTool", "undo"]);

    const fake = fakeEditing();
    const unmount = slot.mount(() => fake.editing, undefined);
    fake.open();
    void fake.editing.setTool("highlight");

    const updated = slot.controlsStore.get();
    assert.equal(updated.tool, "highlight");
    assert.equal(updated.state, READY_STATE);
    assert.equal(updated.setTool, setToolRef);
    assert.equal(updated.undo, undoRef);
    assert.equal(hasTrackedChange(tracked.raw, updated, activeTracked(tracked)), false);

    const out = { tool: "", hasEditing: true };
    const html = renderToString(
      createElement(ViewerContext, { value: new Viewer() }, createElement(SsrProbe, { out })),
    );
    assert.equal(html, "<span>none</span>");
    assert.equal(out.tool, "none");
    assert.equal(out.hasEditing, false);

    unmount();
  });

  it("compares inline label objects structurally and forwards only real changes", () => {
    assert.equal(sameAnnotationLabels(undefined, undefined), true);
    assert.equal(sameAnnotationLabels({ highlight: "Marker" }, { highlight: "Marker" }), true);
    assert.equal(sameAnnotationLabels({ highlight: "Marker" }, { highlight: "Pen" }), false);

    const viewer = new Viewer();
    const slot = annotationSlot(viewer);
    const fake = fakeEditing();
    const unmount = slot.mount(() => fake.editing, { highlight: "Marker" });

    slot.updateLabels({ highlight: "Marker" });
    assert.deepEqual(fake.setLabelsCalls, []);

    slot.updateLabels({ highlight: "Marker", ink: "Pen" });
    slot.updateLabels(undefined);
    assert.deepEqual(fake.setLabelsCalls, [{ highlight: "Marker", ink: "Pen" }, {}]);

    unmount();
  });

  it("survives StrictMode remounts and viewport hides, while detaching when removed from a live viewport", () =>
    withViewportGlobals(async () => {
      const viewer = new Viewer();
      const slot = annotationSlot(viewer);
      const fake = fakeEditing();
      const { scroller, content } = fakeViewport();
      const detachViewport = attachViewport(viewer, scroller, content);

      // StrictMode mounts twice and cleans up the first mount synchronously before microtasks run.
      const unmount1 = slot.mount(() => fake.editing, undefined);
      const unmount2 = slot.mount(() => fake.editing, undefined);
      unmount1();
      await settle();
      assert.equal(fake.detached, 0);
      assert.equal(slot.editing, fake.editing);

      // Simultaneous viewport hide (<Activity mode="hidden"> or unmounting <PdfViewer>):
      // scroller is detached during commit, so kept edits stay on the viewer.
      detachViewport();
      unmount2();
      await settle();
      assert.equal(fake.detached, 0);
      assert.equal(slot.editing, fake.editing);

      // Without an editor owner by the end of the commit, kept edits detach.
      const detachViewport2 = attachViewport(viewer, scroller, content);
      await settle();
      assert.equal(fake.detached, 1);
      assert.equal(slot.editing, null);

      // Mounting again on the live viewport, then unmounting <PdfAnnotationEditor> while viewport stays mounted:
      const fake2 = fakeEditing();
      const unmount3 = slot.mount(() => fake2.editing, undefined);
      fake2.open();
      unmount3();
      await settle();
      assert.equal(fake2.detached, 1);
      assert.equal(slot.editing, null);
      assert.equal(slot.controlsStore.get().state, null);

      detachViewport2();
    }));
});

describe("bindAnnotationTool", () => {
  it("applies controlled tool on open without echoing onToolChange('none') and reconciles divergences", () => {
    const viewer = new Viewer();
    const slot = annotationSlot(viewer);
    const fake = fakeEditing();
    const unmount = slot.mount(() => fake.editing, undefined);

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
    assert.equal(slot.controlsStore.get().tool, "highlight");

    // Editor switches internally (e.g., Escape -> "none"): reports once and flags divergence.
    fake.store.set({ tool: "none" });
    assert.deepEqual(heard, ["none"]);
    assert.equal(diverged, 1);

    // Parent keeps controlled = "highlight" and re-renders: applyControlled reverts to "highlight" silently.
    controller.applyControlled(controlled);
    assert.equal(slot.controlsStore.get().tool, "highlight");
    assert.deepEqual(heard, ["none"]);

    // Parent updates controlled = "ink": applies without echoing onToolChange.
    controlled = "ink";
    controller.applyControlled(controlled);
    assert.equal(slot.controlsStore.get().tool, "ink");
    assert.deepEqual(heard, ["none"]);

    controller.disconnect();
    unmount();
  });

  it("applies defaultTool once per opened document session", async () => {
    const viewer = new Viewer();
    const slot = annotationSlot(viewer);
    const fake = fakeEditing();
    const unmount = slot.mount(() => fake.editing, undefined);
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
    assert.equal(slot.controlsStore.get().tool, "ink");
    assert.deepEqual(heard, []);

    // Reader switches to "none": uncontrolled mode allows it and reports onToolChange("none") without re-applying defaultTool.
    await fake.editing.setTool("none");
    assert.equal(slot.controlsStore.get().tool, "none");
    assert.deepEqual(heard, ["none"]);

    close();
    fake.store.set({ tool: "none", state: null, styles: null });

    // Opening a new session applies defaultTool again.
    const second = show(viewer, { url: "/two.pdf" }, loader);
    await settle();
    fake.open();
    assert.equal(slot.controlsStore.get().tool, "ink");

    second.close();
    controller.disconnect();
    unmount();
  });
});

describe("notifyFormChange", () => {
  it("ignores viewers with no active listeners", () => {
    const viewer = new Viewer();
    assert.doesNotThrow(() => notifyFormChange(viewer, { name: "city", value: "Tokyo" }));
  });
});
