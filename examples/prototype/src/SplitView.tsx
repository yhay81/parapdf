import {
  PdfDocument,
  type PdfSource,
  PdfViewport,
  usePdfState,
  usePdfViewer,
  type Viewer,
  type ViewerOptions,
} from "parapdf";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    __split?: { viewers: (Viewer | null)[] };
  }
}

/** M3 exercises the shared session through separate providers; M6 changes their React API. */
export default function SplitView({
  source,
  options,
}: {
  source: PdfSource;
  options: ViewerOptions;
}) {
  const [mounted, setMounted] = useState([true, true]);
  return (
    <main style={{ display: "flex", height: "100dvh", gap: 12 }}>
      {mounted.map((show, index) => (
        <div
          key={index === 0 ? "left" : "right"}
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
            <PdfDocument source={source} options={options}>
              <Pane index={index} />
            </PdfDocument>
          ) : null}
        </div>
      ))}
    </main>
  );
}

function Pane({ index }: { index: number }) {
  const viewer = usePdfViewer();
  const page = usePdfState((state) => state.currentPage);
  const scale = usePdfState((state) => state.scale);
  const status = usePdfState((state) => state.status);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    window.__split ??= { viewers: [null, null] };
    window.__split.viewers[index] = viewer;
    // Keep the closed instance available to the lifecycle probe.
  }, [index, viewer]);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 6 }}>
        <strong>{index === 0 ? "Left view" : "Right view"}</strong>
        <span aria-live="polite">
          {status === "ready" ? `Page ${page + 1}, ${Math.round(scale * 75)}%` : status}
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
        <PdfViewport
          label={index === 0 ? "Left PDF" : "Right PDF"}
          style={{ flex: 1, minHeight: 0 }}
        />
      ) : null}
    </>
  );
}
