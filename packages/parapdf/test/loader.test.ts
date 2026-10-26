import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { configurePdfjs, documentRequestMode } from "../src/pdfjs/loader.ts";

describe("documentRequestMode", () => {
  afterEach(() => configurePdfjs({}));

  it("preloads a plain URL anonymously", () => {
    assert.equal(documentRequestMode({}), "anonymous");
  });

  it("preloads with credentials when the source or documentOptions sends them", () => {
    assert.equal(documentRequestMode({ withCredentials: true }), "use-credentials");
    configurePdfjs({ documentOptions: { withCredentials: true } });
    assert.equal(documentRequestMode({}), "use-credentials");
    // The source's own setting replaces documentOptions', as in the request.
    assert.equal(documentRequestMode({ withCredentials: false }), "anonymous");
  });

  it("skips the preload when the request carries headers", () => {
    assert.equal(documentRequestMode({ httpHeaders: { Authorization: "Bearer t" } }), null);
    configurePdfjs({ documentOptions: { httpHeaders: { Authorization: "Bearer t" } } });
    assert.equal(documentRequestMode({}), null);
  });

  it("skips the preload without streaming", () => {
    configurePdfjs({ documentOptions: { disableStream: true } });
    assert.equal(documentRequestMode({}), null);
  });
});
