/**
 * The demo without search, forms, annotation editing, and print, whose
 * build scripts/check-modules.ts checks for those features' code.
 */
import { PdfDocument, PdfViewer, useHistory, useViewer, useViewState, type Viewer } from "parapdf";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const file = new URLSearchParams(location.search).get("file") ?? "synthetic-text-1000.pdf";

function Toolbar({ viewer }: { viewer: Viewer }) {
  const { back, canGoBack } = useHistory(viewer);
  const page = useViewState(viewer, (state) => state.currentPage);
  const pageCount = useViewState(viewer, (state) => state.layout?.sizes.length ?? 0);
  return (
    <header style={{ display: "flex", gap: 8, padding: 8 }}>
      <button type="button" onClick={back} disabled={!canGoBack}>
        Back
      </button>
      <button type="button" onClick={() => viewer.previousPage()}>
        Previous
      </button>
      <span>
        {page + 1} / {pageCount}
      </span>
      <button type="button" onClick={() => viewer.nextPage()}>
        Next
      </button>
    </header>
  );
}

function Minimal() {
  const viewer = useViewer();
  return (
    <PdfDocument source={`/corpus/${file}`}>
      <Toolbar viewer={viewer} />
      <PdfViewer viewer={viewer} className="viewport" />
    </PdfDocument>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <Minimal />
  </StrictMode>,
);
