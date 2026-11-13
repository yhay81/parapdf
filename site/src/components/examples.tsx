import {
  type AnnotationTool,
  download,
  getFormFields,
  getText,
  PdfDocument,
  PdfPageRect,
  type PdfRect,
  PdfThumbnails,
  PdfViewer,
  type PdfViewerProps,
  print,
  type ScrollMode,
  type SpreadMode,
  useAnnotations,
  useFormChange,
  usePageLabels,
  useSelection,
  useViewer,
  useViewState,
} from "parapdf";
import { type ReactNode, Suspense, useState } from "react";
import { corpusReadme, samples, sampleUrl } from "../samples.ts";
import {
  DocumentStatus,
  PageControls,
  PasswordPrompt,
  SearchField,
  ZoomControls,
} from "./controls.tsx";

/** A toolbar, a viewer, and a note naming the document, as the examples show them. */
function Example({
  file,
  viewerProps,
  toolbar,
  side,
  note,
  overlay,
}: {
  file: string;
  viewerProps?: PdfViewerProps;
  toolbar?: ReactNode;
  side?: ReactNode;
  note?: ReactNode;
  overlay?: (pageIndex: number) => ReactNode;
}) {
  const sample = samples.find((candidate) => candidate.file === file);
  return (
    <div className="example not-content">
      <PdfDocument source={sampleUrl(file)}>
        {toolbar ? (
          <div className="example-toolbar" role="toolbar" aria-label="Viewer controls">
            {toolbar}
            <span className="spacer" />
            <DocumentStatus className="example-status" />
          </div>
        ) : null}
        <div className="example-body">
          {side}
          <PdfViewer {...viewerProps} className="example-viewport" renderOverlay={overlay} />
        </div>
      </PdfDocument>
      <p className="example-note">
        {note}
        {note ? " " : ""}
        {sample ? (
          <>
            <a href={sample.sourceUrl}>{sample.title}</a>
            {sample.generated ? "" : `, ${sample.source}`} (<a href={corpusReadme}>license</a>).
          </>
        ) : null}
      </p>
    </div>
  );
}

/** The quick start as it is: a document and its viewport. */
export function QuickStartExample() {
  return <Example file="usrguide.pdf" />;
}

function RotateButton() {
  const viewer = useViewer();
  return (
    <button type="button" onClick={() => viewer.rotate(90)}>
      Rotate
    </button>
  );
}

/** The toolbar of "Controls and state". */
export function ControlsExample() {
  return (
    <Example
      file="bill-hr815.pdf"
      toolbar={
        <>
          <PageControls />
          <ZoomControls />
          <RotateButton />
        </>
      }
      note="Click the pages, then try the arrow keys, Page Down, and Ctrl or ⌘ with + and -."
    />
  );
}

const SCROLL_MODES: readonly ScrollMode[] = ["vertical", "horizontal", "wrapped", "page"];
const SPREADS: readonly SpreadMode[] = ["none", "odd", "even"];

function LayoutControls() {
  const viewer = useViewer();
  const { scrollMode, spread } = useViewState();
  return (
    <>
      <label>
        Scroll{" "}
        <select
          value={scrollMode}
          onChange={(event) => viewer.setScrollMode(event.target.value as ScrollMode)}
        >
          {SCROLL_MODES.map((mode) => (
            <option key={mode}>{mode}</option>
          ))}
        </select>
      </label>
      <label>
        Spread{" "}
        <select
          value={spread}
          onChange={(event) => viewer.setSpread(event.target.value as SpreadMode)}
        >
          {SPREADS.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Scroll modes, spreads, and fitting on pages of mixed sizes. */
export function LayoutExample() {
  return (
    <Example
      file="synthetic-mixed-sizes.pdf"
      viewerProps={{ defaultZoom: "fit-page" }}
      toolbar={
        <>
          <LayoutControls />
          <PageControls />
          <ZoomControls />
        </>
      }
      note="In page mode, the arrow keys at an edge and one-finger swipes turn pages."
    />
  );
}

/** Search over the whole of a long document. */
export function SearchExample() {
  return (
    <Example
      file="bill-hr815.pdf"
      toolbar={<SearchField withOptions />}
      note="Try “appropriations” or “Ukraine”: matches stream in page by page, mounted or not."
    />
  );
}

/** The pages as thumbnails, named by their labels once those are read. */
function ThumbnailList() {
  return (
    <Suspense fallback={<PdfThumbnails width={110} label="Pages" className="example-side" />}>
      <LabelledThumbnails />
    </Suspense>
  );
}

function LabelledThumbnails() {
  const labels = usePageLabels();
  return (
    <PdfThumbnails
      width={110}
      label="Pages"
      className="example-side"
      pageLabel={(pageNumber) => `Page ${labels?.[pageNumber - 1] ?? pageNumber}`}
    />
  );
}

/** Thumbnails of every page beside the viewer. */
export function ThumbnailsExample() {
  return (
    <Example
      file="usrguide.pdf"
      side={<ThumbnailList />}
      note="Only thumbnails near the visible part of the list hold pixels."
    />
  );
}

function SelectionTools({
  onKeep,
  onClear,
}: {
  onKeep: (rects: readonly { pageIndex: number; rect: PdfRect }[]) => void;
  onClear: () => void;
}) {
  const viewer = useViewer();
  const selection = useSelection();
  const [read, setRead] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={!selection}
        onClick={() => {
          if (!selection) return;
          onKeep(
            selection.pages.flatMap(({ pageIndex, rects }) =>
              rects.map((rect) => ({ pageIndex, rect })),
            ),
          );
          window.getSelection()?.removeAllRanges();
        }}
      >
        Keep as highlight
      </button>
      <button type="button" onClick={onClear}>
        Clear highlights
      </button>
      <button
        type="button"
        onClick={async () => {
          const { text, pages } = await getText(viewer);
          setRead(`${text.length.toLocaleString("en")} characters on ${pages.length} pages`);
        }}
      >
        Read all text
      </button>
      <output aria-live="polite">
        {read || (selection ? `${selection.text.length} characters selected` : "Select some text")}
      </output>
    </>
  );
}

/** Selections kept as overlays, and the text of the whole document. */
export function TextExample() {
  const [kept, setKept] = useState<readonly { pageIndex: number; rect: PdfRect }[]>([]);
  return (
    <Example
      file="usrguide.pdf"
      toolbar={
        <SelectionTools
          onKeep={(rects) => setKept((previous) => [...previous, ...rects])}
          onClear={() => setKept([])}
        />
      }
      overlay={(pageIndex) =>
        kept
          .filter((entry) => entry.pageIndex === pageIndex)
          .map(({ rect }, index) => (
            <PdfPageRect
              // biome-ignore lint/suspicious/noArrayIndexKey: kept rectangles never move.
              key={index}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  background: "rgb(92 118 255 / 0.35)",
                }}
              />
            </PdfPageRect>
          ))
      }
      note="Highlights are your own elements over the pages, in PDF points: zoom and they follow."
    />
  );
}

function FormTools() {
  const viewer = useViewer();
  const [last, setLast] = useState("Type in a field");
  const [fields, setFields] = useState<number | null>(null);
  useFormChange(({ name, value }) => setLast(`${name} = ${JSON.stringify(value)}`));
  return (
    <>
      <button type="button" onClick={async () => setFields((await getFormFields(viewer)).length)}>
        Count fields
      </button>
      <button type="button" onClick={() => void download(viewer, { filename: "f1040-filled.pdf" })}>
        Download
      </button>
      <button type="button" onClick={() => void print(viewer)}>
        Print
      </button>
      <output aria-live="polite" style={{ maxWidth: "24rem", overflow: "hidden" }}>
        {fields === null ? last : `${fields} fields`}
      </output>
    </>
  );
}

/** A fillable form whose values the download and the printout include. */
export function FormsExample() {
  return (
    <Example
      file="f1040.pdf"
      viewerProps={{ forms: true }}
      toolbar={<FormTools />}
      note="What you type stays in this page: the download is made in your browser."
    />
  );
}

const TOOLS: readonly [AnnotationTool, string][] = [
  ["none", "View"],
  ["highlight", "Highlight"],
  ["freetext", "Text"],
  ["ink", "Draw"],
];

function AnnotationTools() {
  const viewer = useViewer();
  const annotations = useAnnotations();
  const tool = annotations?.tool ?? "none";
  const editing = annotations?.state ?? null;
  const ink = annotations?.styles?.ink;
  return (
    <>
      {TOOLS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={tool === value}
          disabled={!editing}
          onClick={() => void annotations?.setTool(value)}
        >
          {label}
        </button>
      ))}
      <input
        type="color"
        aria-label="Drawing color"
        disabled={!editing}
        value={ink?.color.toLowerCase() ?? "#000000"}
        onChange={(event) => annotations?.setStyle("ink", { color: event.target.value })}
      />
      <button type="button" disabled={!editing?.canUndo} onClick={() => annotations?.undo()}>
        Undo
      </button>
      <button type="button" disabled={!editing?.canRedo} onClick={() => annotations?.redo()}>
        Redo
      </button>
      <button type="button" onClick={() => void download(viewer, { filename: "annotated.pdf" })}>
        Download
      </button>
    </>
  );
}

/** Annotations the reader creates with pdf.js's editors. */
export function AnnotationsExample() {
  return (
    <Example
      file="usrguide.pdf"
      viewerProps={{ annotationEditing: true }}
      toolbar={<AnnotationTools />}
      note="Select text with Highlight, click with Text, drag with Draw; the download includes them."
    />
  );
}

/** An encrypted document and the prompt that answers it. */
export function PasswordExample() {
  return (
    <div className="example not-content">
      <PdfDocument source={sampleUrl("synthetic-encrypted.pdf")}>
        <PasswordPrompt className="example-password" hint="parapdf" />
        <div className="example-toolbar" role="toolbar" aria-label="Viewer controls">
          <PageControls />
          <span className="spacer" />
          <DocumentStatus className="example-status" />
        </div>
        <PdfViewer className="example-viewport" />
      </PdfDocument>
      <p className="example-note">
        The password is <code>parapdf</code>. Cancel fails the document instead.
      </p>
    </div>
  );
}
