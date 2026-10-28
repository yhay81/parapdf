"use client";

import type { DocumentSession } from "../../document/session.ts";
import type { AnnotationLayerScripting } from "../../pdfjs/annotation-layer.ts";
import { type DocumentScripting, startScripting } from "../../pdfjs/scripting.ts";
import { ZOOM_STEP } from "../../view/input.ts";
import type { Viewer } from "../../view/viewer.ts";

/** A viewer whose form fields run the document's scripts (`formScripts`). */
export interface ScriptingViewer {
  readonly viewer: Viewer;
  /** The scripts changed the value of the field `id`. */
  changed(id: string): void;
}

export interface JoinedScripting {
  /** What the viewer's annotation layers hand their fields' events to. */
  readonly layer: AnnotationLayerScripting;
  /** The viewer no longer runs them; the last one stops the sandbox. */
  leave(): void;
}

/** A session's scripts and the viewers that run them. */
interface Running {
  readonly scripting: DocumentScripting;
  readonly viewers: Set<ScriptingViewer>;
  /** The viewer whose field last sent the scripts an event: their requests act on it. */
  last: ScriptingViewer | null;
  /** Stops following the current page of the first viewer. */
  unfollow: () => void;
}

/** One sandbox per session, since it keeps the values of the document's fields. */
const running = new WeakMap<DocumentSession, Running>();

/** pdf.js's zoom of 1 is 100%: 96 CSS pixels per inch of 72 points. */
const PDF_TO_CSS = 96 / 72;

/** The scripts' zoom requests (`this.zoomType`) as the viewer's zoom modes. */
const ZOOM_MODES: Readonly<Record<string, "fit-width" | "fit-page">> = {
  "page-fit": "fit-page",
  "page-height": "fit-page",
  "page-width": "fit-width",
  auto: "fit-width",
};

/** The viewer the scripts' requests act on. */
const target = (run: Running): Viewer | undefined =>
  (run.last ?? run.viewers.values().next().value)?.viewer;

/** The sandbox's PageOpen and PageClose follow the current page of the first viewer. */
function follow(run: Running): void {
  run.unfollow();
  const leader = run.viewers.values().next().value;
  if (!leader) return;
  const { hot } = leader.viewer.store;
  const show = () => run.scripting.showPage(hot.get().currentPage);
  show();
  run.unfollow = hot.subscribe(show);
}

/**
 * What the scripts asked for that is not a field's: moving through the
 * pages, zooming, printing, saving, and writing to the console. pdf.js's
 * sandbox sends navigation only in answer to the reader's own action.
 */
function command(run: Running, session: DocumentSession, name: string, value: unknown): void {
  const viewer = target(run);
  switch (name) {
    case "clear":
      console.clear();
      return;
    case "error":
      console.error(value);
      return;
    case "println":
      console.log(value);
      return;
  }
  if (!viewer) return;
  switch (name) {
    case "page-num":
      if (typeof value === "number") viewer.goToPage(value);
      break;
    case "FirstPage":
      viewer.goToPage(0);
      break;
    case "LastPage":
      viewer.goToPage(session.proxy.numPages - 1);
      break;
    case "NextPage":
      viewer.nextPage();
      break;
    case "PrevPage":
      viewer.previousPage();
      break;
    case "zoom":
      if (typeof value === "number") viewer.setScale(value * PDF_TO_CSS);
      else if (typeof value === "string" && ZOOM_MODES[value]) viewer.setScale(ZOOM_MODES[value]);
      break;
    // The step the viewer's zoom keys take.
    case "ZoomViewIn":
      viewer.zoomBy(ZOOM_STEP);
      break;
    case "ZoomViewOut":
      viewer.zoomBy(1 / ZOOM_STEP);
      break;
    case "print":
      import("../print/index.ts")
        .then(({ print }) => print(viewer))
        .catch((error: unknown) =>
          console.error("printing for the document's scripts failed", error),
        );
      break;
    case "SaveAs":
      import("../download.ts")
        .then(({ download }) => download(viewer))
        .catch((error: unknown) =>
          console.error("saving for the document's scripts failed", error),
        );
      break;
    // `layout` (the page layout) and `WillPrintFinished` (ParaPDF sends no WillPrint) are left out.
  }
}

/**
 * Hand what the scripts changed of the field `id` to its element in each
 * viewer, which shows it and stores it, or, where no viewer has the
 * field's page built, to the storage, which the element applies once built.
 */
function field(run: Running, session: DocumentSession, id: string, update: object): void {
  const storage = session.proxy.annotationStorage;
  const before = (storage.getRawValue(id) as { value?: unknown } | undefined)?.value;
  let shown = false;
  for (const { viewer } of run.viewers) {
    const element = viewer.content?.querySelector(`[data-element-id="${CSS.escape(id)}"]`);
    if (!element) continue;
    element.dispatchEvent(new CustomEvent("updatefromsandbox", { detail: { ...update } }));
    shown = true;
  }
  if (!shown) storage.setValue(id, update);
  const after = (storage.getRawValue(id) as { value?: unknown } | undefined)?.value;
  if ("value" in update && after !== before) {
    for (const member of run.viewers) member.changed(id);
  }
}

/**
 * Run the scripts of `session`'s document for `member`'s viewer: the first
 * viewer starts pdf.js's sandbox, the others share it.
 */
export function joinScripting(session: DocumentSession, member: ScriptingViewer): JoinedScripting {
  let run = running.get(session);
  if (!run) {
    const started: Running = {
      scripting: startScripting(session.pdfjs, session.proxy, member.viewer.sourceName, {
        field: (id, update) => field(started, session, id, update),
        command: (name, value) => command(started, session, name, value),
      }),
      viewers: new Set(),
      last: null,
      unfollow: () => {},
    };
    run = started;
    running.set(session, run);
  }
  const joined = run;
  joined.viewers.add(member);
  if (joined.viewers.size === 1) follow(joined);
  let left = false;
  return {
    layer: {
      dispatch(event) {
        if (left) return;
        joined.last = member;
        joined.scripting.dispatch(event);
      },
    },
    leave() {
      if (left) return;
      left = true;
      const first = joined.viewers.values().next().value === member;
      joined.viewers.delete(member);
      if (joined.last === member) joined.last = null;
      if (joined.viewers.size > 0) {
        if (first) follow(joined);
        return;
      }
      joined.unfollow();
      joined.scripting.destroy();
      running.delete(session);
    },
  };
}
