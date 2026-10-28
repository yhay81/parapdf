import type { PageText } from "../../pdfjs/text.ts";
import { clamp } from "../../view/layout.ts";
import type { Viewer } from "../../view/viewer.ts";
import {
  type DocumentText,
  PAGE_SEPARATOR,
  type PageTextContent,
  pageText,
  type TextOptions,
} from "./document-text.ts";

export type {
  DocumentText,
  LineBreaks,
  PageTextContent,
  TextOptions,
  TextPoint,
} from "./document-text.ts";

/** Pages `getText()` asks pdf.js for ahead of the one it reads. */
const TEXT_READ_AHEAD = 4;

/**
 * The text of `viewer`'s document, read from pdf.js's text content of every
 * page between `from` and `to`, mounted or not: items in content order, as
 * search and the text layers read them, with "\n" where lines end or, with
 * `lineBreaks: "join"`, lines joined as search joins them. Pages are
 * parsed in pdf.js's worker, a few at a time; the texts are kept, so a
 * second read, or a search, parses nothing again. Rejects while no
 * document is open, and once it closes.
 */
export async function getText(viewer: Viewer, options: TextOptions = {}): Promise<DocumentText> {
  const session = viewer.session;
  const work = viewer.workSignal;
  if (!session || !work) throw new Error("No document is open");
  work.throwIfAborted();
  const { from, to, lineBreaks = "keep", signal } = options;
  signal?.throwIfAborted();
  const lastPage = session.pageCount - 1;
  const start = typeof from === "number" ? { pageIndex: from } : from;
  const end = typeof to === "number" ? { pageIndex: to } : to;
  const first = clamp(start?.pageIndex ?? 0, 0, lastPage);
  const last = clamp(end?.pageIndex ?? lastPage, 0, lastPage);
  // Pages are asked for ahead of the one being read: the worker parses
  // them one after another while the main thread joins the text.
  const requested = new Map<number, Promise<PageText>>();
  const request = (pageIndex: number) => {
    if (pageIndex > last || requested.has(pageIndex)) return;
    const text = session.text(pageIndex);
    // Abandoned when the read stops early; the read itself awaits it.
    text.catch(() => {});
    requested.set(pageIndex, text);
  };
  const pages: PageTextContent[] = [];
  let text = "";
  for (let pageIndex = first; pageIndex <= last; pageIndex++) {
    for (let ahead = pageIndex; ahead < pageIndex + TEXT_READ_AHEAD; ahead++) request(ahead);
    const content = await requested.get(pageIndex);
    requested.delete(pageIndex);
    signal?.throwIfAborted();
    if (work.aborted || !content) throw new Error("The document was closed");
    const startsHere = start && "item" in start && start.pageIndex === pageIndex;
    const endsHere = end && "item" in end && end.pageIndex === pageIndex;
    const read = pageText(content, lineBreaks, startsHere ? start : null, endsHere ? end : null);
    if (pages.length > 0) text += PAGE_SEPARATOR;
    pages.push({ pageIndex, text: read, offset: text.length });
    text += read;
  }
  return { text, pages };
}
