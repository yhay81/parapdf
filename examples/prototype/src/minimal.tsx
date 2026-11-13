/**
 * The demo without search, forms, annotation editing, and print, whose
 * build scripts/check-modules.ts checks for those features' code.
 */
import { PdfDocument, PdfViewer, useHistory, useViewer, useViewState } from "parapdf";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const file = new URLSearchParams(location.search).get("file") ?? "usrguide.pdf";

function Toolbar() {
  const viewer = useViewer();
  const { back, canGoBack } = useHistory();
  const { currentPage: page, pageCount } = useViewState();
  return (
    <header className="toolbar">
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
  return (
    <PdfDocument source={`/corpus/${file}`}>
      <Toolbar />
      <PdfViewer className="viewport" />
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
