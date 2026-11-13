import { PdfThumbnails } from "parapdf";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { OutlineTree } from "../../../packages/parapdf/src/react/outline.ts";
import { computeLayout } from "../../../packages/parapdf/src/view/layout.ts";
import { Viewer } from "../../../packages/parapdf/src/view/viewer.ts";

/** Check navigation controls with real layout and React, without drawing PDF pixels. */
export async function checkNavigationControls() {
  const element = document.createElement("div");
  element.id = "navigation-controls-fixture";
  document.body.append(element);
  const root = createRoot(element);
  const viewer = new Viewer();
  const sizes = Array.from({ length: 1000 }, () => ({ width: 612, height: 792 }));
  const layout = computeLayout(sizes, 1, {
    gap: 12,
    rotation: 0,
    spread: "none",
    scrollMode: "vertical",
    direction: "ltr",
    viewportWidth: 800,
    page: 500,
  });
  viewer.store.set({ layout, currentPage: 500 });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
  const thumbnails = (width: number) => (
    <>
      <style>{`#navigation-controls-fixture ol { margin: 0; padding: 0; list-style: none; }
      #navigation-controls-fixture li button { display: block; padding: 10px; }
      #navigation-controls-fixture li span { display: block; height: 20px; }`}</style>
      <PdfThumbnails viewer={viewer} width={width} style={{ height: 400, overflow: "auto" }} />
    </>
  );
  const activeInView = () => {
    const nav = element.querySelector("nav")?.getBoundingClientRect();
    const active = element.querySelector('[aria-current="page"]')?.getBoundingClientRect();
    return Boolean(nav && active && active.top >= nav.top - 2 && active.bottom <= nav.bottom + 2);
  };
  try {
    const started = performance.now();
    flushSync(() => root.render(thumbnails(120)));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const openedMs = performance.now() - started;
    const mountedItems = element.querySelectorAll("li").length;
    const opened = activeInView();
    flushSync(() => viewer.store.set({ rotation: 90 }));
    await tick();
    const rotated = activeInView();
    flushSync(() => root.render(thumbnails(160)));
    await tick();
    const resized = activeInView();
    const scroller = element.querySelector("nav");
    if (scroller) scroller.scrollTop = 0;
    await tick();
    const browsed = scroller?.scrollTop === 0;

    const leaf = { title: "Child", dest: null, url: null, bold: false, italic: false, items: [] };
    flushSync(() =>
      root.render(
        <OutlineTree
          viewer={viewer}
          defaultExpanded={false}
          items={[{ ...leaf, title: "Chapter", items: [leaf] }]}
        />,
      ),
    );
    const toggle = element.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    flushSync(() => toggle?.click());
    const expanded = element.textContent?.includes("Child") === true;
    return { opened, rotated, resized, browsed, expanded, openedMs, mountedItems };
  } finally {
    flushSync(() => root.unmount());
    element.remove();
  }
}
