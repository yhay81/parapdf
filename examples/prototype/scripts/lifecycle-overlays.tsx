import { PdfPageOverlay, PdfPageOverlays, PdfViewer } from "parapdf";
import { Activity, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { PdfSessionController } from "../../../packages/parapdf/src/document/pdf-session.ts";
import { SessionContext, ViewerContext } from "../../../packages/parapdf/src/react/context.ts";
import { overlayStoreOf } from "../../../packages/parapdf/src/react/overlays.ts";
import { computeLayout } from "../../../packages/parapdf/src/view/layout.ts";
import { ViewerController } from "../../../packages/parapdf/src/view/viewer.ts";

function setupLaidOutViewer(pageCount = 4): {
  session: PdfSessionController;
  viewer: ViewerController;
} {
  const session = new PdfSessionController({ url: "/overlay-lifetimes.pdf" });
  const viewer = new ViewerController();
  const sizes = Array.from({ length: pageCount }, () => ({ width: 612, height: 792 }));
  const layout = computeLayout(sizes, 1, {
    gap: 12,
    rotation: 0,
    spread: "none",
    scrollMode: "vertical",
    direction: "ltr",
    viewportWidth: 800,
    page: 0,
  });
  viewer.open(session);
  viewer.store.set({ layout, scale: 1, first: 0, last: 1, currentPage: 0 });
  return { session, viewer };
}

function ChildProbe({ counter }: { counter: { renders: number } }) {
  counter.renders++;
  return null;
}

/** Exercise real `<PdfViewer>` page-window isolation, idle overlay skipping, StrictMode, and `<Activity>`. */
export async function checkOverlayLifetimes() {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const { session, viewer } = setupLaidOutViewer(4);
  const other = new ViewerController();
  const store = overlayStoreOf(viewer);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  const hasDynamicProbe = () => element.querySelector("section [data-overlay-probe]") !== null;
  const hasPortalProbe = () => element.querySelector("section [data-portal-probe]") !== null;
  const childCounter = { renders: 0 };

  try {
    // 1. Idle viewer: zero overlay hosts or layers, and scrolling the page window does not re-render <PdfViewer> children.
    flushSync(() =>
      root.render(
        <SessionContext value={session}>
          <ViewerContext value={viewer}>
            <PdfViewer style={{ width: 800, height: 600 }}>
              <ChildProbe counter={childCounter} />
            </PdfViewer>
          </ViewerContext>
        </SessionContext>,
      ),
    );
    const idleSkipped =
      !store.isActive() &&
      !store.hasHost(0) &&
      !store.hasHost(1) &&
      element.querySelector(".parapdf-overlay-layer") === null;

    const rendersBeforeScroll = childCounter.renders;
    flushSync(() => viewer.store.set({ first: 1, last: 2, currentPage: 1 }));
    const isolatedWindowCommit =
      childCounter.renders === rendersBeforeScroll &&
      element.querySelector('section[data-page="1"]') === null &&
      element.querySelector('section[data-page="3"]') !== null &&
      !store.hasHost(1) &&
      !store.hasHost(2);

    // 2. A single-page <PdfPageOverlay page={1}> activates ONLY page 1's overlay host, leaving page 2's host skipped;
    //    mounting <PdfPageOverlays> activates all mounted pages, including pages newly scrolled into view outside StrictMode.
    flushSync(() =>
      root.render(
        <SessionContext value={session}>
          <ViewerContext value={viewer}>
            <PdfViewer style={{ width: 800, height: 600 }}>
              <ChildProbe counter={childCounter} />
              <PdfPageOverlay page={1}>
                <span data-portal-probe>Portal overlay</span>
              </PdfPageOverlay>
            </PdfViewer>
          </ViewerContext>
        </SessionContext>,
      ),
    );
    await tick();
    const scopedPortalOnly = store.hasHost(1) && !store.hasHost(2) && hasPortalProbe();

    flushSync(() =>
      root.render(
        <SessionContext value={session}>
          <ViewerContext value={viewer}>
            <PdfViewer style={{ width: 800, height: 600 }}>
              <ChildProbe counter={childCounter} />
              <PdfPageOverlay page={1}>
                <span data-portal-probe>Portal overlay</span>
              </PdfPageOverlay>
              <PdfPageOverlays>
                {(pageIndex) => (
                  <span data-overlay-probe data-overlay-page={pageIndex + 1}>
                    Dynamic overlay
                  </span>
                )}
              </PdfPageOverlays>
            </PdfViewer>
          </ViewerContext>
        </SessionContext>,
      ),
    );
    await tick();
    // Scroll to mount page 4 (index 3) for the first time while overlays are already active (production non-StrictMode mount order).
    flushSync(() => viewer.store.set({ first: 1, last: 3, currentPage: 2 }));
    await tick();
    const liveActivated =
      scopedPortalOnly &&
      store.isActive() &&
      store.hasHost(3) &&
      hasPortalProbe() &&
      element.querySelector('section[data-page="4"] [data-overlay-page="4"]') !== null;

    flushSync(() =>
      root.render(
        <SessionContext value={session}>
          <ViewerContext value={viewer}>
            <PdfViewer style={{ width: 800, height: 600 }}>
              <ChildProbe counter={childCounter} />
            </PdfViewer>
          </ViewerContext>
        </SessionContext>,
      ),
    );
    await tick();
    const liveDeactivated =
      !store.isActive() &&
      !store.hasHost(1) &&
      !store.hasHost(2) &&
      !store.hasHost(3) &&
      element.querySelector(".parapdf-overlay-layer") === null;

    // 3. StrictMode effect replay and <Activity> hide/restore preserve both <PdfPageOverlays> and <PdfPageOverlay>.
    const viewerWithOverlays = () => (
      <SessionContext value={session}>
        <ViewerContext value={viewer}>
          <PdfViewer style={{ width: 800, height: 600 }}>
            <PdfPageOverlay page={1}>
              <span data-portal-probe>Portal overlay</span>
            </PdfPageOverlay>
            <PdfPageOverlays>
              {(pageIndex) =>
                pageIndex === 1 ? <span data-overlay-probe>Visible overlay</span> : null
              }
            </PdfPageOverlays>
          </PdfViewer>
        </ViewerContext>
      </SessionContext>
    );

    flushSync(() => root.render(<StrictMode>{viewerWithOverlays()}</StrictMode>));
    await tick();
    const strict = hasDynamicProbe() && hasPortalProbe();

    const activity = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>{viewerWithOverlays()}</Activity>
    );
    flushSync(() => root.render(activity("visible")));
    flushSync(() => root.render(activity("hidden")));
    await tick();
    flushSync(() => root.render(activity("visible")));
    await tick();
    const restored = hasDynamicProbe() && hasPortalProbe();

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
    return {
      idleSkipped,
      isolatedWindowCommit,
      liveActivated,
      liveDeactivated,
      strict,
      restored,
      moved,
    };
  } finally {
    flushSync(() => root.unmount());
    element.remove();
  }
}
