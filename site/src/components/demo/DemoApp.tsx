import { PdfDocument, type PdfSource, PdfViewport } from "parapdf";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Sample, samples, sampleUrl } from "../../samples.ts";
import { DocumentStatus, PasswordPrompt, SearchField } from "../controls.tsx";
import { AnnotationBar } from "./AnnotationBar.tsx";
import { type Panel, SidePanel } from "./SidePanel.tsx";
import { ViewBar } from "./ViewBar.tsx";

/** A sample from the site, or a file the reader opened, which stays in the browser. */
export type Opened = { sample: Sample } | { name: string; data: Uint8Array };

const fallback = samples[0] as Sample;

function sampleFromUrl(): Sample {
  const file = new URLSearchParams(location.search).get("file");
  return samples.find((sample) => sample.file === file) ?? fallback;
}

/** A PDF the reader chose or dropped, read into memory: it is never uploaded. */
async function readPdf(file: File | undefined): Promise<Opened | null> {
  if (!file) return null;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return null;
  return { name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
}

/** The full viewer: every sample or your own PDF, with the controls ParaPDF offers. */
export default function DemoApp() {
  const [opened, setOpened] = useState<Opened>(() => ({ sample: sampleFromUrl() }));
  const [annotating, setAnnotating] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(() =>
    matchMedia("(min-width: 60rem)").matches ? "thumbnails" : null,
  );
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const source = useMemo<PdfSource>(
    () => ("sample" in opened ? { url: sampleUrl(opened.sample.file) } : { data: opened.data }),
    [opened],
  );
  const title = "sample" in opened ? opened.sample.title : opened.name;

  useEffect(() => {
    document.title = `${title} · ParaPDF demo`;
    const url = new URL(location.href);
    if ("sample" in opened) url.searchParams.set("file", opened.sample.file);
    else url.searchParams.delete("file");
    history.replaceState(null, "", url);
  }, [opened, title]);

  // The browser's own find sees only mounted pages, so Ctrl or ⌘ with F finds in all of them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        const input = document.getElementById("demo-search") as HTMLInputElement | null;
        if (!input) return;
        event.preventDefault();
        input.focus();
        input.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A PDF dropped anywhere on the page opens in place of the one shown.
  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      // Only leaving the window enters no other element.
      if (event.relatedTarget === null) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      void readPdf(event.dataTransfer?.files[0]).then((file) => file && setOpened(file));
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className="demo">
      {/* Options apply when the viewer is created, so editing annotations makes a new one. */}
      <PdfDocument
        key={annotating ? "annotating" : "viewing"}
        source={source}
        options={{ forms: true, annotationEditing: annotating }}
      >
        <header className="demo-header">
          <a className="demo-brand" href="/">
            <img src="/favicon.svg" alt="" width="22" height="22" />
            ParaPDF
          </a>
          <button
            type="button"
            className="demo-icon"
            aria-label="Sidebar"
            aria-expanded={panel !== null}
            aria-controls="demo-side"
            onClick={() => setPanel(panel ? null : "thumbnails")}
          >
            ☰
          </button>
          <label className="demo-document">
            <span className="demo-visually-hidden">Document</span>
            <select
              value={"sample" in opened ? opened.sample.file : ""}
              onChange={(event) => {
                const sample = samples.find((candidate) => candidate.file === event.target.value);
                if (sample) setOpened({ sample });
              }}
            >
              {"sample" in opened ? null : <option value="">{opened.name}</option>}
              {samples.map((sample) => (
                <option key={sample.file} value={sample.file}>
                  {sample.title}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Open a PDF…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => {
              void readPdf(event.target.files?.[0]).then((file) => file && setOpened(file));
              event.target.value = "";
            }}
          />
          <DocumentStatus className="demo-status" />
          <span className="demo-spacer" />
          <span className="demo-search">
            <SearchField id="demo-search" withOptions />
          </span>
          <a className="demo-docs" href="/getting-started/">
            Docs
          </a>
        </header>
        <ViewBar annotating={annotating} onAnnotatingChange={setAnnotating} />
        {annotating ? <AnnotationBar /> : null}
        <PasswordPrompt
          className="demo-password"
          hint={
            "sample" in opened && opened.sample.file === "synthetic-encrypted.pdf"
              ? "parapdf"
              : undefined
          }
        />
        <div className="demo-main">
          {panel ? <SidePanel panel={panel} onPanelChange={setPanel} opened={opened} /> : null}
          <PdfViewport className="demo-viewport" label={title} />
        </div>
      </PdfDocument>
      {dragging ? (
        <div className="demo-drop" aria-hidden="true">
          Drop a PDF to open it here. It stays in your browser.
        </div>
      ) : null}
    </div>
  );
}
