import {
  type AnnotationEditing,
  PdfDocument,
  type PdfSource,
  PdfView,
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
import { useRef, useState } from "react";
import { type DemoFeatures, ViewerFeatures } from "./ViewerFeatures.tsx";

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
  features,
}: {
  source: PdfSource;
  passwordPrompt: boolean;
  viewerProps: PdfViewerProps;
  features: DemoFeatures;
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
                {show ? (
                  <PdfView
                    ref={(viewer) => {
                      if (viewer) probes().viewers[index] = viewer;
                    }}
                  >
                    <ColdBadge />
                    <Pane index={index} viewerProps={viewerProps} features={features} />
                  </PdfView>
                ) : null}
              </div>
            ))}
          </div>
        </PdfDocument>
      ) : null}
    </main>
  );
}

function Pane({
  index,
  viewerProps,
  features,
}: {
  index: number;
  viewerProps: PdfViewerProps;
  features: DemoFeatures;
}) {
  const viewer = useViewer();
  const { currentPage: page, scale, layout } = useViewState();
  const shown = layout !== null;
  const { status } = useDocumentState();
  const [visible, setVisible] = useState(true);
  const annotations = useAnnotationEditing();
  // For the checks; a closed pane's viewer stays for the lifecycle probe.
  probes().searches[index] = searchOf(viewer);
  probes().annotations[index] = annotations;
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
          label={index === 0 ? "Left PDF" : "Right PDF"}
          style={{ flex: 1, minHeight: 0 }}
        >
          <ViewerFeatures features={features} />
        </PdfViewer>
      ) : null}
    </>
  );
}

/** Reads only cold fields (`pageCount` and `rotation`) through getter-tracked `useViewState()`. */
function ColdBadge() {
  const renders = useRef(0);
  renders.current++;
  const { pageCount, rotation } = useViewState();
  return (
    <span data-cold-renders={renders.current} hidden>
      {pageCount}:{rotation}
    </span>
  );
}
