import { type AnnotationTool, getText, useAnnotations, useViewState, type Viewer } from "parapdf";
import { useRef, useState } from "react";

const TOOLS: [AnnotationTool, string][] = [
  ["none", "View"],
  ["highlight", "Highlight"],
  ["freetext", "Text"],
  ["ink", "Draw"],
  ["stamp", "Images"],
  ["signature", "Signatures"],
];

/** Where the demo keeps the annotations it exports, by file. */
const storageKey = (file: string) => `parapdf-annotations:${file}`;

/**
 * The tools of annotation editing (`?annotations=1`): the tool, the style
 * of the one chosen, undo and redo, adding images and typed signatures,
 * keeping annotations in localStorage and restoring them, and copying the
 * whole document's text.
 */
export function AnnotationToolbar({ viewer, file }: { viewer: Viewer; file: string }) {
  const annotations = useAnnotations(viewer);
  const tool = annotations?.tool ?? "none";
  const editing = annotations?.state ?? null;
  const styles = annotations?.styles ?? null;
  const ready = useViewState(viewer, (state) => state.layout !== null) && editing !== null;
  const imageRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  const styled = tool === "highlight" || tool === "freetext" || tool === "ink" ? tool : null;
  const color = styled && styles ? styles[styled].color : "#000000";

  const keep = () => {
    const kept = annotations?.export() ?? [];
    localStorage.setItem(storageKey(file), JSON.stringify(kept));
    setMessage(`Kept ${kept.length}`);
  };
  const restore = async () => {
    const saved = localStorage.getItem(storageKey(file));
    const count = saved && annotations ? await annotations.import(JSON.parse(saved)) : 0;
    setMessage(`Restored ${count}`);
  };
  const copyText = async () => {
    const { text, pages } = await getText(viewer);
    await navigator.clipboard.writeText(text).catch(() => {});
    setMessage(`${text.length} characters from ${pages.length} pages`);
  };

  return (
    <div className="toolbar annotation-toolbar" role="toolbar" aria-label="Annotations">
      {TOOLS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={tool === value}
          disabled={!ready}
          onClick={() => void annotations?.setTool(value)}
        >
          {label}
        </button>
      ))}
      {styled ? (
        <input
          type="color"
          aria-label="Color"
          value={color.toLowerCase()}
          onChange={(event) => annotations?.setStyle(styled, { color: event.target.value })}
        />
      ) : null}
      {styled === "ink" && styles ? (
        <input
          type="range"
          aria-label="Thickness"
          min={1}
          max={20}
          value={styles.ink.thickness}
          onChange={(event) =>
            annotations?.setStyle("ink", { thickness: Number(event.target.value) })
          }
        />
      ) : null}
      {styled === "freetext" && styles ? (
        <input
          type="number"
          aria-label="Font size"
          min={5}
          max={100}
          value={styles.freetext.fontSize}
          onChange={(event) =>
            annotations?.setStyle("freetext", { fontSize: Number(event.target.value) })
          }
        />
      ) : null}
      <button type="button" disabled={!editing?.canUndo} onClick={() => annotations?.undo()}>
        Undo
      </button>
      <button type="button" disabled={!editing?.canRedo} onClick={() => annotations?.redo()}>
        Redo
      </button>
      <button
        type="button"
        disabled={!editing?.hasSelection}
        onClick={() => annotations?.deleteSelected()}
      >
        Delete
      </button>
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const image = event.target.files?.[0];
          if (image) void annotations?.addImage(image, { altText: image.name });
          event.target.value = "";
        }}
      />
      <button type="button" disabled={!ready} onClick={() => imageRef.current?.click()}>
        Add image
      </button>
      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          const name = prompt("Signature");
          if (name) void annotations?.addSignature({ text: name }, { description: name });
        }}
      >
        Sign
      </button>
      <button type="button" disabled={!ready} onClick={keep}>
        Keep
      </button>
      <button type="button" disabled={!ready} onClick={() => void restore()}>
        Restore
      </button>
      <button type="button" disabled={!ready} onClick={() => void copyText()}>
        Copy text
      </button>
      <output>{message}</output>
    </div>
  );
}
