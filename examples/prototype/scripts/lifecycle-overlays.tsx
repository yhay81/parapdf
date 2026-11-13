import { PdfPageOverlays } from "parapdf";
import { Activity, StrictMode, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { overlayStoreOf, usePageOverlays } from "../../../packages/parapdf/src/react/overlays.ts";
import { ViewerController } from "../../../packages/parapdf/src/view/viewer.ts";

function PageHost({ viewer }: { viewer: ViewerController }) {
  const host = useRef<HTMLElement | null>(null);
  const portal = usePageOverlays(viewer, 0, host, { viewer, pageIndex: 0 }, 0, 612, 792);
  return <section ref={host}>{portal}</section>;
}

/** Exercise real React effect replay and viewer changes without waiting for a PDF. */
export async function checkOverlayLifetimes() {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const viewer = new ViewerController();
  const other = new ViewerController();
  const store = overlayStoreOf(viewer);
  store.setRenderer("fixture", () => <span data-overlay-probe>Visible overlay</span>);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  const visible = () => element.querySelector("section [data-overlay-probe]") !== null;
  try {
    flushSync(() =>
      root.render(
        <StrictMode>
          <PageHost viewer={viewer} />
        </StrictMode>,
      ),
    );
    await tick();
    const strict = visible();
    const activity = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <PageHost viewer={viewer} />
      </Activity>
    );
    flushSync(() => root.render(activity("visible")));
    flushSync(() => root.render(activity("hidden")));
    await tick();
    flushSync(() => root.render(activity("visible")));
    await tick();
    const restored = visible();

    const render = () => "overlay";
    const renderers = (target: ViewerController) => (
      <>
        <PdfPageOverlays viewer={target}>{render}</PdfPageOverlays>
        <PdfPageOverlays viewer={other}>{render}</PdfPageOverlays>
      </>
    );
    flushSync(() => root.render(renderers(viewer)));
    flushSync(() => root.render(renderers(other)));
    const moved = overlayStoreOf(other).getRenderers().length === 2;
    return { strict, restored, moved };
  } finally {
    flushSync(() => root.unmount());
    element.remove();
  }
}
