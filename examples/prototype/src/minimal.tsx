/**
 * The demo without search, forms, annotation editing, and print, whose
 * build scripts/check-modules.ts checks for those features' code.
 */
import { PdfDocument, PdfViewport, usePdfNavigation, usePdfState, usePdfViewer } from "parapdf";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const file = new URLSearchParams(location.search).get("file") ?? "synthetic-text-1000.pdf";

function Toolbar() {
  const viewer = usePdfViewer();
  const { back, canGoBack } = usePdfNavigation();
  const page = usePdfState((state) => state.currentPage);
  const pageCount = usePdfState((state) => state.pageCount);
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

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <PdfDocument source={`/corpus/${file}`}>
      <Toolbar />
      <PdfViewport className="viewport" />
    </PdfDocument>
  </StrictMode>,
);
