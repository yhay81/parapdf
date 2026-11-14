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
  viewer.configure({ overscan: 1 });
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
  const afterViewportUpdate = async () => {
    // Exercise a queued viewport update even if the browser coalesces scroll
    // events. The second frame also lets the initial ResizeObserver update run.
    // A timer is not a barrier for either of these browser callbacks.
    viewer.scroller?.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  };
  const hasDynamicProbe = () => element.querySelector("section [data-overlay-probe]") !== null;
  const hasPortalProbe = () => element.querySelector("section [data-portal-probe]") !== null;
  const childCounter = { renders: 0 };
  const snapshot = () => {
    const { first, last, currentPage } = viewer.store.get();
    return {
      first,
      last,
      currentPage,
      scrollTop: viewer.scroller?.scrollTop ?? null,
      active: store.isActive(),
      hosts: [0, 1, 2, 3].filter((index) => store.hasHost(index)),
      pages: [...element.querySelectorAll<HTMLElement>("section")].map((page) => page.dataset.page),
      layers: element.querySelectorAll(".parapdf-overlay-layer").length,
      portal: hasPortalProbe(),
      dynamicPage4:
        element.querySelector('section[data-page="4"] [data-overlay-page="4"]') !== null,
    };
  };
  const diagnostics: Record<string, ReturnType<typeof snapshot>> = {};
  const inactive = () =>
    !store.isActive() &&
    [0, 1, 2, 3].every((index) => !store.hasHost(index)) &&
    element.querySelector(".parapdf-overlay-layer") === null;

  try {
    // 1. Idle viewer: zero overlay hosts or layers, and scrolling the page window does not re-render <PdfViewer> children.
    flushSync(() =>
      root.render(
        <SessionContext value={session}>
          <ViewerContext value={viewer}>
            <PdfViewer overscan={1} style={{ width: 800, height: 600 }}>
              <ChildProbe counter={childCounter} />
            </PdfViewer>
          </ViewerContext>
        </SessionContext>,
      ),
    );
    const idleSkipped = inactive();

    const rendersBeforeScroll = childCounter.renders;
    // Keep the scroll position and mounted range consistent. Writing first/last
    // directly leaves scrollTop at zero, so the next frame removes test pages.
    flushSync(() => viewer.goToPage(1));
    await afterViewportUpdate();
    diagnostics.scrolled = snapshot();
    const isolatedWindowCommit =
      childCounter.renders === rendersBeforeScroll &&
      viewer.store.get().currentPage === 1 &&
      element.querySelector('section[data-page="3"]') !== null &&
      element.querySelector('section[data-page="4"]') === null &&
      !store.hasHost(0) &&
      !store.hasHost(1) &&
      !store.hasHost(2);

    // 2. A single-page <PdfPageOverlay page={1}> activates ONLY page 1's overlay host, leaving page 2's host skipped;
    //    mounting <PdfPageOverlays> activates all mounted pages, including pages newly scrolled into view outside StrictMode.
    flushSync(() =>
      root.render(
        <SessionContext value={session}>
          <ViewerContext value={viewer}>
            <PdfViewer overscan={1} style={{ width: 800, height: 600 }}>
              <ChildProbe counter={childCounter} />
              <PdfPageOverlay page={1}>
                <span data-portal-probe>Portal overlay</span>
              </PdfPageOverlay>
            </PdfViewer>
          </ViewerContext>
        </SessionContext>,
      ),
    );
    const scoped = () =>
      store.isActive() &&
      store.hasHost(1) &&
      !store.hasHost(0) &&
      !store.hasHost(2) &&
      element.querySelector('section[data-page="3"]') !== null &&
      hasPortalProbe();
    const scopedAtCommit = scoped();
    await afterViewportUpdate();
    diagnostics.scoped = snapshot();
    const scopedPortalOnly = scopedAtCommit && scoped();

    flushSync(() =>
      root.render(
        <SessionContext value={session}>
          <ViewerContext value={viewer}>
            <PdfViewer overscan={1} style={{ width: 800, height: 600 }}>
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
    await afterViewportUpdate();
    const page4WasAbsent = element.querySelector('section[data-page="4"]') === null;
    // Mount page 4 for the first time with active overlays, outside StrictMode.
    flushSync(() => viewer.goToPage(2));
    const activated = () =>
      store.isActive() &&
      store.hasHost(1) &&
      store.hasHost(2) &&
      store.hasHost(3) &&
      hasPortalProbe() &&
      element.querySelector('section[data-page="4"] [data-overlay-page="4"]') !== null;
    const activeAtCommit = activated();
    diagnostics.liveCommit = snapshot();
    await afterViewportUpdate();
    diagnostics.liveAfterFrame = snapshot();
    const liveActivated = page4WasAbsent && activeAtCommit && activated();

    flushSync(() =>
      root.render(
        <SessionContext value={session}>
          <ViewerContext value={viewer}>
            <PdfViewer overscan={1} style={{ width: 800, height: 600 }}>
              <ChildProbe counter={childCounter} />
            </PdfViewer>
          </ViewerContext>
        </SessionContext>,
      ),
    );
    const inactiveAtCommit = inactive();
    await afterViewportUpdate();
    diagnostics.deactivated = snapshot();
    const liveDeactivated = inactiveAtCommit && inactive();

    // 3. StrictMode effect replay and <Activity> hide/restore preserve both <PdfPageOverlays> and <PdfPageOverlay>.
    const viewerWithOverlays = () => (
      <SessionContext value={session}>
        <ViewerContext value={viewer}>
          <PdfViewer overscan={1} style={{ width: 800, height: 600 }}>
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
    await afterViewportUpdate();
    diagnostics.strict = snapshot();
    const strict = hasDynamicProbe() && hasPortalProbe();

    const activity = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>{viewerWithOverlays()}</Activity>
    );
    flushSync(() => root.render(activity("visible")));
    flushSync(() => root.render(activity("hidden")));
    await afterViewportUpdate();
    diagnostics.hidden = snapshot();
    const hiddenCleaned = inactive();
    flushSync(() => root.render(activity("visible")));
    await afterViewportUpdate();
    diagnostics.restored = snapshot();
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
      scopedPortalOnly,
      liveActivated,
      liveDeactivated,
      strict,
      hiddenCleaned,
      restored,
      moved,
      diagnostics,
    };
  } finally {
    flushSync(() => root.unmount());
    element.remove();
  }
}
