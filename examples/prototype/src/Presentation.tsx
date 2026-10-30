import type { ScrollMode, Viewer, Zoom } from "parapdf";
import { useEffect, useRef, useState } from "react";

/**
 * A presentation mode, as the site's layout guide builds it: the stage it
 * returns goes full screen, and while it is, the viewer shows its document a
 * page at a time, fitted, and goes back to its scroll mode and zoom after.
 */
export function usePresentation(viewer: Viewer) {
  const stage = useRef<HTMLDivElement>(null);
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    // The view to go back to; the page stays the one the reader turned to.
    let before: { scrollMode: ScrollMode; zoom: Zoom } | null = null;
    const onChange = () => {
      const now = document.fullscreenElement === stage.current;
      setPresenting(now);
      if (now && !before) {
        const { scrollMode, zoomMode, scale } = viewer.store.get();
        before = { scrollMode, zoom: zoomMode === "custom" ? scale : zoomMode };
        viewer.setScrollMode("page");
        viewer.setScale("fit-page");
        // The viewer's keys turn the pages while the viewport has focus.
        viewer.scroller?.focus({ preventScroll: true });
      } else if (!now && before) {
        viewer.setScrollMode(before.scrollMode);
        viewer.setScale(before.zoom);
        before = null;
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [viewer]);
  const present = () => void stage.current?.requestFullscreen();
  return { stage, presenting, present };
}

/** The controls shown over the pages while they are presented. */
export function PresentationControls({ viewer }: { viewer: Viewer }) {
  return (
    // A click leaves the focus in the viewport, whose keys turn the pages.
    <div
      role="toolbar"
      aria-label="Presentation"
      className="presentation-controls"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={() => viewer.previousPage()} aria-label="Previous page">
        ‹
      </button>
      <button type="button" onClick={() => viewer.nextPage()} aria-label="Next page">
        ›
      </button>
      <button type="button" onClick={() => void document.exitFullscreen()}>
        Exit
      </button>
    </div>
  );
}
