import assert from "node:assert/strict";
import { it } from "node:test";
import { attachFormLayers } from "../src/features/forms/layers.ts";
import { Viewer } from "../src/view/viewer.ts";
import { fakePdfjs, settle, show } from "./fake-pdfjs.ts";

it("collects the provider, document and input bytes after unmount with a surviving viewer", async () => {
  assert.ok(globalThis.gc, "run the package tests with --expose-gc");
  const viewer = new Viewer();
  attachFormLayers(viewer);
  async function mountAndRemove() {
    const data = new Uint8Array(1024);
    const { session, close } = show(viewer, { data }, fakePdfjs().loader);
    await settle();
    const open = viewer.session;
    assert.ok(open);
    const refs = [new WeakRef(data), new WeakRef(session), new WeakRef(open)];
    close();
    return refs;
  }
  const refs = await mountAndRemove();
  // Let the registry close its last lease before testing the viewer's references.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  for (let i = 0; i < 5; i++) {
    await settle();
    globalThis.gc();
  }
  assert.equal(viewer.session, null);
  assert.deepEqual(refs.map((ref) => Boolean(ref.deref())), [false, false, false]);
});
