import type * as Pdfjs from "pdfjs-dist";

type PdfjsOutline = NonNullable<Awaited<ReturnType<Pdfjs.PDFDocumentProxy["getOutline"]>>>;

/**
 * A link target as pdf.js gives it in the outline and to links: the name of
 * a destination the document defines, or an explicit destination array.
 */
export type Destination = NonNullable<PdfjsOutline[number]["dest"]>;

/**
 * Where a destination points: a page and an optional point in PDF points from
 * its top-left corner, with the page's own rotation applied but no view rotation.
 */
export interface ResolvedDestination {
  pageIndex: number;
  x: number | null;
  y: number | null;
  /** The view the destination asks for; absent when it asks for none. */
  view?: DestinationView;
}

/**
 * The zoom a destination asks for (PDF 32000-1, 12.3.2.2): a zoom factor
 * (`XYZ`, 1 for the page's printed size; null keeps the zoom), the whole
 * page (`Fit`, `FitB`), its width (`FitH`, `FitBH`) or height (`FitV`,
 * `FitBV`), or a rectangle (`FitR`) whose top-left corner is the
 * destination's point, in PDF points with the page's own rotation applied.
 */
export type DestinationView =
  | { fit: "zoom"; zoom: number | null }
  | { fit: "page" }
  | { fit: "width" }
  | { fit: "height" }
  | { fit: "rect"; width: number; height: number };

/** An explicit destination's page, point, and view (PDF 32000-1, 12.3.2.2); null if it is not one. */
export async function resolveExplicit(
  doc: Pdfjs.PDFDocumentProxy,
  getPage: (pageIndex: number) => Promise<Pdfjs.PDFPageProxy>,
  explicit: unknown,
): Promise<ResolvedDestination | null> {
  if (!Array.isArray(explicit)) return null;
  const [target, mode, ...args] = explicit as [unknown, { name?: string }?, ...unknown[]];
  let pageIndex: number;
  if (Number.isInteger(target)) pageIndex = target as number;
  else if (target && typeof target === "object") {
    pageIndex = await doc.getPageIndex(target as Parameters<typeof doc.getPageIndex>[0]);
  } else return null;
  const num = (value: unknown) => (typeof value === "number" ? value : null);
  // [left, top] in PDF user space, and the view asked for.
  let left: number | null = null;
  let top: number | null = null;
  let view: DestinationView | undefined;
  let corner: [number, number] | null = null;
  switch (mode?.name) {
    case "XYZ":
      left = num(args[0]);
      top = num(args[1]);
      // 0 and null keep the zoom.
      view = { fit: "zoom", zoom: num(args[2]) || null };
      break;
    case "Fit":
    case "FitB":
      view = { fit: "page" };
      break;
    case "FitH":
    case "FitBH":
      top = num(args[0]);
      view = { fit: "width" };
      break;
    case "FitV":
    case "FitBV":
      left = num(args[0]);
      view = { fit: "height" };
      break;
    case "FitR": {
      const [x1 = null, y1 = null, x2 = null, y2 = null] = args.map(num);
      if (x1 === null || y1 === null || x2 === null || y2 === null) break;
      left = Math.min(x1, x2);
      top = Math.max(y1, y2);
      corner = [Math.max(x1, x2), Math.min(y1, y2)];
      break;
    }
  }
  const resolved = (x: number | null, y: number | null): ResolvedDestination =>
    view ? { pageIndex, x, y, view } : { pageIndex, x, y };
  if (left === null && top === null) return resolved(null, null);
  const viewport = (await getPage(pageIndex)).getViewport({ scale: 1 });
  const [x = 0, y = 0] = viewport.convertToViewportPoint(left ?? 0, top ?? 0);
  if (corner) {
    // The rectangle's corners on the page as it shows, whichever way it turns.
    const [cx = 0, cy = 0] = viewport.convertToViewportPoint(...corner);
    view = { fit: "rect", width: Math.abs(cx - x), height: Math.abs(cy - y) };
    return resolved(Math.min(x, cx), Math.min(y, cy));
  }
  const quarter = viewport.rotation % 180 !== 0;
  return resolved(
    (quarter ? top : left) === null ? null : x,
    (quarter ? left : top) === null ? null : y,
  );
}

/** Where a named or explicit destination points; null when it points nowhere. */
export async function resolveDestination(
  doc: Pdfjs.PDFDocumentProxy,
  getPage: (pageIndex: number) => Promise<Pdfjs.PDFPageProxy>,
  dest: Destination,
): Promise<ResolvedDestination | null> {
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  return resolveExplicit(doc, getPage, explicit);
}
