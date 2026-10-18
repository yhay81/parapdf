/**
 * Viewer styles, injected once through React 19's `<style href precedence>`.
 *
 * The `.parapdf-text-layer` and `.parapdf-annotation-layer` rules are derived
 * from the `.textLayer` and `.annotationLayer` rules in PDF.js
 * `web/pdf_viewer.css` (Copyright Mozilla Foundation, Apache License 2.0; see
 * NOTICE.md). pdf.js's `TextLayer` and `AnnotationLayer` size and position
 * their elements through these classes and custom properties, so the rules
 * must match its expectations.
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
.parapdf-annotation-layer {
  color-scheme: only light;
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform-origin: 0 0;
  z-index: 3;
}
@media screen and (forced-colors: active) {
  .parapdf-annotation-layer .linkAnnotation { outline: 1.5px solid LinkText; }
}
.parapdf-annotation-layer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.parapdf-annotation-layer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.parapdf-annotation-layer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
.parapdf-annotation-layer section {
  position: absolute;
  text-align: initial;
  pointer-events: auto;
  box-sizing: border-box;
  transform-origin: 0 0;
  user-select: none;
}
.parapdf-annotation-layer section .overlaidText {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  display: inline-block;
  overflow: hidden;
}
.parapdf-text-layer.selecting ~ .parapdf-annotation-layer section { pointer-events: none; }
.parapdf-annotation-layer .linkAnnotation > a {
  position: absolute;
  font-size: 1em;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.parapdf-annotation-layer .linkAnnotation:not(.hasBorder) > a:hover {
  opacity: 0.2;
  background-color: rgb(255 255 0);
}
.parapdf-annotation-layer .linkAnnotation.hasBorder:hover { background-color: rgb(255 255 0 / 0.2); }
.parapdf-annotation-layer .hasBorder { background-size: 100% 100%; }
.parapdf-annotation-layer .linkAnnotation > a:focus-visible {
  outline: 2px solid Highlight;
  outline-offset: 1px;
}
::highlight(parapdf-search) { background-color: rgb(255 200 0 / 0.45); }
::highlight(parapdf-search-current) { background-color: rgb(255 110 0 / 0.65); }
.parapdf-viewport:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
`;
