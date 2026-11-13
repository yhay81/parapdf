import {
  PdfDocument,
  PdfViewer,
  type PdfViewerProps,
  searchOf,
  useAnnotationEditing,
  useCreateViewer,
  useOutline,
  useSession,
  useViewer,
  type Viewer,
} from "parapdf";
import { Activity, type ReactNode, Suspense, useEffect, useState, useTransition } from "react";
import { type DemoFeatures, ViewerFeatures } from "./ViewerFeatures.tsx";

declare global {
  interface Window {
    /** Hooks for the lifetimes scripts/check-lifecycle.ts puts the document through. */
    __lifetimes?: {
      /** Shows another file of the corpus, in a transition (`lifetimes=transition`). */
      open?: (file: string) => void;
      /** Hides or shows the document and its viewer (`lifetimes=activity`). */
      show?: (visible: boolean) => void;
    };
  }
}

const hooks = () => {
  window.__lifetimes ??= {};
  return window.__lifetimes;
};

export type Lifetime = "above" | "transition" | "activity";

interface TreeProps {
  file: string;
  viewerProps: PdfViewerProps;
  features: DemoFeatures;
}

/**
 * The ways React keeps, abandons, and hides what it renders, which a document
 * and its viewer live through (`?lifetimes=`):
 *
 * - `above`: the application's Suspense boundary is above the provider, and
 *   what reads the document below it has no boundary of its own, so that
 *   React mounts nothing of the provider before the document was read.
 * - `transition`: `__lifetimes.open(file)` gives the provider another source
 *   in a transition, which commits only once what reads the document in a
 *   boundary that already shows has it.
 * - `activity`: `__lifetimes.show(visible)` hides and shows the provider and
 *   its viewer in an `<Activity>`, which destroys their effects and keeps
 *   their state. With `owner=outside` the viewer's owner stays outside it.
 */
export default function Lifetimes({
  lifetime,
  owner,
  ...tree
}: TreeProps & { lifetime: Lifetime; owner: "inside" | "outside" }) {
  if (lifetime === "above") {
    return (
      <Suspense fallback={<div className="status">Reading the document…</div>}>
        <Shown {...tree}>
          <Outline />
        </Shown>
      </Suspense>
    );
  }
  if (lifetime === "transition") return <Switching {...tree} />;
  return owner === "outside" ? (
    <OwnedOutside {...tree} />
  ) : (
    <Hideable>
      <Shown {...tree}>
        <OutlineOnceRead />
      </Shown>
    </Hideable>
  );
}

function Shown({
  viewer,
  file,
  viewerProps,
  features,
  children,
}: TreeProps & { viewer?: Viewer; children: ReactNode }) {
  return (
    <PdfDocument source={`/corpus/${file}`} viewer={viewer}>
      <Probes />
      <div className="toolbar" data-file={file}>
        {children}
      </div>
      <PdfViewer {...viewerProps} className="viewport">
        <ViewerFeatures features={features} />
      </PdfViewer>
    </PdfDocument>
  );
}

/** Exposes the viewer, its session, and its features to the checks, as the demo does. */
function Probes() {
  const viewer = useViewer();
  window.__viewer = viewer;
  window.__session = useSession();
  window.__search = searchOf(viewer);
  window.__annotations = useAnnotationEditing();
  return null;
}

/** What the document's outline holds, which suspends until the document gave it. */
function Outline() {
  const outline = useOutline();
  return (
    <span className="message" data-outline={outline.length}>
      {outline.length} outline entries
    </span>
  );
}

const OutlineOnceRead = () => (
  <Suspense fallback={<span className="message">Reading the outline…</span>}>
    <Outline />
  </Suspense>
);

function Switching({ file, viewerProps, features }: TreeProps) {
  const [shown, setShown] = useState(file);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    hooks().open = (next) => startTransition(() => setShown(next));
  }, []);
  return (
    <Shown file={shown} viewerProps={viewerProps} features={features}>
      <OutlineOnceRead />
      <span className="message" data-pending={pending}>
        {pending ? "Opening…" : shown}
      </span>
    </Shown>
  );
}

function Hideable({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    hooks().show = setVisible;
  }, []);
  return <Activity mode={visible ? "visible" : "hidden"}>{children}</Activity>;
}

/** The viewer's owner stays shown while React hides the provider and the viewport. */
function OwnedOutside(tree: TreeProps) {
  const viewer = useCreateViewer();
  return (
    <Hideable>
      <Shown viewer={viewer} {...tree}>
        <OutlineOnceRead />
      </Shown>
    </Hideable>
  );
}
