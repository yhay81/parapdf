import {
  type AnnotationTool,
  PdfDocument,
  type PdfDocumentProps,
  PdfPageRect,
  type PdfRect,
  PdfThumbnail,
  PdfViewport,
  type ScrollMode,
  type SpreadMode,
  usePdfFormChange,
  usePdfSelection,
  usePdfState,
  usePdfViewer,
} from "parapdf";
import { type ReactNode, useState } from "react";
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
  options,
  toolbar,
  side,
  note,
  overlay,
}: {
  file: string;
  options?: PdfDocumentProps["options"];
  toolbar?: ReactNode;
  side?: ReactNode;
  note?: ReactNode;
  overlay?: (pageIndex: number) => ReactNode;
}) {
  const sample = samples.find((candidate) => candidate.file === file);
  return (
    <div className="example not-content">
      <PdfDocument source={sampleUrl(file)} options={options}>
        {toolbar ? (
          <div className="example-toolbar" role="toolbar" aria-label="Viewer controls">
            {toolbar}
            <span className="spacer" />
            <DocumentStatus className="example-status" />
          </div>
        ) : null}
        <div className="example-body">
          {side}
          <PdfViewport className="example-viewport" renderOverlay={overlay} />
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
  const viewer = usePdfViewer();
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
  const viewer = usePdfViewer();
  const scrollMode = usePdfState((state) => state.scrollMode);
  const spread = usePdfState((state) => state.spread);
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
      options={{ initialScale: "fit-page" }}
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

function ThumbnailList() {
  const viewer = usePdfViewer();
  const pageCount = usePdfState((state) => state.pageCount);
  const currentPage = usePdfState((state) => state.currentPage);
  const labels = usePdfState((state) => state.pageLabels);
  return (
    <nav className="example-side" aria-label="Pages">
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
                <PdfThumbnail pageIndex={pageIndex} width={110} />
                <span aria-hidden="true">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
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
  const viewer = usePdfViewer();
  const selection = usePdfSelection();
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
          const { text, pages } = await viewer.getText();
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
              pageIndex={pageIndex}
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
  const viewer = usePdfViewer();
  const [last, setLast] = useState("Type in a field");
  const [fields, setFields] = useState<number | null>(null);
  usePdfFormChange(({ name, value }) => setLast(`${name} = ${JSON.stringify(value)}`));
  return (
    <>
      <button type="button" onClick={async () => setFields((await viewer.getFormFields()).length)}>
        Count fields
      </button>
      <button type="button" onClick={() => void viewer.download("f1040-filled.pdf")}>
        Download
      </button>
      <button type="button" onClick={() => void viewer.print()}>
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
      options={{ forms: true }}
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
  const viewer = usePdfViewer();
  const tool = usePdfState((state) => state.annotationTool);
  const editing = usePdfState((state) => state.annotationState);
  const ink = usePdfState((state) => state.annotationStyles?.ink);
  return (
    <>
      {TOOLS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={tool === value}
          disabled={!editing}
          onClick={() => void viewer.setAnnotationTool(value)}
        >
          {label}
        </button>
      ))}
      <input
        type="color"
        aria-label="Drawing color"
        disabled={!editing}
        value={ink?.color.toLowerCase() ?? "#000000"}
        onChange={(event) => viewer.setAnnotationStyle("ink", { color: event.target.value })}
      />
      <button type="button" disabled={!editing?.canUndo} onClick={() => viewer.undoAnnotation()}>
        Undo
      </button>
      <button type="button" disabled={!editing?.canRedo} onClick={() => viewer.redoAnnotation()}>
        Redo
      </button>
      <button type="button" onClick={() => void viewer.download("annotated.pdf")}>
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
      options={{ annotationEditing: true }}
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
        <PdfViewport className="example-viewport" />
      </PdfDocument>
      <p className="example-note">
        The password is <code>parapdf</code>. Cancel fails the document instead.
      </p>
    </div>
  );
}

const HERO_SAMPLES = [
  "usrguide.pdf",
  "synthetic-text-1000.pdf",
  "mhlw-doc.pdf",
  "wdl6812-manuscript.pdf",
  "synthetic-vector-200k.pdf",
];

/** The viewer on the home page, with a few samples to switch between. */
export function HeroViewer() {
  const [file, setFile] = useState("usrguide.pdf");
  const sample = samples.find((candidate) => candidate.file === file);
  return (
    <div className="example example-hero not-content">
      <PdfDocument source={sampleUrl(file)}>
        <div className="example-toolbar" role="toolbar" aria-label="Viewer controls">
          <label>
            <span className="sr-only">Document</span>
            <select value={file} onChange={(event) => setFile(event.target.value)}>
              {samples
                .filter((candidate) => HERO_SAMPLES.includes(candidate.file))
                .map((candidate) => (
                  <option key={candidate.file} value={candidate.file}>
                    {candidate.title}
                  </option>
                ))}
            </select>
          </label>
          <PageControls />
          <span className="spacer" />
          <DocumentStatus className="example-status" />
          <ZoomControls fit={false} />
        </div>
        <PdfViewport className="example-viewport" label={sample?.title} />
      </PdfDocument>
      <p className="example-note">
        {sample?.about}.{" "}
        {sample && !sample.generated ? (
          <>
            Source: <a href={sample.sourceUrl}>{sample.source}</a> (
            <a href={corpusReadme}>license</a>).{" "}
          </>
        ) : null}
        <a href="/demo/">Open the full demo</a> for search, thumbnails, annotations, and your own
        files.
      </p>
    </div>
  );
}
