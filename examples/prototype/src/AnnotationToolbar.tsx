import { type AnnotationTool, usePdfState, usePdfViewer } from "parapdf";
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
export function AnnotationToolbar({ file }: { file: string }) {
  const viewer = usePdfViewer();
  const tool = usePdfState((state) => state.annotationTool);
  const editing = usePdfState((state) => state.annotationState);
  const styles = usePdfState((state) => state.annotationStyles);
  const ready = usePdfState((state) => state.status === "ready" && state.annotationState !== null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  const styled = tool === "highlight" || tool === "freetext" || tool === "ink" ? tool : null;
  const color = styled && styles ? styles[styled].color : "#000000";

  const keep = () => {
    const annotations = viewer.exportAnnotations();
    localStorage.setItem(storageKey(file), JSON.stringify(annotations));
    setMessage(`Kept ${annotations.length}`);
  };
  const restore = async () => {
    const saved = localStorage.getItem(storageKey(file));
    const count = saved ? await viewer.importAnnotations(JSON.parse(saved)) : 0;
    setMessage(`Restored ${count}`);
  };
  const copyText = async () => {
    const { text, pages } = await viewer.getText();
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
          onClick={() => void viewer.setAnnotationTool(value)}
        >
          {label}
        </button>
      ))}
      {styled ? (
        <input
          type="color"
          aria-label="Color"
          value={color.toLowerCase()}
          onChange={(event) => viewer.setAnnotationStyle(styled, { color: event.target.value })}
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
            viewer.setAnnotationStyle("ink", { thickness: Number(event.target.value) })
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
            viewer.setAnnotationStyle("freetext", { fontSize: Number(event.target.value) })
          }
        />
      ) : null}
      <button type="button" disabled={!editing?.canUndo} onClick={() => viewer.undoAnnotation()}>
        Undo
      </button>
      <button type="button" disabled={!editing?.canRedo} onClick={() => viewer.redoAnnotation()}>
        Redo
      </button>
      <button
        type="button"
        disabled={!editing?.hasSelection}
        onClick={() => viewer.deleteSelectedAnnotations()}
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
          if (image) void viewer.addImage(image, { altText: image.name });
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
          if (name) void viewer.addSignature({ text: name }, { description: name });
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
