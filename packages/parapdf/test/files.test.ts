import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { downloadBytes, filenameFromUrl } from "../src/view/files.ts";

describe("filenameFromUrl", () => {
  it("extracts and decodes the path's last segment, stripping query and fragment", () => {
    assert.equal(filenameFromUrl("https://example.com/docs/report.pdf?v=2#page=3"), "report.pdf");
    assert.equal(filenameFromUrl("/files/a.pdf"), "a.pdf");
    assert.equal(filenameFromUrl("a.pdf#zoom=200"), "a.pdf");
    assert.equal(filenameFromUrl("file:///C:/Users/me/b.pdf"), "b.pdf");
    assert.equal(
      filenameFromUrl("/docs/annual%20report%E2%80%942024.pdf"),
      "annual report—2024.pdf",
    );
    assert.equal(filenameFromUrl("/docs/日本語.pdf"), "日本語.pdf");
  });

  it("returns null for folders, non-decodable segments, and URLs without file paths", () => {
    assert.equal(filenameFromUrl("https://example.com/docs/"), null);
    assert.equal(filenameFromUrl("https://example.com"), null);
    assert.equal(filenameFromUrl(""), null);
    assert.equal(filenameFromUrl("/docs/100%.pdf"), null);
    assert.equal(filenameFromUrl("data:application/pdf;base64,JVBERi0xLjcK"), null);
    assert.equal(filenameFromUrl("blob:https://example.com/1b9d6bcd-bbfd-4b2d-9b5d"), null);
  });
});

describe("downloadBytes", () => {
  it("creates a hidden download link, clicks and removes it, and revokes the blob URL after 60s", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    const events: string[] = [];
    const createdTags: string[] = [];
    const link = {
      href: "",
      download: "",
      style: { display: "" },
      click() {
        events.push(`click:${this.href}:${this.download}:${this.style.display}`);
      },
      remove() {
        events.push("remove");
      },
    };
    const previousDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement(tag: string) {
          createdTags.push(tag);
          return link;
        },
        body: {
          append(node: unknown) {
            if (node === link) events.push("append");
          },
        },
      },
    });
    t.after(() => {
      if (previousDoc) Object.defineProperty(globalThis, "document", previousDoc);
      else Reflect.deleteProperty(globalThis, "document");
    });
    let urls = 0;
    t.mock.method(URL, "createObjectURL", (blob: Blob) => {
      blobs.push(blob);
      return `blob:download-${++urls}`;
    });
    t.mock.method(URL, "revokeObjectURL", (url: string) => revoked.push(url));

    downloadBytes(new Uint8Array([37, 80, 68, 70]), "report.pdf");
    downloadBytes(new Uint8Array([1, 2]), "custom.bin", "application/pdf");

    assert.deepEqual(createdTags, ["a", "a"]);
    assert.equal(blobs[0]?.type, "application/octet-stream");
    assert.deepEqual(
      new Uint8Array(await blobs[0].arrayBuffer()),
      new Uint8Array([37, 80, 68, 70]),
    );
    assert.equal(blobs[1]?.type, "application/pdf");
    assert.deepEqual(events, [
      "append",
      "click:blob:download-1:report.pdf:none",
      "remove",
      "append",
      "click:blob:download-2:custom.bin:none",
      "remove",
    ]);

    t.mock.timers.tick(59_999);
    assert.deepEqual(revoked, []);
    t.mock.timers.tick(1);
    assert.deepEqual(revoked, ["blob:download-1", "blob:download-2"]);
  });
});
