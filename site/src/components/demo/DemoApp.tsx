import {
  download,
  PdfDocument,
  type PdfSource,
  PdfViewer,
  useAnnotations,
  useFormChange,
  useViewer,
} from "parapdf";
import { Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type Sample, samples, sampleUrl } from "../../samples.ts";
import { AnnotationBar } from "./AnnotationBar.tsx";
import { DropHint, ErrorNotice, LoadingBar, PasswordDialog } from "./Overlays.tsx";
import { type Panel, SidePanel } from "./SidePanel.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { useDemoViewer, ViewerContext } from "./viewer.ts";

/** A sample from the site, or a file the reader opened, which stays in the browser. */
export type Opened = { sample: Sample } | { name: string; data: Uint8Array };

/**
 * The document shown, and whether its viewer edits annotations. Options are
 * live: the viewer starts editing where the reader is. Editing then stays
 * on, with the tools shown or not, so that what the reader drew stays too.
 */
interface Session {
  id: number;
  opened: Opened;
  editing: boolean;
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

/** Calls `onEdit` once the reader fills in a form field or creates, changes, or deletes an annotation. */
function EditWatcher({ onEdit }: { onEdit: () => void }) {
  const viewer = useDemoViewer();
  useFormChange(viewer, onEdit);
  // The viewer outlives the document: its editing state as this document
  // opens may still be the last one's, so only later states count.
  const state = useAnnotations(viewer)?.state;
  const opened = useRef(state);
  useEffect(() => {
    if (state !== opened.current && state?.canUndo) onEdit();
  }, [state, onEdit]);
  return null;
}

const DISCARD = "Discard your changes to this document? Download it first to keep them.";

/**
 * The full viewer: every sample or your own PDF, with the controls ParaPDF
 * offers. Showing or hiding the annotation tools keeps the reading position,
 * the annotations, and the form values. Opening another document discards
 * them, after asking while some were not downloaded.
 */
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
  const viewer = useViewer();
  /** Whether the reader changed the document since it opened or was last downloaded. */
  const unsaved = useRef(false);
  const markUnsaved = useCallback(() => {
    unsaved.current = true;
  }, []);

  /** Shows `next` in place of the document shown, unless the reader keeps unsaved changes. */
  const replace = (next: Opened) => {
    if (unsaved.current && !confirm(DISCARD)) return;
    unsaved.current = false;
    setSession((current) => ({ id: current.id + 1, opened: next, editing: current.editing }));
  };
  const replaceDropped = useEffectEvent(replace);
  const open = (next: Opened | null) => {
    if (next) replace(next);
  };
  const save = async () => {
    // Changes made while the download is written stay unsaved.
    unsaved.current = false;
    try {
      await download(viewer);
    } catch (error) {
      unsaved.current = true;
      throw error;
    }
  };
  const showAnnotationTools = (next: boolean) => {
    setAnnotating(next);
    if (next) setSession((current) => ({ ...current, editing: true }));
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
      void readPdf(event.dataTransfer?.files[0]).then((file) => {
        if (file) replaceDropped(file);
      });
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
      <ViewerContext value={viewer}>
        <PdfDocument key={session.id} source={source}>
          <EditWatcher onEdit={markUnsaved} />
          <Toolbar
            opened={opened}
            onOpen={open}
            onOpenFile={() => fileInput.current?.click()}
            onDownload={() => void save()}
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
                {/* The document's lists load apart from the pages, which never wait for them. */}
                <Suspense fallback={null}>
                  <SidePanel
                    panel={panel}
                    onPanelChange={setPanel}
                    onClose={() => setSidebar(false)}
                    opened={opened}
                  />
                </Suspense>
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
              <PdfViewer
                viewer={viewer}
                className="demo-viewport"
                label={title}
                forms
                annotationEditing={session.editing}
              />
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
              {annotating ? <AnnotationBar onDone={() => showAnnotationTools(false)} /> : null}
            </div>
          </div>
        </PdfDocument>
      </ViewerContext>
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
