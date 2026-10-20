import { DELETE_ICON, MENU_ARROW_ICON } from "./editor-icons.ts";

/**
 * Styles of the annotation editor, injected next to the viewer's when
 * `annotationEditing` is on.
 *
 * Derived from the `.annotationEditorLayer`, `.canvasWrapper svg`,
 * `.editToolbar`, `.colorPicker`, and `.textLayer.highlighting` rules in
 * PDF.js `web/pdf_viewer.css` (pdfjs-dist 6.4.299; Copyright Mozilla
 * Foundation, Apache License 2.0; see NOTICE.md): renamed to
 * `.parapdf-editor-layer`, `.parapdf-canvas-wrapper`, and
 * `.parapdf-text-layer`, nesting written out, `light-dark()` resolved to
 * its light colors, as the layers are `color-scheme: only light`. The
 * custom cursors give way to the browser's own; the alt text, comment, and
 * signature dialogs, which ParaPDF does not show, are left out, and their
 * toolbar buttons hidden.
 *
 * pdf.js's editors read `--outline-width` and `--freetext-padding` from the
 * root element, so those two are declared there; the other properties are
 * ParaPDF's, on the viewport.
 */
export const EDITOR_CSS = `
:root {
  --outline-width: 2px;
  --freetext-padding: 2px;
}
.parapdf-viewport {
  --parapdf-editor-toolbar-offset: 6px;
  --parapdf-outline-color: #0060df;
  --parapdf-outline-around-width: 1px;
  --parapdf-outline-around-color: #f0f0f4;
  --parapdf-hover-outline-around-color: var(--parapdf-outline-around-color);
  --parapdf-editor-selection-outline: solid var(--outline-width) var(--parapdf-outline-color);
  --parapdf-unfocus-outline: solid var(--outline-width) transparent;
  --parapdf-focus-outline-around: solid var(--parapdf-outline-around-width) var(--parapdf-outline-around-color);
  --parapdf-hover-outline-color: #8f8f9d;
  --parapdf-hover-outline: solid var(--outline-width) var(--parapdf-hover-outline-color);
  --parapdf-hover-outline-around: solid var(--parapdf-outline-around-width) var(--parapdf-hover-outline-around-color);
  --parapdf-freetext-line-height: 1.35;
  --parapdf-resizer-bg-color: var(--parapdf-outline-color);
  --parapdf-resizer-size: 6px;
  --parapdf-resizer-shift: calc(0px - (var(--outline-width) + var(--parapdf-resizer-size)) / 2 - var(--parapdf-outline-around-width));
}
@media screen and (forced-colors: active) {
  .parapdf-viewport {
    --parapdf-outline-color: CanvasText;
    --parapdf-outline-around-color: ButtonFace;
    --parapdf-resizer-bg-color: ButtonText;
    --parapdf-hover-outline-color: Highlight;
    --parapdf-hover-outline-around-color: SelectedItemText;
  }
}
.parapdf-pages.noUserSelect { -webkit-user-select: none; user-select: none; }
.parapdf-pages.parapdf-annotating .parapdf-annotation-layer :is(section, .popup) { pointer-events: none; }
.parapdf-editor-layer .hidden, .parapdf-canvas-wrapper svg.hidden { display: none !important; }

.parapdf-canvas-wrapper svg { transform: none; }
.parapdf-canvas-wrapper svg.moving { z-index: 100000; }
.parapdf-canvas-wrapper svg:is(.highlight, .highlightOutline)[data-main-rotation="90"] :is(mask, use:not(.clip, .mask)) { transform: matrix(0, 1, -1, 0, 1, 0); }
.parapdf-canvas-wrapper svg:is(.highlight, .highlightOutline)[data-main-rotation="180"] :is(mask, use:not(.clip, .mask)) { transform: matrix(-1, 0, 0, -1, 1, 1); }
.parapdf-canvas-wrapper svg:is(.highlight, .highlightOutline)[data-main-rotation="270"] :is(mask, use:not(.clip, .mask)) { transform: matrix(0, -1, 1, 0, 0, 1); }
.parapdf-canvas-wrapper svg.draw { position: absolute; mix-blend-mode: normal; }
.parapdf-canvas-wrapper svg.draw[data-draw-rotation="90"] { transform: rotate(90deg); }
.parapdf-canvas-wrapper svg.draw[data-draw-rotation="180"] { transform: rotate(180deg); }
.parapdf-canvas-wrapper svg.draw[data-draw-rotation="270"] { transform: rotate(270deg); }
.parapdf-canvas-wrapper svg.highlight { --blend-mode: multiply; position: absolute; mix-blend-mode: var(--blend-mode); }
@media screen and (forced-colors: active) {
  .parapdf-canvas-wrapper svg.highlight { --blend-mode: difference; }
}
.parapdf-canvas-wrapper svg.highlight:not(.free) { fill-rule: evenodd; }
.parapdf-canvas-wrapper svg.highlightOutline { position: absolute; mix-blend-mode: normal; fill-rule: evenodd; fill: none; }
.parapdf-canvas-wrapper svg.highlightOutline:not(.free).hovered:not(.selected) { stroke: var(--parapdf-hover-outline-color); stroke-width: var(--outline-width); }
.parapdf-canvas-wrapper svg.highlightOutline:not(.free).selected .mainOutline { stroke: var(--parapdf-outline-around-color); stroke-width: calc(var(--outline-width) + 2 * var(--parapdf-outline-around-width)); }
.parapdf-canvas-wrapper svg.highlightOutline:not(.free).selected .secondaryOutline { stroke: var(--parapdf-outline-color); stroke-width: var(--outline-width); }
.parapdf-canvas-wrapper svg.highlightOutline.free.hovered:not(.selected) { stroke: var(--parapdf-hover-outline-color); stroke-width: calc(2 * var(--outline-width)); }
.parapdf-canvas-wrapper svg.highlightOutline.free.selected .mainOutline { stroke: var(--parapdf-outline-around-color); stroke-width: calc(2 * (var(--outline-width) + var(--parapdf-outline-around-width))); }
.parapdf-canvas-wrapper svg.highlightOutline.free.selected .secondaryOutline { stroke: var(--parapdf-outline-color); stroke-width: calc(2 * var(--outline-width)); }

.parapdf-text-layer.highlighting { cursor: crosshair; }
.parapdf-text-layer.highlighting:not(.free) span { cursor: text; }
.parapdf-text-layer.highlighting:not(.free) span[role="img"], .parapdf-text-layer.highlighting.free span { cursor: crosshair; }

.parapdf-editor-layer {
  color-scheme: only light;
  background: transparent;
  position: absolute;
  inset: 0;
  font-size: calc(100px * var(--total-scale-factor));
  transform-origin: 0 0;
  cursor: auto;
  z-index: 4;
}
.parapdf-editor-layer[data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.parapdf-editor-layer[data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.parapdf-editor-layer[data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
.parapdf-editor-layer [data-editor-rotation="90"] { transform: rotate(90deg); }
.parapdf-editor-layer [data-editor-rotation="180"] { transform: rotate(180deg); }
.parapdf-editor-layer [data-editor-rotation="270"] { transform: rotate(270deg); }
.parapdf-editor-layer .selectedEditor { z-index: 100000 !important; }
.parapdf-editor-layer.drawing * { pointer-events: none !important; }
.parapdf-editor-layer.getElements, .parapdf-editor-layer.getElements > div { pointer-events: auto !important; }
.parapdf-editor-layer.waiting { cursor: wait; }
.parapdf-editor-layer.disabled { pointer-events: none; }
.parapdf-editor-layer.disabled.highlightEditing :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor) { pointer-events: auto; }
.parapdf-editor-layer.freetextEditing { cursor: text; }
.parapdf-editor-layer.inkEditing { cursor: crosshair; }
.parapdf-editor-layer.inkEditing { touch-action: none; }
.parapdf-editor-layer .draw { box-sizing: border-box; }
.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor) {
  position: absolute;
  background: transparent;
  z-index: 1;
  transform-origin: 0 0;
  cursor: auto;
  max-width: 100%;
  max-height: 100%;
  border: var(--parapdf-unfocus-outline);
}
.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor).draggable.selectedEditor { cursor: move; }
.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor).selectedEditor {
  border: var(--parapdf-editor-selection-outline);
  outline: var(--parapdf-focus-outline-around);
}
.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor).selectedEditor::before {
  content: "";
  position: absolute;
  inset: 0;
  border: var(--parapdf-focus-outline-around);
  pointer-events: none;
}
.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor):hover:not(.selectedEditor) {
  border: var(--parapdf-hover-outline);
  outline: var(--parapdf-hover-outline-around);
}
.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor):hover:not(.selectedEditor)::before {
  content: "";
  position: absolute;
  inset: 0;
  border: var(--parapdf-focus-outline-around);
}

.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .highlightEditor, .signatureEditor) .editToolbar {
  --editor-toolbar-bg-color: #f0f0f4;
  --editor-toolbar-fg-color: #2e2e56;
  --editor-toolbar-border-color: #8f8f9d;
  --editor-toolbar-hover-border-color: var(--editor-toolbar-border-color);
  --editor-toolbar-hover-bg-color: #e0e0e6;
  --editor-toolbar-hover-fg-color: var(--editor-toolbar-fg-color);
  --editor-toolbar-hover-outline: none;
  --editor-toolbar-focus-outline-color: #0060df;
  --editor-toolbar-shadow: 0 2px 6px 0 rgb(58 57 68 / 0.2);
  --editor-toolbar-height: 28px;
  --editor-toolbar-padding: 2px;
  display: flex;
  width: fit-content;
  height: var(--editor-toolbar-height);
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: default;
  pointer-events: auto;
  box-sizing: content-box;
  padding: var(--editor-toolbar-padding);
  -webkit-user-select: none;
  user-select: none;
  position: absolute;
  inset-inline-end: 0;
  inset-block-start: calc(100% + var(--parapdf-editor-toolbar-offset));
  border-radius: 6px;
  background-color: var(--editor-toolbar-bg-color);
  border: 1px solid var(--editor-toolbar-border-color);
  box-shadow: var(--editor-toolbar-shadow);
}
@media screen and (forced-colors: active) {
  .parapdf-editor-layer .editToolbar {
    --editor-toolbar-bg-color: ButtonFace;
    --editor-toolbar-fg-color: ButtonText;
    --editor-toolbar-border-color: ButtonText;
    --editor-toolbar-hover-border-color: AccentColor;
    --editor-toolbar-hover-bg-color: ButtonFace;
    --editor-toolbar-hover-fg-color: AccentColor;
    --editor-toolbar-hover-outline: 2px solid var(--editor-toolbar-hover-border-color);
    --editor-toolbar-focus-outline-color: ButtonBorder;
    --editor-toolbar-shadow: none;
  }
}
.parapdf-editor-layer .editToolbar.hidden { display: none; }
.parapdf-editor-layer .editToolbar:has(:focus-visible) { border-color: transparent; }
.parapdf-editor-layer .editToolbar:dir(ltr) { transform-origin: 100% 0; }
.parapdf-editor-layer .editToolbar:dir(rtl) { transform-origin: 0 0; }
.parapdf-editor-layer .editToolbar .buttons { display: flex; justify-content: center; align-items: center; gap: 0; height: 100%; }
.parapdf-editor-layer .editToolbar .buttons button { padding: 0; }
.parapdf-editor-layer .editToolbar .buttons .divider {
  width: 0;
  height: calc(2 * var(--editor-toolbar-padding) + var(--editor-toolbar-height));
  border-left: 1px solid var(--editor-toolbar-border-color);
  border-right: none;
  display: inline-block;
  margin-inline: 2px;
}
.parapdf-editor-layer .editToolbar .buttons .basic { width: var(--editor-toolbar-height); }
.parapdf-editor-layer .editToolbar .buttons .basic::before {
  content: "";
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  display: inline-block;
  background-color: var(--editor-toolbar-fg-color);
  width: 100%;
  height: 100%;
}
.parapdf-editor-layer .editToolbar .buttons .basic:hover::before { background-color: var(--editor-toolbar-hover-fg-color); }
.parapdf-editor-layer .editToolbar .buttons .basic.deleteButton::before {
  -webkit-mask-image: url("${DELETE_ICON}");
  mask-image: url("${DELETE_ICON}");
}
.parapdf-editor-layer .editToolbar .buttons > * { height: var(--editor-toolbar-height); }
.parapdf-editor-layer .editToolbar .buttons > :not(.divider) { border: none; background-color: transparent; cursor: pointer; }
.parapdf-editor-layer .editToolbar .buttons > :not(.divider):hover {
  border-radius: 2px;
  background-color: var(--editor-toolbar-hover-bg-color);
  color: var(--editor-toolbar-hover-fg-color);
  outline: var(--editor-toolbar-hover-outline);
  outline-offset: 1px;
}
.parapdf-editor-layer .editToolbar .buttons > :not(.divider):hover:active { outline: none; }
.parapdf-editor-layer .editToolbar .buttons > :not(.divider):focus-visible { border-radius: 2px; outline: 2px solid var(--editor-toolbar-focus-outline-color); }
.parapdf-editor-layer .editToolbar .buttons > :is(.altText, .comment),
.parapdf-editor-layer .editToolbar .buttons > :is(.altText, .comment) + .divider { display: none; }
.parapdf-editor-layer .noAltTextBadge, .parapdf-editor-layer .annotationCommentButton { display: none; }

.parapdf-editor-layer .freeTextEditor { padding: calc(var(--freetext-padding) * var(--total-scale-factor)); width: auto; height: auto; touch-action: none; }
.parapdf-editor-layer .freeTextEditor .internal {
  background: transparent;
  border: none;
  inset: 0;
  overflow: visible;
  white-space: nowrap;
  font: 10px sans-serif;
  line-height: var(--parapdf-freetext-line-height);
  text-align: start;
  -webkit-user-select: none;
  user-select: none;
}
.parapdf-editor-layer .freeTextEditor .overlay { position: absolute; display: none; background: transparent; inset: 0; width: 100%; height: 100%; }
.parapdf-editor-layer .freeTextEditor .overlay.enabled { display: block; }
.parapdf-editor-layer .freeTextEditor .internal:empty::before { content: attr(default-content); color: gray; }
.parapdf-editor-layer .freeTextEditor .internal:focus { outline: none; -webkit-user-select: auto; user-select: auto; }
.parapdf-editor-layer .inkEditor { width: 100%; height: 100%; }
.parapdf-editor-layer .inkEditor.editing { cursor: inherit; }
.parapdf-editor-layer .inkEditor .inkEditorCanvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
.parapdf-editor-layer .stampEditor { width: auto; height: auto; }
.parapdf-editor-layer .stampEditor canvas { position: absolute; width: 100%; height: 100%; margin: 0; top: 0; left: 0; }

.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor) > .resizers { position: absolute; inset: 0; z-index: 1; }
.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor) > .resizers.hidden { display: none; }
.parapdf-editor-layer :is(.freeTextEditor, .inkEditor, .stampEditor, .signatureEditor) > .resizers > .resizer {
  width: var(--parapdf-resizer-size);
  height: var(--parapdf-resizer-size);
  background: content-box var(--parapdf-resizer-bg-color);
  border: var(--parapdf-focus-outline-around);
  border-radius: 2px;
  position: absolute;
}
.parapdf-editor-layer .resizers > .resizer.topLeft { top: var(--parapdf-resizer-shift); left: var(--parapdf-resizer-shift); }
.parapdf-editor-layer .resizers > .resizer.topMiddle { top: var(--parapdf-resizer-shift); left: calc(50% + var(--parapdf-resizer-shift)); }
.parapdf-editor-layer .resizers > .resizer.topRight { top: var(--parapdf-resizer-shift); right: var(--parapdf-resizer-shift); }
.parapdf-editor-layer .resizers > .resizer.middleRight { top: calc(50% + var(--parapdf-resizer-shift)); right: var(--parapdf-resizer-shift); }
.parapdf-editor-layer .resizers > .resizer.bottomRight { bottom: var(--parapdf-resizer-shift); right: var(--parapdf-resizer-shift); }
.parapdf-editor-layer .resizers > .resizer.bottomMiddle { bottom: var(--parapdf-resizer-shift); left: calc(50% + var(--parapdf-resizer-shift)); }
.parapdf-editor-layer .resizers > .resizer.bottomLeft { bottom: var(--parapdf-resizer-shift); left: var(--parapdf-resizer-shift); }
.parapdf-editor-layer .resizers > .resizer.middleLeft { top: calc(50% + var(--parapdf-resizer-shift)); left: var(--parapdf-resizer-shift); }
.parapdf-editor-layer:is([data-main-rotation="0"], [data-main-rotation="180"]) :is([data-editor-rotation="0"], [data-editor-rotation="180"]) > .resizers > .resizer:is(.topLeft, .bottomRight),
.parapdf-editor-layer:is([data-main-rotation="90"], [data-main-rotation="270"]) :is([data-editor-rotation="90"], [data-editor-rotation="270"]) > .resizers > .resizer:is(.topLeft, .bottomRight) { cursor: nwse-resize; }
.parapdf-editor-layer:is([data-main-rotation="0"], [data-main-rotation="180"]) :is([data-editor-rotation="0"], [data-editor-rotation="180"]) > .resizers > .resizer:is(.topMiddle, .bottomMiddle),
.parapdf-editor-layer:is([data-main-rotation="90"], [data-main-rotation="270"]) :is([data-editor-rotation="90"], [data-editor-rotation="270"]) > .resizers > .resizer:is(.topMiddle, .bottomMiddle) { cursor: ns-resize; }
.parapdf-editor-layer:is([data-main-rotation="0"], [data-main-rotation="180"]) :is([data-editor-rotation="0"], [data-editor-rotation="180"]) > .resizers > .resizer:is(.topRight, .bottomLeft),
.parapdf-editor-layer:is([data-main-rotation="90"], [data-main-rotation="270"]) :is([data-editor-rotation="90"], [data-editor-rotation="270"]) > .resizers > .resizer:is(.topRight, .bottomLeft) { cursor: nesw-resize; }
.parapdf-editor-layer:is([data-main-rotation="0"], [data-main-rotation="180"]) :is([data-editor-rotation="0"], [data-editor-rotation="180"]) > .resizers > .resizer:is(.middleRight, .middleLeft),
.parapdf-editor-layer:is([data-main-rotation="90"], [data-main-rotation="270"]) :is([data-editor-rotation="90"], [data-editor-rotation="270"]) > .resizers > .resizer:is(.middleRight, .middleLeft) { cursor: ew-resize; }
.parapdf-editor-layer:is([data-main-rotation="0"], [data-main-rotation="180"]) :is([data-editor-rotation="90"], [data-editor-rotation="270"]) > .resizers > .resizer:is(.topLeft, .bottomRight),
.parapdf-editor-layer:is([data-main-rotation="90"], [data-main-rotation="270"]) :is([data-editor-rotation="0"], [data-editor-rotation="180"]) > .resizers > .resizer:is(.topLeft, .bottomRight) { cursor: nesw-resize; }
.parapdf-editor-layer:is([data-main-rotation="0"], [data-main-rotation="180"]) :is([data-editor-rotation="90"], [data-editor-rotation="270"]) > .resizers > .resizer:is(.topMiddle, .bottomMiddle),
.parapdf-editor-layer:is([data-main-rotation="90"], [data-main-rotation="270"]) :is([data-editor-rotation="0"], [data-editor-rotation="180"]) > .resizers > .resizer:is(.topMiddle, .bottomMiddle) { cursor: ew-resize; }
.parapdf-editor-layer:is([data-main-rotation="0"], [data-main-rotation="180"]) :is([data-editor-rotation="90"], [data-editor-rotation="270"]) > .resizers > .resizer:is(.topRight, .bottomLeft),
.parapdf-editor-layer:is([data-main-rotation="90"], [data-main-rotation="270"]) :is([data-editor-rotation="0"], [data-editor-rotation="180"]) > .resizers > .resizer:is(.topRight, .bottomLeft) { cursor: nwse-resize; }
.parapdf-editor-layer:is([data-main-rotation="0"], [data-main-rotation="180"]) :is([data-editor-rotation="90"], [data-editor-rotation="270"]) > .resizers > .resizer:is(.middleRight, .middleLeft),
.parapdf-editor-layer:is([data-main-rotation="90"], [data-main-rotation="270"]) :is([data-editor-rotation="0"], [data-editor-rotation="180"]) > .resizers > .resizer:is(.middleRight, .middleLeft) { cursor: ns-resize; }
.parapdf-editor-layer :is([data-main-rotation="0"] [data-editor-rotation="90"], [data-main-rotation="90"] [data-editor-rotation="0"], [data-main-rotation="180"] [data-editor-rotation="270"], [data-main-rotation="270"] [data-editor-rotation="180"]) .editToolbar { rotate: 270deg; }
.parapdf-editor-layer :is([data-main-rotation="0"] [data-editor-rotation="90"], [data-main-rotation="90"] [data-editor-rotation="0"], [data-main-rotation="180"] [data-editor-rotation="270"], [data-main-rotation="270"] [data-editor-rotation="180"]) .editToolbar:dir(ltr) { inset-inline-end: calc(0px - var(--parapdf-editor-toolbar-offset)); inset-block-start: 0; }
.parapdf-editor-layer :is([data-main-rotation="0"] [data-editor-rotation="90"], [data-main-rotation="90"] [data-editor-rotation="0"], [data-main-rotation="180"] [data-editor-rotation="270"], [data-main-rotation="270"] [data-editor-rotation="180"]) .editToolbar:dir(rtl) { inset-inline-end: calc(100% + var(--parapdf-editor-toolbar-offset)); inset-block-start: 0; }
.parapdf-editor-layer :is([data-main-rotation="0"] [data-editor-rotation="180"], [data-main-rotation="90"] [data-editor-rotation="90"], [data-main-rotation="180"] [data-editor-rotation="0"], [data-main-rotation="270"] [data-editor-rotation="270"]) .editToolbar { rotate: 180deg; inset-inline-end: 100%; inset-block-start: calc(0px - var(--parapdf-editor-toolbar-offset)); }
.parapdf-editor-layer :is([data-main-rotation="0"] [data-editor-rotation="270"], [data-main-rotation="90"] [data-editor-rotation="180"], [data-main-rotation="180"] [data-editor-rotation="90"], [data-main-rotation="270"] [data-editor-rotation="0"]) .editToolbar { rotate: 90deg; }
.parapdf-editor-layer :is([data-main-rotation="0"] [data-editor-rotation="270"], [data-main-rotation="90"] [data-editor-rotation="180"], [data-main-rotation="180"] [data-editor-rotation="90"], [data-main-rotation="270"] [data-editor-rotation="0"]) .editToolbar:dir(ltr) { inset-inline-end: calc(100% + var(--parapdf-editor-toolbar-offset)); inset-block-start: 100%; }
.parapdf-editor-layer :is([data-main-rotation="0"] [data-editor-rotation="270"], [data-main-rotation="90"] [data-editor-rotation="180"], [data-main-rotation="180"] [data-editor-rotation="90"], [data-main-rotation="270"] [data-editor-rotation="0"]) .editToolbar:dir(rtl) { inset-inline-start: calc(0px - var(--parapdf-editor-toolbar-offset)); inset-block-start: 0; }

.parapdf-editor-layer .colorPicker { --hover-outline-color: #0250bb; --selected-outline-color: #0060df; --swatch-border-color: #cfcfd8; }
@media screen and (forced-colors: active) {
  .parapdf-editor-layer .colorPicker { --hover-outline-color: Highlight; --selected-outline-color: var(--hover-outline-color); --swatch-border-color: ButtonText; }
}
.parapdf-editor-layer .colorPicker .swatch {
  width: 16px;
  height: 16px;
  border: 1px solid var(--swatch-border-color);
  border-radius: 100%;
  outline-offset: 2px;
  box-sizing: border-box;
  forced-color-adjust: none;
}
.parapdf-editor-layer .colorPicker button:is(:hover, .selected) > .swatch { border: none; }
.parapdf-editor-layer .basicColorPicker { width: 28px; }
.parapdf-editor-layer .basicColorPicker::-moz-color-swatch { border-radius: 100%; margin: 0; }
.parapdf-editor-layer .basicColorPicker::-webkit-color-swatch { border-radius: 100%; margin: 0; }
.parapdf-editor-layer[data-main-rotation="0"] .highlightEditor:not(.free) > .editToolbar { rotate: 0deg; }
.parapdf-editor-layer[data-main-rotation="90"] .highlightEditor:not(.free) > .editToolbar { rotate: 270deg; }
.parapdf-editor-layer[data-main-rotation="180"] .highlightEditor:not(.free) > .editToolbar { rotate: 180deg; }
.parapdf-editor-layer[data-main-rotation="270"] .highlightEditor:not(.free) > .editToolbar { rotate: 90deg; }
.parapdf-editor-layer .highlightEditor {
  position: absolute;
  background: transparent;
  z-index: 1;
  cursor: auto;
  max-width: 100%;
  max-height: 100%;
  border: none;
  outline: none;
  pointer-events: none;
  transform-origin: 0 0;
}
.parapdf-editor-layer .highlightEditor:not(.free) { transform: none; }
.parapdf-editor-layer .highlightEditor .internal { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; }
.parapdf-editor-layer .highlightEditor.disabled .internal { pointer-events: none; }
.parapdf-editor-layer .highlightEditor.selectedEditor .internal { cursor: pointer; }
.parapdf-editor-layer .highlightEditor .editToolbar { transform-origin: center !important; }
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker {
  position: relative;
  width: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 4px;
}
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker::after {
  content: "";
  -webkit-mask-image: url("${MENU_ARROW_ICON}");
  mask-image: url("${MENU_ARROW_ICON}");
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  display: inline-block;
  background-color: var(--editor-toolbar-fg-color);
  width: 12px;
  height: 12px;
}
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker:hover::after { background-color: var(--editor-toolbar-hover-fg-color); }
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker:has(.dropdown:not(.hidden)) { background-color: var(--editor-toolbar-hover-bg-color); }
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker:has(.dropdown:not(.hidden))::after { scale: -1; }
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker .dropdown {
  position: absolute;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  gap: 11px;
  padding-block: 8px;
  border-radius: 6px;
  background-color: var(--editor-toolbar-bg-color);
  border: 1px solid var(--editor-toolbar-border-color);
  box-shadow: var(--editor-toolbar-shadow);
  inset-block-start: calc(100% + 4px);
  width: calc(100% + 2 * var(--editor-toolbar-padding));
}
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker .dropdown button {
  width: 100%;
  height: auto;
  border: none;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  background: none;
}
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker .dropdown button:is(:active, :focus-visible) { outline: none; }
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker .dropdown button > .swatch { outline-offset: 2px; }
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker .dropdown button[aria-selected="true"] > .swatch { outline: 2px solid var(--selected-outline-color); }
.parapdf-editor-layer .highlightEditor .editToolbar .buttons .colorPicker .dropdown button:is(:hover, :active, :focus-visible) > .swatch { outline: 2px solid var(--hover-outline-color); }
`;
