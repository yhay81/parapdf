import {
  type OutlineNode,
  openAttachment,
  type PdfLayer,
  PdfThumbnail,
  setLayerVisible,
  useAttachments,
  useDocumentState,
  useLayers,
  useMetadata,
  useOutline,
  usePageLabels,
  useViewState,
} from "parapdf";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { corpusReadme } from "../../samples.ts";
import type { Opened } from "./DemoApp.tsx";
import { Icon, IconButton, type IconName } from "./icons.tsx";
import { useDemoViewer } from "./viewer.ts";

export type Panel = "thumbnails" | "outline" | "layers" | "attachments" | "info";

/** CSS pixels across a thumbnail. */
const THUMBNAIL_WIDTH = 132;

/** How far each arrow key moves between the tabs. */
const TAB_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/** The panel beside the pages, with a tab for each list the document has. */
export function SidePanel({
  panel,
  onPanelChange,
  onClose,
  opened,
}: {
  panel: Panel;
  onPanelChange: (panel: Panel) => void;
  onClose: () => void;
  opened: Opened;
}) {
  const outline = useOutline();
  const pageCount = useDocumentState((state) => state.pageCount);
  const hasLayers = useLayers().length > 0;
  const attachments = useAttachments().length;
  const tabs: [Panel, string, IconName, boolean][] = [
    ["thumbnails", "Pages", "pages", true],
    ["outline", "Outline", "outline", outline.length > 0],
    ["layers", "Layers", "layers", hasLayers],
    ["attachments", "Attachments", "attachment", attachments > 0],
    ["info", "Document properties", "info", true],
  ];
  const available = tabs.filter(([, , , shown]) => shown);
  const shown = available.find(([value]) => value === panel) ?? (available[0] as (typeof tabs)[0]);
  const [value, title] = shown;
  const count = value === "thumbnails" ? pageCount : value === "attachments" ? attachments : 0;

  // The arrow keys move between the tabs, which take one stop of the Tab key together.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = TAB_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = available.indexOf(shown);
    const next = available[(index + step + available.length) % available.length];
    if (!next) return;
    onPanelChange(next[0]);
    event.currentTarget.querySelector<HTMLElement>(`#demo-tab-${next[0]}`)?.focus();
  };

  return (
    <aside id="demo-side" className="demo-side" aria-label="Sidebar">
      <div className="demo-side-head">
        <div className="demo-tabs" role="tablist" aria-label="Sidebar panels" onKeyDown={onKeyDown}>
          {available.map(([tab, label, icon]) => (
            <button
              key={tab}
              id={`demo-tab-${tab}`}
              type="button"
              role="tab"
              className="demo-button"
              aria-label={label}
              title={label}
              aria-selected={tab === value}
              aria-controls="demo-panel"
              tabIndex={tab === value ? 0 : -1}
              onClick={() => onPanelChange(tab)}
            >
              <Icon name={icon} />
            </button>
          ))}
        </div>
        <IconButton
          className="demo-side-close"
          icon="close"
          label="Close the sidebar"
          onClick={onClose}
        />
      </div>
      <div
        id="demo-panel"
        className="demo-panel"
        role="tabpanel"
        aria-labelledby={`demo-tab-${value}`}
      >
        <h2 className="demo-panel-title">
          {title}
          {count > 0 ? <span>{count.toLocaleString("en")}</span> : null}
        </h2>
        {value === "thumbnails" ? <Thumbnails /> : null}
        {value === "outline" && outline ? <OutlineList items={outline} depth={0} /> : null}
        {value === "layers" ? <Layers /> : null}
        {value === "attachments" ? <Attachments /> : null}
        {value === "info" ? <Info opened={opened} /> : null}
      </div>
    </aside>
  );
}

/**
 * Every page as a thumbnail; each one is drawn only near the panel's
 * visible part, and the current page's scrolls into view, as in pdf.js.
 */
function Thumbnails() {
  const viewer = useDemoViewer();
  const pageCount = useDocumentState((state) => state.pageCount);
  const currentPage = useViewState(viewer, (state) => state.currentPage);
  const labels = usePageLabels();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.children[currentPage]?.scrollIntoView({ block: "nearest" });
  }, [currentPage]);
  return (
    <ol ref={list} className="demo-thumbnails">
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
              <PdfThumbnail viewer={viewer} pageIndex={pageIndex} width={THUMBNAIL_WIDTH} />
              <span aria-hidden="true">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The outline as a tree whose entries with children open and close; all start closed. */
function OutlineList({ items, depth }: { items: readonly OutlineNode[]; depth: number }) {
  return (
    <ul className={depth === 0 ? "demo-outline" : undefined}>
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the outline is fixed for a document.
        <OutlineEntry key={index} item={item} depth={depth} />
      ))}
    </ul>
  );
}

function OutlineEntry({ item, depth }: { item: OutlineNode; depth: number }) {
  const viewer = useDemoViewer();
  const [open, setOpen] = useState(false);
  const style = {
    paddingLeft: `${depth * 0.875}rem`,
    fontWeight: item.bold ? 600 : undefined,
    fontStyle: item.italic ? "italic" : undefined,
  };
  return (
    <li>
      <div className="demo-outline-row" style={style}>
        {item.items.length > 0 ? (
          <button
            type="button"
            className="demo-outline-toggle"
            aria-label={open ? `Collapse ${item.title}` : `Expand ${item.title}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        ) : (
          <span className="demo-outline-toggle" />
        )}
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
        ) : (
          <button
            type="button"
            disabled={item.dest === null}
            onClick={() => void viewer.goToDestination(item.dest)}
          >
            {item.title}
          </button>
        )}
      </div>
      {open ? <OutlineList items={item.items} depth={depth + 1} /> : null}
    </li>
  );
}

function Layers() {
  return <LayerList layers={useLayers()} />;
}

function LayerList({ layers }: { layers: readonly PdfLayer[] }) {
  const viewer = useDemoViewer();
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

function Attachments() {
  const viewer = useDemoViewer();
  const attachments = useAttachments();
  return (
    <ul className="demo-files">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <button
            type="button"
            title={attachment.description ?? undefined}
            onClick={() => void openAttachment(viewer, attachment)}
          >
            <Icon name="attachment" size={18} />
            <span>{attachment.filename}</span>
            <Icon name="download" size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What the document says about itself, and where a sample comes from. */
function Info({ opened }: { opened: Opened }) {
  const metadata = useMetadata();
  const pageCount = useDocumentState((state) => state.pageCount);
  const restricted = useDocumentState((state) => state.permissions?.restricted ?? false);
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
