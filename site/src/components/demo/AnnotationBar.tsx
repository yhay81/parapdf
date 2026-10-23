import { type AnnotationTool, usePdfState, usePdfViewer } from "parapdf";
import { useRef } from "react";

const TOOLS: readonly [AnnotationTool, string][] = [
  ["none", "View"],
  ["highlight", "Highlight"],
  ["freetext", "Text"],
  ["ink", "Draw"],
  ["stamp", "Images"],
];

/** The annotation tools, the style of the one chosen, undo, redo, and images. */
export function AnnotationBar() {
  const viewer = usePdfViewer();
  const tool = usePdfState((state) => state.annotationTool);
  const editing = usePdfState((state) => state.annotationState);
  const styles = usePdfState((state) => state.annotationStyles);
  const imageInput = useRef<HTMLInputElement>(null);
  const styled = tool === "highlight" || tool === "freetext" || tool === "ink" ? tool : null;
  return (
    <div className="demo-toolbar demo-annotations" role="toolbar" aria-label="Annotations">
      {TOOLS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={tool === value}
          disabled={!editing}
          onClick={() => void viewer.setAnnotationTool(value)}
        >
          {label}
        </button>
      ))}
      {styled && styles ? (
        <input
          type="color"
          aria-label="Color"
          value={styles[styled].color.toLowerCase()}
          onChange={(event) => viewer.setAnnotationStyle(styled, { color: event.target.value })}
        />
      ) : null}
      <button type="button" disabled={!editing} onClick={() => imageInput.current?.click()}>
        Add image…
      </button>
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const image = event.target.files?.[0];
          event.target.value = "";
          if (image) void viewer.addImage(image, { altText: image.name });
        }}
      />
      <span className="demo-group">
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
      </span>
    </div>
  );
}
