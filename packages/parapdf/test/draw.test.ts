import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRenderCancelled, RenderCancelledError } from "../src/pdfjs/draw.ts";

describe("isRenderCancelled", () => {
  it("recognizes ParaPDF's and pdf.js's cancellations", () => {
    assert.equal(isRenderCancelled(new RenderCancelledError("cancelled")), true);
    for (const name of ["RenderingCancelledException", "AbortException"]) {
      const error = new Error("cancelled");
      error.name = name;
      assert.equal(isRenderCancelled(error), true, name);
    }
  });

  it("leaves every other failure alone", () => {
    assert.equal(isRenderCancelled(new Error("broken")), false);
    assert.equal(isRenderCancelled("RenderCancelledError"), false);
    assert.equal(isRenderCancelled(null), false);
  });
});
