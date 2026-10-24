import { PdfDocument, type PdfSource, PdfViewport, type ViewState } from "parapdf";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Sample, samples, sampleUrl } from "../../samples.ts";
import { AnnotationBar } from "./AnnotationBar.tsx";
import { DropHint, ErrorNotice, LoadingBar, PasswordDialog } from "./Overlays.tsx";
import { type Panel, SidePanel } from "./SidePanel.tsx";
import { Toolbar } from "./Toolbar.tsx";

/** A sample from the site, or a file the reader opened, which stays in the browser. */
export type Opened = { sample: Sample } | { name: string; data: Uint8Array };

/**
 * The document shown, and whether its viewer edits annotations. Options
 * apply when a viewer is created, so either change makes a new viewer: one
 * for another document opens it at its start, and one that starts editing
 * opens at `view`, where the reader was. Editing then stays on, with the
 * tools shown or not, so that what the reader drew stays too.
 */
interface Session {
  id: number;
  opened: Opened;
  editing: boolean;
  view?: ViewState | null;
}

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
  const [session, setSession] = useState<Session>(() => ({
    id: 0,
    opened: { sample: sampleFromUrl() },
    editing: false,
  }));
  const { opened } = session;
  const [annotating, setAnnotating] = useState(false);
  const [sidebar, setSidebar] = useState(() => matchMedia("(min-width: 60rem)").matches);
  const [panel, setPanel] = useState<Panel>("thumbnails");
  const [finding, setFinding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const open = (next: Opened | null) => {
    if (next)
      setSession((current) => ({ id: current.id + 1, opened: next, editing: current.editing }));
  };
  const showAnnotationTools = (next: boolean, view: ViewState | null) => {
    setAnnotating(next);
    if (next && !session.editing) {
      setSession((current) => ({ ...current, id: current.id + 1, editing: true, view }));
    }
  };

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
        event.preventDefault();
        const input = document.getElementById("demo-search") as HTMLInputElement | null;
        if (!input) setFinding(true);
        input?.focus();
        input?.select();
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
      void readPdf(event.dataTransfer?.files[0]).then((file) =>
        setSession((current) =>
          file ? { id: current.id + 1, opened: file, editing: current.editing } : current,
        ),
      );
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
      <PdfDocument
        key={session.id}
        source={source}
        options={{
          forms: true,
          annotationEditing: session.editing,
          initialViewState: session.view ?? undefined,
        }}
      >
        <Toolbar
          opened={opened}
          onOpen={open}
          onOpenFile={() => fileInput.current?.click()}
          sidebar={sidebar}
          onSidebarChange={setSidebar}
          onShowInfo={() => {
            setPanel("info");
            setSidebar(true);
          }}
          finding={finding}
          onFindingChange={setFinding}
          annotating={annotating}
          onAnnotatingChange={showAnnotationTools}
        />
        <div className="demo-main">
          {sidebar ? (
            <>
              <SidePanel
                panel={panel}
                onPanelChange={setPanel}
                onClose={() => setSidebar(false)}
                opened={opened}
              />
              {/* Phones show the sidebar over the pages; a tap beside it closes it. */}
              <button
                type="button"
                className="demo-scrim"
                aria-label="Close the sidebar"
                tabIndex={-1}
                onClick={() => setSidebar(false)}
              />
            </>
          ) : null}
          <div className="demo-stage">
            <PdfViewport className="demo-viewport" label={title} />
            <LoadingBar />
            <ErrorNotice
              onRetry={() => setSession((current) => ({ ...current, id: current.id + 1 }))}
            />
            <PasswordDialog
              title={title}
              hint={
                "sample" in opened && opened.sample.file === "synthetic-encrypted.pdf"
                  ? "parapdf"
                  : undefined
              }
            />
            {annotating ? (
              <AnnotationBar onDone={(view) => showAnnotationTools(false, view)} />
            ) : null}
          </div>
        </div>
      </PdfDocument>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          void readPdf(event.target.files?.[0]).then(open);
          event.target.value = "";
        }}
      />
      {dragging ? <DropHint /> : null}
    </div>
  );
}
