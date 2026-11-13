import { PdfDocument, useDocumentState, useOutline, useSession } from "parapdf";
import { Suspense, useEffect } from "react";
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
