import { documentRequestMode, loadPdfjs } from "../../../packages/parapdf/src/pdfjs/loader.ts";

// Match minimal.html's fit-width viewport and the default 12 CSS px page gaps.
// Only this reference knows in advance that it needs page 1 and nothing else.
const scroller = document.querySelector<HTMLElement>("main");
if (!scroller) throw new Error("Missing viewport");
const file = new URLSearchParams(location.search).get("file");
const url = `/corpus/${file}`;
const mode = documentRequestMode({});
if (mode) {
  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "fetch";
  preload.crossOrigin = mode;
  preload.href = url;
  document.head.append(preload);
}

const { pdfjs, worker, documentParameters } = await loadPdfjs();
const doc = await pdfjs.getDocument({ ...documentParameters, worker, url }).promise;
const page = await doc.getPage(1);
const cssWidth = scroller.clientWidth - 24;
const cssScale = cssWidth / page.getViewport({ scale: 1 }).width;
const viewport = page.getViewport({ scale: cssScale * devicePixelRatio });
const canvas = document.createElement("canvas");
canvas.width = Math.floor(viewport.width + 1e-6);
canvas.height = Math.floor(viewport.height + 1e-6);
canvas.style.width = `${cssWidth}px`;
await page.render({ canvas, viewport }).promise;
scroller.append(canvas);
