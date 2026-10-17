/**
 * Viewer styles, injected once through React 19's `<style href precedence>`.
 *
 * The `.parapdf-text-layer` rules are derived from the `.textLayer` rules in
 * PDF.js `web/pdf_viewer.css` (Copyright Mozilla Foundation, Apache License
 * 2.0; see NOTICE.md). pdf.js's `TextLayer` sizes and positions its runs
 * through these custom properties, so the rules must match its expectations.
 */
export const VIEWER_CSS = `
.parapdf-text-layer {
  color-scheme: only light;
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 1;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.parapdf-text-layer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}
.parapdf-text-layer > :not(.markedContent),
.parapdf-text-layer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.parapdf-text-layer .markedContent { display: contents; }
.parapdf-text-layer span[role="img"] { user-select: none; cursor: default; }
.parapdf-text-layer ::selection {
  background: rgba(0 0 255 / 0.25);
  background: color-mix(in srgb, AccentColor, transparent 50%);
  color: transparent;
}
.parapdf-text-layer br::selection { background: transparent; }
.parapdf-text-layer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
}
.parapdf-text-layer.selecting .endOfContent { top: 0; }
.parapdf-text-layer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.parapdf-text-layer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.parapdf-text-layer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
::highlight(parapdf-search) { background-color: rgb(255 200 0 / 0.45); }
::highlight(parapdf-search-current) { background-color: rgb(255 110 0 / 0.65); }
.parapdf-viewport:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
`;
