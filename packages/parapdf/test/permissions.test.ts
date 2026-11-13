import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentPermissions } from "../src/document/session.ts";
import { attachFormLayers } from "../src/features/forms/layers.ts";
import { enforcePermissions, permits, permitted } from "../src/features/permissions.ts";
import { Viewer } from "../src/view/viewer.ts";
import { fakeDocument, fakePdfjs, settle, show } from "./fake-pdfjs.ts";

const restricted: DocumentPermissions = {
  restricted: true,
  print: false,
  printHighQuality: false,
  modify: false,
  copy: false,
  copyForAccessibility: true,
  annotate: false,
  fillForms: true,
  assemble: true,
};

describe("permissions", () => {
  it("permit everything while unknown", () => {
    for (const what of ["print", "copy", "annotate", "fillForms"] as const) {
      assert.equal(permitted(null, what), true);
    }
  });

  it("let form fields be filled in with permission to annotate", () => {
    assert.equal(permitted(restricted, "print"), false);
    assert.equal(permitted(restricted, "copy"), false);
    assert.equal(permitted({ ...restricted, fillForms: false }, "fillForms"), false);
    assert.equal(permitted({ ...restricted, fillForms: false, annotate: true }, "fillForms"), true);
  });

  it("updates existing form layers when enforcement changes", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const viewer = new Viewer();
    const layers = context.mock.method(viewer, "setFormLayers");
    const forms = attachFormLayers(viewer);
    const document = fakeDocument({ proxy: { getPermissions: async () => new Set<number>() } });
    const { close } = show(
      viewer,
      { url: "/locked.pdf" },
      fakePdfjs(async () => document.proxy).loader,
    );
    await settle();
    assert.equal(layers.mock.calls.at(-1)?.arguments[0], true);
    const release = enforcePermissions(viewer);
    assert.equal(layers.mock.calls.at(-1)?.arguments[0], false);
    release();
    assert.equal(layers.mock.calls.at(-1)?.arguments[0], true);
    forms.detach();
    close();
    context.mock.timers.tick(1000);
    await settle();
  });

  it("bind a viewer only while it follows them", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    // Permitted: filling in forms, copying for accessibility, and assembling.
    const flags = new Set([0x100, 0x200, 0x400]);
    const document = fakeDocument({ proxy: { getPermissions: async () => flags } });
    const viewer = new Viewer();
    const { close } = show(viewer, { url: "/a.pdf" }, fakePdfjs(async () => document.proxy).loader);
    await settle();
    assert.equal(permits(viewer, "print"), true, "a viewer reports them only, by default");
    const stop = enforcePermissions(viewer);
    assert.equal(permits(viewer, "print"), false);
    assert.equal(permits(viewer, "fillForms"), true);
    const second = enforcePermissions(viewer);
    stop();
    stop();
    assert.equal(permits(viewer, "print"), false, "another caller still enforces permissions");
    second();
    assert.equal(permits(viewer, "print"), true);
    close();
    context.mock.timers.tick(1000);
    await settle();
  });
});
