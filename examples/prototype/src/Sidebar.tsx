import {
  openAttachment,
  type PdfLayer,
  PdfThumbnails,
  setLayerVisible,
  useAttachments,
  useLayers,
  usePageLabels,
  useViewer,
  type Viewer,
} from "parapdf";
import { Suspense } from "react";
import { OutlinePanel } from "./OutlinePanel.tsx";

export type SidebarView = "outline" | "thumbnails" | "layers" | "attachments";

/** The panel beside the pages: the outline, page thumbnails, layers, or attachments. */
export function Sidebar({ view, id }: { view: SidebarView; id: string }) {
  // The document's data loads apart from the pages, which never wait for it.
  return <Suspense fallback={null}>{panel(view, id)}</Suspense>;
}

function panel(view: SidebarView, id: string) {
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

/** Every page as a thumbnail, named by its label; each is drawn only near the panel's visible part. */
function ThumbnailsPanel({ id }: { id: string }) {
  const labels = usePageLabels();
  return (
    <div id={id} className="sidebar thumbnails">
      <PdfThumbnails pageLabel={(pageNumber) => `Page ${labels?.[pageNumber - 1] ?? pageNumber}`} />
    </div>
  );
}

/** The document's layers as check boxes, nested as the document orders them. */
function LayersPanel({ id }: { id: string }) {
  const viewer = useViewer();
  const layers = useLayers();
  if (layers.length === 0) return null;
  return (
    <section id={id} className="sidebar layers" aria-label="Layers">
      <LayerList viewer={viewer} layers={layers} />
    </section>
  );
}

function LayerList({ viewer, layers }: { viewer: Viewer; layers: readonly PdfLayer[] }) {
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
          {layer.children.length > 0 ? <LayerList viewer={viewer} layers={layer.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Files embedded in the document; activating one downloads it. */
function AttachmentsPanel({ id }: { id: string }) {
  const viewer = useViewer();
  const attachments = useAttachments();
  if (attachments.length === 0) return null;
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
