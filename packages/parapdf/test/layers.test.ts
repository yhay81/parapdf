import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as Pdfjs from "pdfjs-dist";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import { setLayerVisible } from "../src/features/layers.ts";
import { LayerState } from "../src/pdfjs/layers.ts";
import { fakeDocument, fakePdfjs, settle } from "./fake-pdfjs.ts";

type Group = { name: string | null; visible: boolean };

/** pdf.js's configuration of a document's layers: `groups` by id, listed in `order`. */
function config(groups: Record<string, Group>, order: unknown[] | null = null) {
  const state = Object.fromEntries(Object.entries(groups).map(([id, group]) => [id, { ...group }]));
  const actions: { state: unknown[]; preserveRB: boolean }[] = [];
  return {
    actions,
    getOrder: () => order,
    getGroup: (id: string) => state[id] ?? null,
    setVisibility(id: string, visible: boolean) {
      const group = state[id];
      if (group) group.visible = visible;
    },
    setOCGState(action: { state: unknown[]; preserveRB: boolean }) {
      actions.push(action);
      let visible = true;
      for (const operation of action.state) {
        if (operation === "ON" || operation === "OFF") visible = operation === "ON";
        else if (typeof operation === "string" && state[operation]) {
          (state[operation] as Group).visible = visible;
        }
      }
    },
    *[Symbol.iterator]() {
      yield* Object.entries(state);
    },
  };
}

/** A document whose display configuration is `display`, and every print one a new `print()`. */
function load(display: ReturnType<typeof config>, print = () => config({})) {
  const doc = {
    getOptionalContentConfig: async ({ intent }: { intent: string }) =>
      intent === "print" ? print() : display,
  };
  return LayerState.load(doc as unknown as Pdfjs.PDFDocumentProxy);
}

const layer = (id: string, name: string, visible = true) => ({ id, name, visible, children: [] });

describe("LayerState", () => {
  it("lists the layers in the document's order, headings grouping the layers under them", async () => {
    const groups = {
      a: { name: "A", visible: true },
      b: { name: null, visible: false },
      c: { name: "C", visible: true },
    };
    const order = [
      "c",
      { name: "Heading", order: ["b", { name: null, order: ["a"] }, "unknown"] },
      "unknown",
      7,
      { name: "Without an order" },
    ];
    const layers = await load(config(groups, order));
    assert.deepEqual(layers.layers(), [
      layer("c", "C"),
      {
        id: null,
        name: "Heading",
        visible: true,
        children: [
          layer("b", "", false),
          { id: null, name: "", visible: true, children: [layer("a", "A")] },
        ],
      },
    ]);
  });

  it("lists every layer in the configuration's order when the document gives none, and none without layers", async () => {
    const groups = { b: { name: "B", visible: false }, a: { name: "A", visible: true } };
    const expected = [layer("b", "B", false), layer("a", "A")];
    assert.deepEqual((await load(config(groups))).layers(), expected);
    assert.deepEqual((await load(config(groups, []))).layers(), expected);
    assert.deepEqual((await load(config({}))).layers(), []);
  });

  it("keeps a link's radio-button groups unless it says not to, and ignores one without operations", async () => {
    const display = config({ a: { name: "A", visible: true } });
    const layers = await load(display);
    let heard = 0;
    layers.subscribe(() => heard++, new AbortController().signal);
    layers.apply({ state: "OFF" });
    layers.apply({});
    assert.equal(layers.changed, false);
    assert.equal(heard, 0);
    layers.apply({ state: ["OFF", "a"] });
    layers.apply({ state: ["ON", "a"], preserveRB: 0 });
    layers.apply({ state: ["OFF", "a"], preserveRB: false });
    assert.deepEqual(
      display.actions.map(({ preserveRB }) => preserveRB),
      [true, true, false],
    );
    assert.equal(layers.changed, true);
    assert.equal(heard, 3);
  });

  it("tells whether a layer changed since the document opened, and calls no listener whose signal aborted first", async () => {
    const layers = await load(config({ a: { name: "A", visible: true } }));
    assert.equal(layers.changed, false);
    const aborted = new AbortController();
    aborted.abort();
    let heard = 0;
    layers.subscribe(() => heard++, aborted.signal);
    layers.setVisible("a", true);
    assert.equal(layers.changed, true);
    assert.equal(heard, 0);

    const active = new AbortController();
    let removed = 0;
    const origRemove = active.signal.removeEventListener.bind(active.signal);
    active.signal.removeEventListener = ((
      ...args: Parameters<AbortSignal["removeEventListener"]>
    ) => {
      if (args[0] === "abort") removed++;
      return origRemove(...args);
    }) as AbortSignal["removeEventListener"];
    const unsubscribe = layers.subscribe(() => heard++, active.signal);
    unsubscribe();
    assert.equal(removed, 1, "manual unsubscribe detaches the abort listener from signal");
    layers.setVisible("a", false);
    assert.equal(heard, 0);
  });

  it("replays every change in order on each new configuration for printing", async () => {
    const display = config({ a: { name: "A", visible: true }, b: { name: "B", visible: true } });
    const print = () =>
      config({ a: { name: "A", visible: true }, b: { name: "B", visible: false } });
    const layers = await load(display, print);
    const untouched = await layers.forPrint();
    assert.equal(untouched.getGroup("b")?.visible, false, "the document's print visibility");
    layers.setVisible("a", false);
    layers.apply({ state: ["ON", "a", "b"] });
    layers.setVisible("b", false);
    const printed = await layers.forPrint();
    assert.notEqual(printed, untouched);
    assert.deepEqual(
      [printed.getGroup("a")?.visible, printed.getGroup("b")?.visible],
      [true, false],
    );
    assert.deepEqual(
      [display.getGroup("a")?.visible, display.getGroup("b")?.visible],
      [true, false],
    );
  });

  it("toggles layers via PdfSession both before and after layers are loaded", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const unopened = new PdfSessionController({ url: "/unopened.pdf" });
    setLayerVisible(unopened, "grid", false);

    const display = config({ grid: { name: "Grid", visible: true } }, ["grid"]);
    const doc = fakeDocument({
      proxy: {
        getOptionalContentConfig: async () => display,
      },
    });
    const session = new PdfSessionController(
      { url: "/layers.pdf" },
      { pdfjs: fakePdfjs(async () => doc.proxy).loader },
    );
    const disconnect = session.connect();
    t.after(async () => {
      disconnect();
      t.mock.timers.tick(1000);
      await settle();
    });
    await settle();

    // Before layers() was called by any viewer, setLayerVisible loads and updates them.
    assert.equal(session.openDocument()?.loadedLayers, null);
    setLayerVisible(session, "grid", false);
    await settle();
    assert.equal(display.getGroup("grid")?.visible, false);
    assert.notEqual(session.openDocument()?.loadedLayers, null);

    // Subsequent calls update loadedLayers synchronously.
    setLayerVisible(session, "grid", true);
    assert.equal(display.getGroup("grid")?.visible, true);
  });
});
