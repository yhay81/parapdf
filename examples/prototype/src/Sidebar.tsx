import {
  openAttachment,
  type PdfLayer,
  PdfThumbnail,
  setLayerVisible,
  usePdfState,
  usePdfViewer,
} from "parapdf";
import { OutlinePanel } from "./OutlinePanel.tsx";

export type SidebarView = "outline" | "thumbnails" | "layers" | "attachments";

/** The panel beside the pages: the outline, page thumbnails, layers, or attachments. */
export function Sidebar({ view, id }: { view: SidebarView; id: string }) {
  switch (view) {
    case "outline":
      return <OutlinePanel id={id} />;
    case "thumbnails":
      return <ThumbnailsPanel id={id} />;
    case "layers":
      return <LayersPanel id={id} />;
    case "attachments":
      return <AttachmentsPanel id={id} />;
  }
}

/** Every page as a thumbnail; each one is drawn only near the panel's visible part. */
function ThumbnailsPanel({ id }: { id: string }) {
  const viewer = usePdfViewer();
  const pageCount = usePdfState((state) => state.pageCount);
  const currentPage = usePdfState((state) => state.currentPage);
  const labels = usePdfState((state) => state.pageLabels);
  return (
    <nav id={id} className="sidebar thumbnails" aria-label="Page thumbnails">
      <ol>
        {Array.from({ length: pageCount }, (_, pageIndex) => {
          const label = labels?.[pageIndex] ?? String(pageIndex + 1);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: pages are identified by their index.
            <li key={pageIndex}>
              <button
                type="button"
                aria-label={`Page ${label}`}
                aria-current={pageIndex === currentPage ? "page" : undefined}
                onClick={() => viewer.goToPage(pageIndex)}
              >
                <PdfThumbnail pageIndex={pageIndex} width={120} />
                <span aria-hidden="true">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The document's layers as check boxes, nested as the document orders them. */
function LayersPanel({ id }: { id: string }) {
  const layers = usePdfState((state) => state.layers);
  if (!layers || layers.length === 0) return null;
  return (
    <section id={id} className="sidebar layers" aria-label="Layers">
      <LayerList layers={layers} />
    </section>
  );
}

function LayerList({ layers }: { layers: readonly PdfLayer[] }) {
  const viewer = usePdfViewer();
  return (
    <ul>
      {layers.map((layer, index) => (
        <li key={layer.id ?? `heading-${index}`}>
          {layer.id === null ? (
            <span className="heading">{layer.name || "Other layers"}</span>
          ) : (
            <label>
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={(event) => {
                  if (layer.id) setLayerVisible(viewer, layer.id, event.target.checked);
                }}
              />
              {layer.name}
            </label>
          )}
          {layer.children.length > 0 ? <LayerList layers={layer.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Files embedded in the document; activating one downloads it. */
function AttachmentsPanel({ id }: { id: string }) {
  const viewer = usePdfViewer();
  const attachments = usePdfState((state) => state.attachments);
  if (!attachments || attachments.length === 0) return null;
  return (
    <section id={id} className="sidebar attachments" aria-label="Attachments">
      <ul>
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <button
              type="button"
              title={attachment.description ?? undefined}
              onClick={() => void openAttachment(viewer, attachment)}
            >
              {attachment.filename}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
