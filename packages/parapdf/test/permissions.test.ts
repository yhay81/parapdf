import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PdfPermissions } from "../src/document/session.ts";
import { enforcePermissions, permits, permitted } from "../src/features/permissions.ts";
import { Viewer } from "../src/view/viewer.ts";

const restricted: PdfPermissions = {
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

  it("bind a viewer only while it follows them", () => {
    const viewer = new Viewer();
    viewer.store.set({ permissions: restricted });
    assert.equal(permits(viewer, "print"), true, "a viewer reports them only, by default");
    const stop = enforcePermissions(viewer);
    assert.equal(permits(viewer, "print"), false);
    assert.equal(permits(viewer, "fillForms"), true);
    stop();
    assert.equal(permits(viewer, "print"), true);
  });
});
