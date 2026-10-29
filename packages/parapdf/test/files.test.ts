import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filenameFromUrl } from "../src/view/files.ts";

describe("filenameFromUrl", () => {
  it("is the last segment of the path, without the query or the fragment", () => {
    assert.equal(filenameFromUrl("https://example.com/docs/report.pdf?v=2#page=3"), "report.pdf");
    assert.equal(filenameFromUrl("/files/a.pdf"), "a.pdf");
    assert.equal(filenameFromUrl("a.pdf#zoom=200"), "a.pdf");
    assert.equal(filenameFromUrl("file:///C:/Users/me/b.pdf"), "b.pdf");
  });

  it("decodes the segment", () => {
    assert.equal(
      filenameFromUrl("/docs/annual%20report%E2%80%942024.pdf"),
      "annual report—2024.pdf",
    );
    assert.equal(filenameFromUrl("/docs/日本語.pdf"), "日本語.pdf");
  });

  it("is null for a path that ends in a folder", () => {
    assert.equal(filenameFromUrl("https://example.com/docs/"), null);
    assert.equal(filenameFromUrl("https://example.com"), null);
    assert.equal(filenameFromUrl(""), null);
  });

  it("is null for a segment that does not decode", () => {
    assert.equal(filenameFromUrl("/docs/100%.pdf"), null);
  });

  it("is null for a URL whose path names no file, as data and blob URLs", () => {
    assert.equal(filenameFromUrl("data:application/pdf;base64,JVBERi0xLjcK"), null);
    assert.equal(filenameFromUrl("blob:https://example.com/1b9d6bcd-bbfd-4b2d-9b5d"), null);
  });
});
