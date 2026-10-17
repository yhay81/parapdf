// The pdf.js master build has no bundled typings; it shares the released API surface.
declare module "pdfjs-next/pdf.mjs" {
  export * from "pdfjs-dist";
}
