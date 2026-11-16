import {
  PdfDocument,
  PdfThumbnails,
  PdfViewer,
  preloadDocument,
  useDocumentState,
  useOutline,
  useSession,
  useViewState,
} from "parapdf";
import { Suspense, useEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { configureEngine } from "../src/engines.ts";

/** The same consumer rendered on the server, hydrated twice, and mounted once in the browser. */
export function Reader() {
  return (
    <PdfDocument source="/corpus/usrguide.pdf">
      <DocumentStatus />
    </PdfDocument>
  );
}

function DocumentStatus() {
  const { status } = useDocumentState();
  const session = useSession();
  return (
    <output>{status === "ready" ? (session.proxy?.numPages ?? "missing proxy") : status}</output>
  );
}

/** The outer boundary mounts this consumer only after the password request settles its outline. */
function AnswerPassword() {
  const session = useSession();
  const status = useDocumentState((state) => state.status);
  useOutline();
  useEffect(() => {
    if (status === "password") session.submitPassword("parapdf");
  }, [session, status]);
  return <DocumentStatus />;
}

function container(id: string, markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.id = id;
  element.innerHTML = markup;
  document.body.append(element);
  return element;
}

export function hydrateFirst(markup: string, engine: string): void {
  configureEngine(engine, true, undefined, undefined);
  hydrateRoot(container("first", markup), <Reader />, { onRecoverableError: console.error });
}

export function mountOthers(markup: string): void {
  hydrateRoot(container("hydrated", markup), <Reader />, { onRecoverableError: console.error });
  createRoot(container("joined")).render(<Reader />);
  createRoot(container("encrypted")).render(
    <Suspense fallback="Reading the document">
      <PdfDocument source="/corpus/synthetic-encrypted.pdf">
        <AnswerPassword />
      </PdfDocument>
    </Suspense>,
  );
}

function WarmToolbar() {
  const { currentPage, pageCount } = useViewState();
  const scale = useViewState((s) => s.scale);
  return <output data-warm-toolbar={`${currentPage}/${pageCount}/${scale > 0}`} />;
}

/** Verify warm <PdfDocument> + <PdfViewer> settles useViewState and <PdfThumbnails> synchronously before paint. */
export async function checkWarmMountPrePaint(): Promise<{
  toolbar: string | null;
  thumbs: number;
  currentThumb: string | null;
  sections: number;
}> {
  preloadDocument("/corpus/usrguide.pdf#page=2");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const element = container("warm-pre-paint");
  const root = createRoot(element);
  try {
    flushSync(() => {
      root.render(
        <PdfDocument source="/corpus/usrguide.pdf#page=2">
          <WarmToolbar />
          <PdfThumbnails style={{ height: 320, overflow: "auto" }} />
          <PdfViewer style={{ width: 800, height: 600 }} />
        </PdfDocument>,
      );
    });
    return {
      toolbar:
        element.querySelector("output[data-warm-toolbar]")?.getAttribute("data-warm-toolbar") ??
        null,
      thumbs: element.querySelectorAll("nav ol li").length,
      currentThumb:
        element
          .querySelector('nav ol li button[aria-current="page"]')
          ?.getAttribute("aria-label") ?? null,
      sections: element.querySelectorAll(".parapdf-pages > section").length,
    };
  } finally {
    flushSync(() => root.unmount());
    element.remove();
  }
}
