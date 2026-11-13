import {
  openAttachment,
  type PdfLayer,
  PdfOutline,
  type PdfSession,
  PdfThumbnails,
  setLayerVisible,
  useAttachments,
  useLayers,
  useSession,
} from "parapdf";
import { Suspense } from "react";

export type SidebarView = "outline" | "thumbnails" | "layers" | "attachments";

/** The panel beside the pages: the outline, page thumbnails, layers, or attachments. */
export function Sidebar({ view, id }: { view: SidebarView; id: string }) {
  // Thumbnails mount immediately without suspending; the document's secondary
  // data loads under Suspense apart from the pages.
  if (view === "thumbnails") {
    return (
      <div id={id} className="sidebar thumbnails">
        <PdfThumbnails />
      </div>
    );
  }
  return <Suspense fallback={null}>{panel(view, id)}</Suspense>;
}

function panel(view: Exclude<SidebarView, "thumbnails">, id: string) {
  switch (view) {
    case "outline":
      return <PdfOutline id={id} className="sidebar outline" />;
    case "layers":
      return <LayersPanel id={id} />;
    case "attachments":
      return <AttachmentsPanel id={id} />;
  }
}

/** The document's layers as check boxes, nested as the document orders them. */
function LayersPanel({ id }: { id: string }) {
  const session = useSession();
  const layers = useLayers();
  if (layers.length === 0) return null;
  return (
    <section id={id} className="sidebar layers" aria-label="Layers">
      <LayerList session={session} layers={layers} />
    </section>
  );
}

function LayerList({ session, layers }: { session: PdfSession; layers: readonly PdfLayer[] }) {
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
                  if (layer.id) setLayerVisible(session, layer.id, event.target.checked);
                }}
              />
              {layer.name}
            </label>
          )}
          {layer.children.length > 0 ? (
            <LayerList session={session} layers={layer.children} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Files embedded in the document; activating one downloads it. */
function AttachmentsPanel({ id }: { id: string }) {
  const session = useSession();
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
              onClick={() => void openAttachment(session, attachment)}
            >
              {attachment.filename}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
