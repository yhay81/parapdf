import {
  type AnnotationStyles,
  type AnnotationTool,
  getViewState,
  type PdfAnnotations,
  usePdfAnnotations,
  usePdfViewer,
  type ViewState,
} from "parapdf";
import { type CSSProperties, useRef, useState } from "react";
import { IconButton, type IconName, modifier } from "./icons.tsx";
import { Popover } from "./popover.tsx";

const TOOLS: readonly [AnnotationTool, string, IconName][] = [
  ["none", "Select annotations", "pointer"],
  ["highlight", "Highlight", "highlight"],
  ["freetext", "Text", "text"],
  ["ink", "Draw", "draw"],
];

/** The colors offered for each tool: pdf.js's highlight colors, and inks. */
const INKS: readonly [string, string][] = [
  ["#000000", "Black"],
  ["#e5484d", "Red"],
  ["#3451d1", "Blue"],
  ["#30a46c", "Green"],
  ["#f76b15", "Orange"],
];
const COLORS: Record<keyof AnnotationStyles, readonly [string, string][]> = {
  highlight: [
    ["#ffff98", "Yellow"],
    ["#53ffbc", "Green"],
    ["#80ebff", "Blue"],
    ["#ffcbe6", "Pink"],
    ["#ff4f5f", "Red"],
  ],
  freetext: INKS,
  ink: INKS,
};

/** What each tool's slider sets, in PDF points: a thickness, or the font size of text. */
const SIZES: Record<keyof AnnotationStyles, { label: string; min: number; max: number }> = {
  highlight: { label: "Thickness of freehand highlights", min: 8, max: 24 },
  freetext: { label: "Font size", min: 6, max: 72 },
  ink: { label: "Thickness", min: 1, max: 20 },
};

/**
 * The annotation tools, floating over the pages: the tool, the style of the
 * one chosen, images and signatures, undo, redo, and deleting. Done hides
 * them and puts the pointer back to its default.
 */
export function AnnotationBar({ onDone }: { onDone: (view: ViewState | null) => void }) {
  const viewer = usePdfViewer();
  const annotations = usePdfAnnotations();
  const tool = annotations?.tool ?? "none";
  const editing = annotations?.state ?? null;
  const styles = annotations?.styles ?? null;
  const imageInput = useRef<HTMLInputElement>(null);
  const styled = tool === "highlight" || tool === "freetext" || tool === "ink" ? tool : null;
  return (
    <div className="demo-annotations" role="toolbar" aria-label="Annotations">
      <div className="demo-group">
        {TOOLS.map(([value, label, icon]) => (
          <IconButton
            key={value}
            icon={icon}
            label={label}
            aria-pressed={tool === value}
            disabled={!editing}
            onClick={() => void annotations?.setTool(value)}
          />
        ))}
        <IconButton
          icon="image"
          label="Add an image"
          aria-pressed={tool === "stamp"}
          disabled={!editing}
          onClick={() => imageInput.current?.click()}
        />
        <Signature
          disabled={!editing}
          pressed={tool === "signature"}
          onSign={(text) => void annotations?.addSignature({ text }, { description: text })}
        />
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const image = event.target.files?.[0];
            event.target.value = "";
            if (image) void annotations?.addImage(image, { altText: image.name });
          }}
        />
      </div>
      {styled && styles && annotations ? (
        <Style tool={styled} styles={styles} setStyle={annotations.setStyle} />
      ) : null}
      <span className="demo-divider" />
      <div className="demo-group">
        <IconButton
          icon="undo"
          label="Undo"
          shortcut={`${modifier}Z`}
          disabled={!editing?.canUndo}
          onClick={() => annotations?.undo()}
        />
        <IconButton
          icon="redo"
          label="Redo"
          shortcut={modifier === "⌘" ? "⌘⇧Z" : "Ctrl+Y"}
          disabled={!editing?.canRedo}
          onClick={() => annotations?.redo()}
        />
        <IconButton
          icon="trash"
          label="Delete the selected annotations"
          shortcut="Delete"
          disabled={!editing?.hasSelection}
          onClick={() => annotations?.deleteSelected()}
        />
      </div>
      <span className="demo-divider" />
      <button
        type="button"
        className="demo-done"
        onClick={() => {
          void annotations?.setTool("none");
          onDone(getViewState(viewer));
        }}
      >
        Done
      </button>
    </div>
  );
}

/** The color and size of what a tool creates, or of the annotations selected. */
function Style({
  tool,
  styles,
  setStyle,
}: {
  tool: keyof AnnotationStyles;
  styles: AnnotationStyles;
  setStyle: PdfAnnotations["setStyle"];
}) {
  const color = styles[tool].color.toLowerCase();
  const size = SIZES[tool];
  const value = tool === "freetext" ? styles.freetext.fontSize : styles[tool].thickness;
  const custom = !COLORS[tool].some(([hex]) => hex === color);
  return (
    <>
      <span className="demo-divider" />
      <fieldset className="demo-swatches">
        <legend className="demo-visually-hidden">Color</legend>
        {COLORS[tool].map(([hex, name]) => (
          <button
            key={hex}
            type="button"
            className="demo-swatch"
            aria-label={name}
            title={name}
            aria-pressed={color === hex}
            style={{ "--swatch": hex } as CSSProperties}
            onClick={() => setStyle(tool, { color: hex })}
          />
        ))}
        <label
          className="demo-swatch demo-swatch-custom"
          title="Another color"
          data-custom={custom || undefined}
          style={{ "--swatch": color } as CSSProperties}
        >
          <input
            type="color"
            aria-label="Another color"
            value={color}
            onChange={(event) => setStyle(tool, { color: event.target.value })}
          />
        </label>
      </fieldset>
      <label className="demo-size" title={size.label}>
        <span className="demo-visually-hidden">{size.label}</span>
        <input
          type="range"
          min={size.min}
          max={size.max}
          value={Math.round(value)}
          onChange={(event) => {
            const points = Number(event.target.value);
            if (tool === "freetext") setStyle(tool, { fontSize: points });
            else setStyle(tool, { thickness: points });
          }}
        />
        <output>{Math.round(value)}</output>
      </label>
    </>
  );
}

/** A typed signature, which pdf.js draws in an italic serif and places on the current page. */
function Signature({
  disabled,
  pressed,
  onSign,
}: {
  disabled: boolean;
  pressed: boolean;
  onSign: (text: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Popover
      id="demo-signature"
      label="Add a signature"
      kind="dialog"
      side="top"
      align="center"
      className="demo-signature"
      button={(props) => (
        <IconButton
          icon="signature"
          label="Add a signature"
          aria-pressed={pressed}
          disabled={disabled}
          {...props}
        />
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = name.trim();
          if (!text) return;
          event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
          onSign(text);
          setName("");
        }}
      >
        <label>
          Type your name to sign with it
          <input
            type="text"
            value={name}
            placeholder="Your name"
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" className="demo-primary" disabled={!name.trim()}>
          Sign
        </button>
      </form>
    </Popover>
  );
}
