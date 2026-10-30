import {
  type AnnotationEditing,
  PdfDocument,
  type PdfSource,
  PdfViewer,
  type PdfViewerProps,
  type Search,
  searchOf,
  useAnnotationEditing,
  useDocumentState,
  useViewer,
  useViewState,
  type Viewer,
} from "parapdf";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    __split?: {
      viewers: (Viewer | null)[];
      searches: (Search | null)[];
      annotations: (AnnotationEditing | null)[];
    };
  }
}

const probes = () => {
  window.__split ??= { viewers: [null, null], searches: [null, null], annotations: [null, null] };
  return window.__split;
};

/** Two viewers of one document under one provider, each closed or hidden on its own. */
export default function SplitView({
  source,
  passwordPrompt,
  viewerProps,
}: {
  source: PdfSource;
  passwordPrompt: boolean;
  viewerProps: PdfViewerProps;
}) {
  const [open, setOpen] = useState(true);
  const [mounted, setMounted] = useState([true, true]);
  return (
    <main className="split" style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? "Close document" : "Open document"}
      </button>
      {open ? (
        <PdfDocument source={source} passwordPrompt={passwordPrompt}>
          <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 12 }}>
            {mounted.map((show, index) => (
              <div
                key={index === 0 ? "left" : "right"}
                className="split"
                data-viewer={index}
                style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setMounted((values) => values.map((value, i) => (i === index ? !value : value)))
                  }
                >
                  {show ? "Close viewer" : "Open viewer"}
                </button>
                {show ? <Pane index={index} viewerProps={viewerProps} /> : null}
              </div>
            ))}
          </div>
        </PdfDocument>
      ) : null}
    </main>
  );
}

function Pane({ index, viewerProps }: { index: number; viewerProps: PdfViewerProps }) {
  const viewer = useViewer();
  const page = useViewState(viewer, (state) => state.currentPage);
  const scale = useViewState(viewer, (state) => state.scale);
  const shown = useViewState(viewer, (state) => state.layout !== null);
  const status = useDocumentState((state) => state.status);
  const [visible, setVisible] = useState(true);
  const annotations = useAnnotationEditing(viewer);
  // For the checks; a closed pane's viewer stays for the lifecycle probe.
  probes().searches[index] = searchOf(viewer);
  probes().annotations[index] = annotations;
  useEffect(() => {
    probes().viewers[index] = viewer;
  }, [index, viewer]);
  return (
    <>
      <div className="split-bar">
        <strong>{index === 0 ? "Left view" : "Right view"}</strong>
        <span aria-live="polite">
          {shown ? `Page ${page + 1}, ${Math.round(scale * 75)}%` : status}
        </span>
        <button type="button" onClick={() => viewer.previousPage()}>
          Previous
        </button>
        <button type="button" onClick={() => viewer.nextPage()}>
          Next
        </button>
        <button type="button" onClick={() => viewer.zoomBy(1 / 1.25)}>
          Zoom out
        </button>
        <button type="button" onClick={() => viewer.zoomBy(1.25)}>
          Zoom in
        </button>
        <button type="button" onClick={() => viewer.rotate(90)}>
          Rotate
        </button>
        <button type="button" onClick={() => setVisible((value) => !value)}>
          {visible ? "Hide viewport" : "Show viewport"}
        </button>
      </div>
      {visible ? (
        <PdfViewer
          {...viewerProps}
          viewer={viewer}
          label={index === 0 ? "Left PDF" : "Right PDF"}
          style={{ flex: 1, minHeight: 0 }}
        />
      ) : null}
    </>
  );
}
