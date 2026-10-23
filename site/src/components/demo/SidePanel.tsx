import {
  type OutlineNode,
  type PdfLayer,
  PdfThumbnail,
  usePdfNavigation,
  usePdfOutline,
  usePdfState,
  usePdfViewer,
} from "parapdf";
import { corpusReadme } from "../../samples.ts";
import type { Opened } from "./DemoApp.tsx";

export type Panel = "thumbnails" | "outline" | "layers" | "attachments" | "info";

/** The panel beside the pages, with a tab for each list the document has. */
export function SidePanel({
  panel,
  onPanelChange,
  opened,
}: {
  panel: Panel;
  onPanelChange: (panel: Panel) => void;
  opened: Opened;
}) {
  const outline = usePdfOutline();
  const hasLayers = usePdfState((state) => (state.layers?.length ?? 0) > 0);
  const hasAttachments = usePdfState((state) => (state.attachments?.length ?? 0) > 0);
  const tabs: [Panel, string, boolean][] = [
    ["thumbnails", "Pages", true],
    ["outline", "Outline", (outline?.length ?? 0) > 0],
    ["layers", "Layers", hasLayers],
    ["attachments", "Files", hasAttachments],
    ["info", "Info", true],
  ];
  const shown = tabs.find(([value, , available]) => value === panel && available)
    ? panel
    : "thumbnails";
  return (
    <aside id="demo-side" className="demo-side" aria-label="Sidebar">
      <div className="demo-tabs" role="tablist" aria-label="Sidebar panels">
        {tabs
          .filter(([, , available]) => available)
          .map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={shown === value}
              onClick={() => onPanelChange(value)}
            >
              {label}
            </button>
          ))}
      </div>
      <div className="demo-panel" role="tabpanel">
        {shown === "thumbnails" ? <Thumbnails /> : null}
        {shown === "outline" && outline ? <OutlineList items={outline} /> : null}
        {shown === "layers" ? <Layers /> : null}
        {shown === "attachments" ? <Attachments /> : null}
        {shown === "info" ? <Info opened={opened} /> : null}
      </div>
    </aside>
  );
}

/** Every page as a thumbnail; each one is drawn only near the panel's visible part. */
function Thumbnails() {
  const viewer = usePdfViewer();
  const pageCount = usePdfState((state) => state.pageCount);
  const currentPage = usePdfState((state) => state.currentPage);
  const labels = usePdfState((state) => state.pageLabels);
  return (
    <ol className="demo-thumbnails">
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
              <PdfThumbnail pageIndex={pageIndex} width={128} />
              <span aria-hidden="true">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function OutlineList({ items }: { items: readonly OutlineNode[] }) {
  const navigation = usePdfNavigation();
  return (
    <ul className="demo-outline">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the outline is fixed for a document.
        <li key={index}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title}
            </a>
          ) : (
            <button
              type="button"
              disabled={item.dest === null}
              onClick={() => void navigation.goToDestination(item.dest)}
              style={{
                fontWeight: item.bold ? 600 : undefined,
                fontStyle: item.italic ? "italic" : undefined,
              }}
            >
              {item.title}
            </button>
          )}
          {item.items.length > 0 ? <OutlineList items={item.items} /> : null}
        </li>
      ))}
    </ul>
  );
}

function Layers() {
  const layers = usePdfState((state) => state.layers);
  return layers ? <LayerList layers={layers} /> : null;
}

function LayerList({ layers }: { layers: readonly PdfLayer[] }) {
  const viewer = usePdfViewer();
  return (
    <ul className="demo-layers">
      {layers.map((layer, index) => (
        <li key={layer.id ?? `heading-${index}`}>
          {layer.id === null ? (
            <span className="demo-heading">{layer.name || "Other layers"}</span>
          ) : (
            <label>
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={(event) => {
                  if (layer.id) viewer.setLayerVisible(layer.id, event.target.checked);
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

function Attachments() {
  const viewer = usePdfViewer();
  const attachments = usePdfState((state) => state.attachments);
  return (
    <ul className="demo-outline">
      {attachments?.map((attachment) => (
        <li key={attachment.id}>
          <button
            type="button"
            title={attachment.description ?? undefined}
            onClick={() => void viewer.openAttachment(attachment)}
          >
            {attachment.filename}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What the document says about itself, and where a sample comes from. */
function Info({ opened }: { opened: Opened }) {
  const metadata = usePdfState((state) => state.metadata);
  const pageCount = usePdfState((state) => state.pageCount);
  const restricted = usePdfState((state) => state.permissions?.restricted ?? false);
  const rows: [string, string | null | undefined][] = [
    ["Title", metadata?.title],
    ["Author", metadata?.author],
    ["Subject", metadata?.subject],
    ["Pages", pageCount > 0 ? pageCount.toLocaleString("en") : null],
    ["Language", metadata?.language],
    ["PDF version", metadata?.pdfVersion],
    ["Producer", metadata?.producer],
    ["Created", metadata?.creationDate?.toLocaleDateString("en")],
    ["Permissions", restricted ? "Restricted" : null],
  ];
  return (
    <div className="demo-info">
      {"sample" in opened ? (
        <p>
          <strong>{opened.sample.title}</strong>: {opened.sample.about}.{" "}
          {opened.sample.generated ? (
            <>
              Generated by <a href={opened.sample.sourceUrl}>gen-synthetic.ts</a>.
            </>
          ) : (
            <>
              Source: <a href={opened.sample.sourceUrl}>{opened.sample.source}</a> (
              <a href={corpusReadme}>license</a>).
            </>
          )}
        </p>
      ) : (
        <p>
          <strong>{opened.name}</strong> is open from your device. It is not uploaded anywhere.
        </p>
      )}
      <dl>
        {rows
          .filter((row): row is [string, string] => Boolean(row[1]))
          .map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
