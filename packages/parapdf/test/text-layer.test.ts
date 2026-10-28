import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { outOfDocument } from "../src/pdfjs/text.ts";
import { FakeDocument, type FakeElement } from "./fake-dom.ts";

function page(): {
  host: FakeElement;
  drawings: FakeElement;
  text: FakeElement;
  links: FakeElement;
} {
  const document = new FakeDocument();
  const host = document.createElement("section");
  const [drawings, text, links] = ["drawings", "text", "links"].map((name) => {
    const element = document.createElement("div");
    element.className = name;
    return element;
  }) as [FakeElement, FakeElement, FakeElement];
  host.append(drawings, text, links);
  return { host, drawings, text, links };
}

const order = (host: FakeElement) => host.children.map((child) => child.className);

describe("a text layer built out of the document", () => {
  it("leaves while pdf.js fills it and goes back where it was", () => {
    const { host, text } = page();
    const restore = outOfDocument(text as unknown as HTMLElement);
    assert.deepEqual(order(host), ["drawings", "links"]);
    restore();
    assert.deepEqual(order(host), ["drawings", "text", "links"]);
  });

  it("stays out when the page unmounted meanwhile", () => {
    const { host, drawings, text, links } = page();
    const restore = outOfDocument(text as unknown as HTMLElement);
    drawings.remove();
    links.remove();
    restore();
    assert.deepEqual(order(host), []);
    assert.equal(text.parent, null);
  });

  it("is left alone when something else put it back first", () => {
    const { host, text } = page();
    const restore = outOfDocument(text as unknown as HTMLElement);
    host.append(text);
    restore();
    assert.deepEqual(order(host), ["drawings", "links", "text"]);
  });
});
