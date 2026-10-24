import type { PageText } from "../pdfjs/text.ts";
import { joinLines, sourceChars, type TextPosition } from "./text-search.ts";

/** A place in the document's text: before `offset` UTF-16 code units of item `item` of a page. */
export interface TextPoint extends TextPosition {
  pageIndex: number;
}

/**
 * How text reads where a line ends: "keep" (the default) ends each line
 * with "\n"; "join" joins lines as search does, without a space inside a
 * CJK run or a word hyphenated across lines, and with one elsewhere.
 */
export type LineBreaks = "keep" | "join";

export interface TextOptions {
  /**
   * Where the text starts: a page index for the start of that page, or a
   * point such as a search match's start. The document's start by default.
   */
  from?: number | TextPoint;
  /**
   * Where the text ends: a page index for the end of that page, or a point,
   * excluded, such as a search match's end. The document's end by default.
   */
  to?: number | TextPoint;
  lineBreaks?: LineBreaks;
  /** Aborting rejects the promise with the signal's reason. */
  signal?: AbortSignal;
}

/** One page's part of a document's text. */
export interface PageTextContent {
  pageIndex: number;
  text: string;
  /** Where the page's text starts in the joined text. */
  offset: number;
}

export interface DocumentText {
  /** The pages' texts in document order, an empty line ("\n\n") between pages. */
  text: string;
  pages: readonly PageTextContent[];
}

/** Between two pages of the joined text. */
export const PAGE_SEPARATOR = "\n\n";

/** Whether (item, offset) comes before `point`'s place on a page. */
const before = (item: number, offset: number, point: TextPosition): boolean =>
  item < point.item || (item === point.item && offset < point.offset);

/**
 * The text of `page` from `from` (included) to `to` (excluded), positions on
 * that page; the whole page without them. Items read in content order, as
 * the search index and the text layer read them.
 */
export function pageText(
  page: PageText,
  lineBreaks: LineBreaks = "keep",
  from: TextPosition | null = null,
  to: TextPosition | null = null,
): string {
  if (lineBreaks === "keep" && !from && !to) {
    let text = "";
    const last = page.items.length - 1;
    page.items.forEach((str, item) => {
      text += str;
      if (page.endsLine[item] && item < last) text += "\n";
    });
    return text;
  }
  const chars = sourceChars(page);
  const stream = lineBreaks === "join" ? joinLines(chars) : chars;
  let text = "";
  // A line end read as a space is written only before more text, and only
  // between characters that are not spaces already.
  let pendingSpace = false;
  for (const { char, item, start } of stream) {
    if (from && before(item, start, from)) continue;
    if (to && !before(item, start, to)) break;
    const lineEnd = char === "\n" || (lineBreaks === "join" && start === page.items[item]?.length);
    if (lineEnd) {
      if (lineBreaks === "keep") text += "\n";
      else if (text && !/\s$/u.test(text)) pendingSpace = true;
      continue;
    }
    if (pendingSpace && !/^\s/u.test(char)) text += " ";
    pendingSpace = false;
    text += char;
  }
  // A page's text ends with its last character, not with its last line end.
  return lineBreaks === "keep" && !to ? text.replace(/\n$/u, "") : text;
}
