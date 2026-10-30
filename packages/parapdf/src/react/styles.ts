// Derived from PDF.js `web/pdf_viewer.css` (pdfjs-dist 6.4.299), Copyright
// Mozilla Foundation, Apache License 2.0, and changed for ParaPDF; see
// NOTICE.md.

/**
 * Viewer styles, injected once through React 19's `<style href precedence>`.
 *
 * The `.parapdf-text-layer` and `.parapdf-annotation-layer` rules are derived
 * from the `.textLayer` and `.annotationLayer` rules in PDF.js
 * `web/pdf_viewer.css`: links, form fields, and comment popups, without the
 * editor's rules. pdf.js's `TextLayer` and `AnnotationLayer` size and position
 * their elements through these classes and custom properties, so the rules
 * must match its expectations. Like pdf.js's, they declare
 * `-webkit-user-select` next to `user-select`: Playwright's WebKit 27.2
 * parses `user-select` but follows only the prefixed property when the mouse
 * selects text.
 *
 * The `.before-selection` and `.parapdf-pages.selecting` rules are ParaPDF's
 * own, for drag selections (see `TextSelectionTracker`): the first makes a
 * text layer's `.endOfContent` selectable in WebKit and Firefox, the second
 * leaves only the text layers selectable, not the space between and beside
 * the pages, nor the last pixel row or column of a page whose box, rounded to
 * whole pixels, is larger than its text layer, which pdf.js rounds down.
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
  -webkit-user-select: text;
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
.parapdf-text-layer span[role="img"] { -webkit-user-select: none; user-select: none; cursor: default; }
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
  -webkit-user-select: none;
  user-select: none;
}
.parapdf-text-layer.selecting .endOfContent { top: 0; }
.parapdf-text-layer.before-selection .endOfContent { -webkit-user-select: text; user-select: text; }
.parapdf-structure { position: absolute; top: 0; left: 0; width: 0; height: 0; }
.parapdf-overlay-layer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform-origin: 0 0;
  z-index: 2;
}
.parapdf-overlay-layer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.parapdf-overlay-layer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.parapdf-overlay-layer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
.parapdf-text-layer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.parapdf-text-layer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.parapdf-text-layer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
.parapdf-annotation-layer {
  color-scheme: only light;
  --annotation-unfocused-field-background: url("data:image/svg+xml;charset=UTF-8,<svg width='1px' height='1px' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' style='fill:rgba(0, 54, 255, 0.13);'/></svg>");
  --annotation-unfocused-field-filter: url("data:image/svg+xml;charset=UTF-8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='parapdfFillableField' x='0%' y='0%' width='100%' height='100%' color-interpolation-filters='sRGB'><feFlood flood-color='rgb(0,54,255)' flood-opacity='0.13' result='f'/><feComposite in='f' in2='SourceGraphic' operator='over'/></filter></svg>#parapdfFillableField");
  --input-focus-border-color: Highlight;
  --input-focus-outline: 1px solid Canvas;
  --input-unfocused-border-color: transparent;
  --input-disabled-border-color: transparent;
  --input-hover-border-color: black;
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform-origin: 0 0;
  z-index: 3;
}
@media screen and (forced-colors: active) {
  .parapdf-annotation-layer {
    --input-focus-border-color: CanvasText;
    --input-unfocused-border-color: ActiveText;
    --input-disabled-border-color: GrayText;
    --input-hover-border-color: Highlight;
  }
  .parapdf-annotation-layer .linkAnnotation { outline: 1.5px solid LinkText; }
  .parapdf-annotation-layer .linkAnnotation > a:hover { opacity: 0 !important; background: none !important; box-shadow: none; }
  .parapdf-annotation-layer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select, .buttonWidgetAnnotation:is(.checkBox, .radioButton) input):required { outline: 1.5px solid selectedItem; }
  .parapdf-annotation-layer .popupAnnotation .popup {
    outline: calc(1.5px * var(--total-scale-factor)) solid CanvasText !important;
    background-color: ButtonFace !important;
    color: ButtonText !important;
  }
  .parapdf-annotation-layer .popupAnnotation.focused .popup { outline: calc(3px * var(--total-scale-factor)) solid Highlight !important; }
}
.parapdf-annotation-layer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.parapdf-annotation-layer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.parapdf-annotation-layer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
.parapdf-annotation-layer[data-main-rotation="90"] .norotate { transform: rotate(270deg) translateX(-100%); }
.parapdf-annotation-layer[data-main-rotation="180"] .norotate { transform: rotate(180deg) translate(-100%, -100%); }
.parapdf-annotation-layer[data-main-rotation="270"] .norotate { transform: rotate(90deg) translateY(-100%); }
.parapdf-annotation-layer .annotationContent { position: absolute; width: 100%; height: 100%; pointer-events: none; }
.parapdf-annotation-layer .annotationContent.freetext {
  background: transparent;
  border: none;
  inset: 0;
  overflow: visible;
  white-space: nowrap;
  font: 10px sans-serif;
  line-height: 1.35;
}
.parapdf-annotation-layer section {
  position: absolute;
  text-align: initial;
  pointer-events: auto;
  box-sizing: border-box;
  transform-origin: 0 0;
  -webkit-user-select: none;
  user-select: none;
}
.parapdf-annotation-layer section:has(div.annotationContent) canvas.annotationContent { display: none; }
.parapdf-annotation-layer section .overlaidText {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  display: inline-block;
  overflow: hidden;
}
.parapdf-annotation-layer .hasOwnCanvas:not(.sandboxModified) :is(input, textarea) { display: none; }
.parapdf-annotation-layer .hasOwnCanvas.sandboxModified canvas.annotationContent { display: none; }
.parapdf-text-layer.selecting ~ .parapdf-annotation-layer section { pointer-events: none; }
.parapdf-annotation-layer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton) > a {
  position: absolute;
  font-size: 1em;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.parapdf-annotation-layer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton):not(.hasBorder) > a:hover {
  opacity: 0.2;
  background-color: rgb(255 255 0);
}
.parapdf-annotation-layer .linkAnnotation.hasBorder:hover { background-color: rgb(255 255 0 / 0.2); }
.parapdf-annotation-layer .hasBorder { background-size: 100% 100%; }
.parapdf-annotation-layer .linkAnnotation > a:focus-visible {
  outline: 2px solid Highlight;
  outline-offset: 1px;
}
.parapdf-annotation-layer .textAnnotation img {
  position: absolute;
  cursor: pointer;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
}
.parapdf-annotation-layer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select, .buttonWidgetAnnotation:is(.checkBox, .radioButton) input) {
  background-image: var(--annotation-unfocused-field-background);
  border: 2px solid var(--input-unfocused-border-color);
  box-sizing: border-box;
  font: calc(9px * var(--total-scale-factor)) sans-serif;
  height: 100%;
  margin: 0;
  vertical-align: top;
  width: 100%;
}
.parapdf-annotation-layer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select, .buttonWidgetAnnotation:is(.checkBox, .radioButton) input):required { outline: 1.5px solid red; }
.parapdf-annotation-layer .choiceWidgetAnnotation select option { padding: 0; }
.parapdf-annotation-layer .textWidgetAnnotation textarea { resize: none; }
.parapdf-annotation-layer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select, .buttonWidgetAnnotation:is(.checkBox, .radioButton) input)[disabled] {
  background: none;
  border: 2px solid var(--input-disabled-border-color);
  cursor: not-allowed;
}
.parapdf-annotation-layer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select, .buttonWidgetAnnotation:is(.checkBox, .radioButton) input):hover { border: 2px solid var(--input-hover-border-color); }
.parapdf-annotation-layer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select, .buttonWidgetAnnotation.checkBox input):hover { border-radius: 2px; }
.parapdf-annotation-layer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select):focus {
  background: none;
  border: 2px solid var(--input-focus-border-color);
  border-radius: 2px;
  outline: var(--input-focus-outline);
}
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton) :focus { background-image: none; background-color: transparent; }
.parapdf-annotation-layer .buttonWidgetAnnotation.checkBox :focus {
  border: 2px solid var(--input-focus-border-color);
  border-radius: 2px;
  outline: var(--input-focus-outline);
}
.parapdf-annotation-layer .buttonWidgetAnnotation.radioButton :focus {
  border: 2px solid var(--input-focus-border-color);
  outline: var(--input-focus-outline);
}
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton) [data-canvas-name] { filter: var(--annotation-unfocused-field-filter); }
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton):focus-within [data-canvas-name] { filter: none; }
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton) [data-canvas-name="checked"]:has(~ input:checked) { display: block; }
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton) [data-canvas-name="checked"]:has(~ input:not(:checked)) { display: none; }
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton) [data-canvas-name="unchecked"]:has(~ input:checked) { display: none; }
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton) [data-canvas-name="unchecked"]:has(~ input:not(:checked)) { display: block; }
.parapdf-annotation-layer .textWidgetAnnotation input.comb {
  --comb-width: 0px;
  --comb-letter-spacing: calc(var(--comb-width) - 1ch);
  font-family: monospace;
  letter-spacing: var(--comb-letter-spacing);
  overflow-x: hidden;
  padding: 0;
  text-indent: calc(var(--comb-offset, 0) * var(--comb-width) + var(--comb-letter-spacing) / 2);
}
.parapdf-annotation-layer .textWidgetAnnotation input.comb:focus {
  background-image: repeating-linear-gradient(
    to right,
    transparent 0 calc(var(--comb-width) - 1px),
    var(--input-focus-border-color) calc(var(--comb-width) - 1px) var(--comb-width)
  );
}
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton) input {
  -webkit-appearance: none;
  appearance: none;
}
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton):has([data-canvas-name="checked"]) input:checked,
.parapdf-annotation-layer .buttonWidgetAnnotation:is(.checkBox, .radioButton):has([data-canvas-name="unchecked"]) input:not(:checked) {
  background-image: none;
}
.parapdf-annotation-layer .fileAttachmentAnnotation .popupTriggerArea { height: 100%; width: 100%; }
.parapdf-annotation-layer .popupAnnotation {
  position: absolute;
  font-size: calc(9px * var(--total-scale-factor));
  pointer-events: none;
  width: max-content;
  max-width: 45%;
  height: auto;
}
.parapdf-annotation-layer .popup {
  background-color: rgb(255 255 153);
  color: black;
  box-shadow: 0 calc(2px * var(--total-scale-factor)) calc(5px * var(--total-scale-factor)) rgb(136 136 136);
  border-radius: calc(2px * var(--total-scale-factor));
  outline: 1.5px solid rgb(255 255 74);
  padding: calc(6px * var(--total-scale-factor));
  cursor: pointer;
  font: message-box;
  white-space: normal;
  word-wrap: break-word;
  pointer-events: auto;
  -webkit-user-select: text;
  user-select: text;
}
.parapdf-annotation-layer .popupAnnotation.focused .popup { outline-width: 3px; }
.parapdf-annotation-layer .popup * { font-size: calc(9px * var(--total-scale-factor)); }
.parapdf-annotation-layer .popup > .header { display: inline-block; }
.parapdf-annotation-layer .popup > .header > .title { display: inline; font-weight: bold; }
.parapdf-annotation-layer .popup > .header .popupDate {
  display: inline-block;
  margin-left: calc(5px * var(--total-scale-factor));
  width: fit-content;
}
.parapdf-annotation-layer .popupContent {
  border-top: 1px solid rgb(51 51 51);
  margin-top: calc(2px * var(--total-scale-factor));
  padding-top: calc(2px * var(--total-scale-factor));
}
.parapdf-annotation-layer .richText > * { white-space: pre-wrap; font-size: calc(9px * var(--total-scale-factor)); }
.parapdf-annotation-layer .popupTriggerArea { cursor: pointer; }
.parapdf-annotation-layer section svg {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
}
.parapdf-annotation-layer .annotationTextContent {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  color: transparent;
  -webkit-user-select: none;
  user-select: none;
  pointer-events: none;
}
.parapdf-annotation-layer .annotationTextContent span { width: 100%; display: inline-block; }
.parapdf-annotation-layer svg.quadrilateralsContainer {
  contain: strict;
  width: 0;
  height: 0;
  position: absolute;
  top: 0;
  left: 0;
  z-index: -1;
}
.parapdf-pages.selecting { -webkit-user-select: none; user-select: none; }
.parapdf-pages.parapdf-no-copy .parapdf-text-layer :is(span, br, .endOfContent) {
  cursor: not-allowed;
  -webkit-user-select: none !important;
  user-select: none !important;
}
.parapdf-pages.selecting .parapdf-text-layer { -webkit-user-select: text; user-select: text; }
::highlight(parapdf-search) { background-color: rgb(255 200 0 / 0.45); }
::highlight(parapdf-search-current) { background-color: rgb(255 110 0 / 0.65); }
.parapdf-viewport:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
.parapdf-viewport.parapdf-hand,
.parapdf-hand .parapdf-text-layer :is(span, br) { cursor: grab; -webkit-user-select: none; user-select: none; }
.parapdf-viewport.parapdf-grabbing,
.parapdf-grabbing .parapdf-pages * { cursor: grabbing; }
`;
