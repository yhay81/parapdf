import {
  type AnnotationControls,
  type AnnotationTool,
  getText,
  type SelectedAnnotation,
  useAnnotations,
  useViewState,
  type Viewer,
} from "parapdf";
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
 * keeping annotations in localStorage and restoring them, copying the
 * whole document's text, and the comment and alternative text of the
 * annotation selected.
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
      <div className="group segmented">
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
      </div>
      <div className="group">
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
      </div>
      <div className="group">
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
      </div>
      <div className="group">
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
      </div>
      <div className="group">
        <button type="button" disabled={!ready} onClick={keep}>
          Keep
        </button>
        <button type="button" disabled={!ready} onClick={() => void restore()}>
          Restore
        </button>
        <button type="button" disabled={!ready} onClick={() => void copyText()}>
          Copy text
        </button>
      </div>
      <output className="message">{message}</output>
      {annotations && editing?.selected ? (
        <SelectedAnnotationForm
          // Starts again when another is selected, or undo changes this one.
          key={JSON.stringify(editing.selected)}
          annotations={annotations}
          selected={editing.selected}
        />
      ) : null}
    </div>
  );
}

/**
 * The comment and, for an image, the alternative text of the annotation
 * selected, applied together; Cancel puts back what it has, and the
 * annotation stays selected either way.
 */
function SelectedAnnotationForm({
  annotations,
  selected,
}: {
  annotations: AnnotationControls;
  selected: SelectedAnnotation;
}) {
  const [comment, setComment] = useState(selected.comment ?? "");
  const [altText, setAltText] = useState(selected.altText?.text ?? "");
  const [decorative, setDecorative] = useState(selected.altText?.decorative ?? false);
  const cancel = () => {
    setComment(selected.comment ?? "");
    setAltText(selected.altText?.text ?? "");
    setDecorative(selected.altText?.decorative ?? false);
  };
  const commentable = selected.type !== "freetext";
  return (
    <form
      className="selected-annotation"
      aria-label="Selected annotation"
      onSubmit={(event) => {
        event.preventDefault();
        if (commentable) annotations.setComment(comment);
        if (selected.altText) annotations.setAltText({ text: altText, decorative });
      }}
    >
      {commentable ? (
        <label>
          Comment
          <textarea rows={1} value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
      ) : null}
      {selected.altText ? (
        <>
          <label>
            Alternative text
            <input
              value={altText}
              disabled={decorative}
              onChange={(event) => setAltText(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={decorative}
              onChange={(event) => setDecorative(event.target.checked)}
            />
            Decorative
          </label>
        </>
      ) : null}
      <button type="submit">Apply</button>
      <button type="button" onClick={cancel}>
        Cancel
      </button>
    </form>
  );
}
