import { type ScrollMode, type SpreadMode, usePdfState, usePdfViewer } from "parapdf";
import { useEffect, useState } from "react";
import { ZoomControls } from "../controls.tsx";

const SCROLL_MODES: readonly [ScrollMode, string][] = [
  ["vertical", "Vertical"],
  ["horizontal", "Horizontal"],
  ["wrapped", "Wrapped"],
  ["page", "Page by page"],
];

const SPREADS: readonly [SpreadMode, string][] = [
  ["none", "Single pages"],
  ["odd", "Spreads 1–2, 3–4"],
  ["even", "Spreads 1, 2–3"],
];

/** The page as a number to type, between the previous and next buttons. */
function PageNumber() {
  const viewer = usePdfViewer();
  const page = usePdfState((state) => state.currentPage);
  const pageCount = usePdfState((state) => state.pageCount);
  const label = usePdfState((state) => state.pageLabels?.[state.currentPage] ?? null);
  const [value, setValue] = useState(String(page + 1));
  useEffect(() => setValue(String(page + 1)), [page]);
  return (
    <>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 0}
        onClick={() => viewer.previousPage()}
      >
        ←
      </button>
      <form
        className="demo-page"
        onSubmit={(event) => {
          event.preventDefault();
          const index = Number(value) - 1;
          if (Number.isInteger(index)) viewer.goToPage(Math.min(Math.max(index, 0), pageCount - 1));
        }}
      >
        <input
          aria-label="Page"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setValue(String(page + 1))}
        />
        <span>
          / {pageCount}
          {label && label !== String(page + 1) ? ` (${label})` : ""}
        </span>
      </form>
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pageCount - 1}
        onClick={() => viewer.nextPage()}
      >
        →
      </button>
    </>
  );
}

/** How the pages are shown, and what to do with the document. */
export function ViewBar({
  annotating,
  onAnnotatingChange,
}: {
  annotating: boolean;
  onAnnotatingChange: (annotating: boolean) => void;
}) {
  const viewer = usePdfViewer();
  const scrollMode = usePdfState((state) => state.scrollMode);
  const spread = usePdfState((state) => state.spread);
  const tool = usePdfState((state) => state.tool);
  const ready = usePdfState((state) => state.status === "ready");
  const canBack = usePdfState((state) => state.canGoBack);
  const canForward = usePdfState((state) => state.canGoForward);
  return (
    <div className="demo-toolbar" role="toolbar" aria-label="View">
      <PageNumber />
      <span className="demo-group">
        <button type="button" aria-label="Back" disabled={!canBack} onClick={() => viewer.back()}>
          ↶
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!canForward}
          onClick={() => viewer.forward()}
        >
          ↷
        </button>
      </span>
      <span className="demo-group">
        <ZoomControls />
      </span>
      <button type="button" onClick={() => viewer.rotate(90)}>
        Rotate
      </button>
      <label>
        <span className="demo-visually-hidden">Scroll mode</span>
        <select
          value={scrollMode}
          onChange={(event) => viewer.setScrollMode(event.target.value as ScrollMode)}
        >
          {SCROLL_MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="demo-visually-hidden">Spreads</span>
        <select
          value={spread}
          onChange={(event) => viewer.setSpread(event.target.value as SpreadMode)}
        >
          {SPREADS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-pressed={tool === "hand"}
        onClick={() => viewer.setTool(tool === "hand" ? "select" : "hand")}
      >
        Hand tool
      </button>
      <button
        type="button"
        aria-pressed={annotating}
        onClick={() => onAnnotatingChange(!annotating)}
      >
        Annotate
      </button>
      <span className="demo-spacer" />
      <button type="button" disabled={!ready} onClick={() => void viewer.download()}>
        Download
      </button>
      <button type="button" disabled={!ready} onClick={() => void viewer.print()}>
        Print
      </button>
    </div>
  );
}
