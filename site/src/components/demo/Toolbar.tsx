import {
  download,
  getViewState,
  print,
  type ScrollMode,
  type SpreadMode,
  usePdfAnnotationEditing,
  usePdfNavigation,
  usePdfState,
  usePdfViewer,
  type ViewState,
} from "parapdf";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { samples } from "../../samples.ts";
import type { Opened } from "./DemoApp.tsx";
import { FindBar } from "./FindBar.tsx";
import { Icon, IconButton, type IconName, modifier } from "./icons.tsx";
import { closePopover, MenuItem, menuItemRole, Popover } from "./popover.tsx";

const SCROLL_MODES: readonly [ScrollMode, string, IconName][] = [
  ["vertical", "Vertical", "scrollVertical"],
  ["horizontal", "Horizontal", "scrollHorizontal"],
  ["wrapped", "Wrapped", "scrollWrapped"],
  ["page", "Page by page", "scrollPage"],
];

const SPREADS: readonly [SpreadMode, string, IconName][] = [
  ["none", "Single", "spreadNone"],
  ["odd", "1–2, 3–4", "spreadOdd"],
  ["even", "1, 2–3", "spreadEven"],
];

/** The zooms the zoom menu offers, as shares of the printed size. */
const ZOOMS = [50, 75, 100, 125, 150, 200, 300, 400];

/** CSS pixels per PDF point at a zoom: 96 / 72 is the printed size. */
const scaleAt = (percent: number) => (percent / 100) * (96 / 72);

export interface ToolbarProps {
  opened: Opened;
  onOpen: (opened: Opened) => void;
  /** Asks for a PDF on the reader's device. */
  onOpenFile: () => void;
  sidebar: boolean;
  onSidebarChange: (open: boolean) => void;
  onShowInfo: () => void;
  finding: boolean;
  onFindingChange: (finding: boolean) => void;
  /** Whether the annotation tools show. */
  annotating: boolean;
  /** Shows or hides them; the first time, a viewer that edits annotations opens at `view`. */
  onAnnotatingChange: (annotating: boolean, view: ViewState | null) => void;
}

/** Shows or hides the annotation tools; hiding them puts the pointer back to its default. */
function useAnnotatingToggle({ annotating, onAnnotatingChange }: ToolbarProps) {
  const viewer = usePdfViewer();
  const editing = usePdfAnnotationEditing();
  return () => {
    if (annotating) void editing?.setTool("none");
    onAnnotatingChange(!annotating, getViewState(viewer));
  };
}

/**
 * The bar over the pages, after pdf.js's viewer: the document and its
 * panels on the left, pages and zoom in the middle, and what to do with the
 * document on the right. Narrow windows keep the less used buttons in the
 * menu at its end.
 */
export function Toolbar(props: ToolbarProps) {
  const { sidebar, onSidebarChange, finding, onFindingChange, annotating } = props;
  const viewer = usePdfViewer();
  const toggleAnnotating = useAnnotatingToggle(props);
  const ready = usePdfState((state) => state.status === "ready");
  const findButton = useRef<HTMLButtonElement>(null);
  return (
    <header className="demo-header">
      <div className="demo-start">
        <a className="demo-brand" href="/" title="ParaPDF documentation">
          <img src="/favicon.svg" alt="" width="24" height="24" />
          <span>ParaPDF</span>
        </a>
        <span className="demo-divider" />
        <IconButton
          icon="sidebar"
          label="Sidebar"
          aria-expanded={sidebar}
          aria-controls="demo-side"
          onClick={() => onSidebarChange(!sidebar)}
        />
        <IconButton
          ref={findButton}
          icon="search"
          label="Find in document"
          shortcut={`${modifier}F`}
          aria-expanded={finding}
          aria-controls="demo-find"
          onClick={() => onFindingChange(!finding)}
        />
        <DocumentMenu {...props} />
        <IconButton
          className="demo-from-xl"
          icon="open"
          label="Open a PDF from your device"
          onClick={props.onOpenFile}
        />
      </div>
      <div className="demo-center">
        <History />
        <PageNavigation />
        <span className="demo-divider" />
        <ZoomControls />
      </div>
      <div className="demo-end">
        <IconButton
          className="demo-annotate demo-from-md"
          icon="annotate"
          label="Annotate"
          text="Annotate"
          aria-pressed={annotating}
          onClick={toggleAnnotating}
        />
        <span className="demo-divider demo-from-lg" />
        <IconButton
          className="demo-from-lg"
          icon="download"
          label="Download"
          disabled={!ready}
          onClick={() => void download(viewer)}
        />
        <IconButton
          className="demo-from-lg"
          icon="print"
          label="Print"
          disabled={!ready}
          onClick={() => void print(viewer)}
        />
        <MoreMenu {...props} />
      </div>
      {finding ? (
        <FindBar
          onClose={() => {
            onFindingChange(false);
            findButton.current?.focus();
          }}
        />
      ) : null}
    </header>
  );
}

/** The samples to switch between, and a PDF of the reader's own. */
function DocumentMenu({ opened, onOpen, onOpenFile }: ToolbarProps) {
  const title = "sample" in opened ? opened.sample.title : opened.name;
  return (
    <Popover
      id="demo-documents"
      label="Documents"
      className="demo-documents"
      button={(props) => (
        <button
          type="button"
          className="demo-picker"
          aria-label={`Document: ${title}`}
          title="Choose a document"
          {...props}
        >
          <Icon name="file" size={18} />
          <span>{title}</span>
          <Icon name="chevronDown" size={16} />
        </button>
      )}
    >
      <fieldset>
        <legend className="demo-menu-heading">Samples</legend>
        {samples.map((sample) => (
          <button
            key={sample.file}
            type="button"
            role="menuitemradio"
            aria-checked={"sample" in opened && opened.sample === sample}
            className="demo-menu-item demo-document"
            onClick={(event) => {
              closePopover(event);
              onOpen({ sample });
            }}
          >
            <span className="demo-document-title">{sample.title}</span>
            <span className="demo-document-about">{sample.about}</span>
          </button>
        ))}
      </fieldset>
      <hr />
      <MenuItem icon="open" onSelect={onOpenFile}>
        Open a PDF from your device…
      </MenuItem>
    </Popover>
  );
}

/** Back and forward through the places links and the outline jumped from. */
function History() {
  const { canGoBack: canBack, canGoForward: canForward, back, forward } = usePdfNavigation();
  return (
    <div className="demo-group demo-from-xl">
      <IconButton icon="back" label="Back" disabled={!canBack} onClick={back} />
      <IconButton icon="forward" label="Forward" disabled={!canForward} onClick={forward} />
      <span className="demo-divider" />
    </div>
  );
}

/** The page as a number to type, after the previous and next buttons. */
function PageNavigation() {
  const viewer = usePdfViewer();
  const page = usePdfState((state) => state.currentPage);
  const pageCount = usePdfState((state) => state.pageCount);
  const label = usePdfState((state) => state.pageLabels?.[state.currentPage] ?? null);
  const [value, setValue] = useState(String(page + 1));
  useEffect(() => setValue(String(page + 1)), [page]);
  return (
    <div className="demo-group">
      <IconButton
        icon="chevronUp"
        label="Previous page"
        disabled={page <= 0}
        onClick={() => viewer.previousPage()}
      />
      <IconButton
        icon="chevronDown"
        label="Next page"
        disabled={page >= pageCount - 1}
        onClick={() => viewer.nextPage()}
      />
      <form
        className="demo-page"
        onSubmit={(event) => {
          event.preventDefault();
          const index = Number(value) - 1;
          if (Number.isInteger(index)) viewer.goToPage(Math.min(Math.max(index, 0), pageCount - 1));
        }}
      >
        <input
          aria-label="Page"
          inputMode="numeric"
          enterKeyHint="go"
          disabled={pageCount === 0}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={() => setValue(String(page + 1))}
        />
        <span className="demo-page-count">/ {pageCount > 0 ? pageCount : "–"}</span>
        {label && label !== String(page + 1) ? (
          <span className="demo-page-label" title="Page label">
            {label}
          </span>
        ) : null}
      </form>
    </div>
  );
}

/** Zoom out and in, and the zoom, whose menu fits the page or picks a share of the printed size. */
function ZoomControls() {
  const viewer = usePdfViewer();
  const percent = usePdfState((state) => Math.round((state.scale * 72 * 100) / 96));
  const zoomMode = usePdfState((state) => state.zoomMode);
  return (
    <div className="demo-group">
      <IconButton
        icon="minus"
        label="Zoom out"
        shortcut={`${modifier}−`}
        onClick={() => viewer.zoomBy(1 / 1.25)}
      />
      <Popover
        id="demo-zoom"
        label="Zoom"
        align="center"
        className="demo-zoom-menu"
        button={(props) => (
          <button
            type="button"
            className="demo-zoom"
            aria-label={`Zoom: ${percent}%`}
            title="Zoom"
            {...props}
          >
            {percent}%
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      >
        <MenuItem checked={zoomMode === "fit-width"} onSelect={() => viewer.setScale("fit-width")}>
          Fit width
        </MenuItem>
        <MenuItem checked={zoomMode === "fit-page"} onSelect={() => viewer.setScale("fit-page")}>
          Fit page
        </MenuItem>
        <hr />
        {ZOOMS.map((zoom) => (
          <MenuItem
            key={zoom}
            checked={zoomMode === "custom" && percent === zoom}
            onSelect={() => viewer.setScale(scaleAt(zoom))}
          >
            {zoom}%
          </MenuItem>
        ))}
      </Popover>
      <IconButton
        icon="plus"
        label="Zoom in"
        shortcut={`${modifier}+`}
        onClick={() => viewer.zoomBy(1.25)}
      />
    </div>
  );
}

/** A choice of the menu shown as a tile, for the view's settings. */
function Tile({
  icon,
  checked,
  onSelect,
  children,
}: {
  icon: IconName;
  checked?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="demo-tile" onClick={onSelect} {...menuItemRole(checked)}>
      <Icon name={icon} />
      <span>{children}</span>
    </button>
  );
}

/**
 * How the pages are shown, as tiles that stay open to compare, then what
 * to do with the document. Its first items are the toolbar's buttons that
 * narrow windows hide.
 */
function MoreMenu(props: ToolbarProps) {
  const { annotating, onOpenFile, onShowInfo } = props;
  const viewer = usePdfViewer();
  const toggleAnnotating = useAnnotatingToggle(props);
  const ready = usePdfState((state) => state.status === "ready");
  const pageCount = usePdfState((state) => state.pageCount);
  const scrollMode = usePdfState((state) => state.scrollMode);
  const spread = usePdfState((state) => state.spread);
  const tool = usePdfState((state) => state.tool);
  const { canGoBack: canBack, canGoForward: canForward, back, forward } = usePdfNavigation();
  return (
    <Popover
      id="demo-more"
      label="More"
      align="end"
      className="demo-more"
      button={(props) => <IconButton icon="more" label="More" {...props} />}
    >
      <div className="demo-until-md">
        <MenuItem
          icon="annotate"
          role="menuitemcheckbox"
          checked={annotating}
          onSelect={toggleAnnotating}
        >
          Annotate
        </MenuItem>
      </div>
      <div className="demo-until-xl">
        <MenuItem icon="open" onSelect={onOpenFile}>
          Open a PDF…
        </MenuItem>
      </div>
      <div className="demo-until-lg">
        <MenuItem icon="download" disabled={!ready} onSelect={() => void download(viewer)}>
          Download
        </MenuItem>
        <MenuItem icon="print" disabled={!ready} onSelect={() => void print(viewer)}>
          Print
        </MenuItem>
        <hr />
      </div>
      <fieldset className="demo-tiles">
        <legend className="demo-menu-heading">Scrolling</legend>
        {SCROLL_MODES.map(([value, label, icon]) => (
          <Tile
            key={value}
            icon={icon}
            checked={scrollMode === value}
            onSelect={() => viewer.setScrollMode(value)}
          >
            {label}
          </Tile>
        ))}
      </fieldset>
      <fieldset className="demo-tiles demo-tiles-3">
        <legend className="demo-menu-heading">Spreads</legend>
        {SPREADS.map(([value, label, icon]) => (
          <Tile
            key={value}
            icon={icon}
            checked={spread === value}
            onSelect={() => viewer.setSpread(value)}
          >
            {label}
          </Tile>
        ))}
      </fieldset>
      <fieldset className="demo-tiles demo-tiles-2">
        <legend className="demo-menu-heading">Pointer</legend>
        <Tile icon="pointer" checked={tool === "select"} onSelect={() => viewer.setTool("select")}>
          Select text
        </Tile>
        <Tile icon="hand" checked={tool === "hand"} onSelect={() => viewer.setTool("hand")}>
          Hand tool
        </Tile>
      </fieldset>
      <fieldset className="demo-tiles demo-tiles-2">
        <legend className="demo-menu-heading">Rotation</legend>
        <Tile icon="rotateCcw" onSelect={() => viewer.rotate(-90)}>
          Left
        </Tile>
        <Tile icon="rotateCw" onSelect={() => viewer.rotate(90)}>
          Right
        </Tile>
      </fieldset>
      <hr />
      <MenuItem icon="firstPage" disabled={pageCount === 0} onSelect={() => viewer.goToPage(0)}>
        First page
      </MenuItem>
      <MenuItem
        icon="lastPage"
        disabled={pageCount === 0}
        onSelect={() => viewer.goToPage(pageCount - 1)}
      >
        Last page
      </MenuItem>
      <div className="demo-until-xl">
        <MenuItem icon="back" disabled={!canBack} onSelect={back}>
          Back
        </MenuItem>
        <MenuItem icon="forward" disabled={!canForward} onSelect={forward}>
          Forward
        </MenuItem>
      </div>
      <MenuItem icon="info" onSelect={onShowInfo}>
        Document properties
      </MenuItem>
      <hr />
      <a className="demo-menu-item" role="menuitem" href="/getting-started/">
        <Icon name="book" />
        <span>Documentation</span>
      </a>
      <a
        className="demo-menu-item"
        role="menuitem"
        href="https://github.com/yhay81/parapdf"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="code" />
        <span>Source on GitHub</span>
        <Icon name="external" size={16} />
      </a>
    </Popover>
  );
}
