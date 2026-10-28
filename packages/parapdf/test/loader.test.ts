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

  it("skips the preload in WebKit, where a fetch downloads it again", () => {
    const agents = {
      safari:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Safari/605.1.15",
      iosChrome:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.0.0 Mobile/15E148 Safari/604.1",
      chrome:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
      firefox:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0",
    };
    assert.equal(documentRequestMode({}, agents.safari), null);
    assert.equal(documentRequestMode({}, agents.iosChrome), null);
    assert.equal(documentRequestMode({}, agents.chrome), "anonymous");
    assert.equal(documentRequestMode({}, agents.firefox), "anonymous");
    // A server, which cannot tell the browser, keeps it.
    assert.equal(documentRequestMode({}, undefined), "anonymous");
  });
});
