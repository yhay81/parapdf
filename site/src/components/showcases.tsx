import {
  download,
  type PageColors,
  PdfDocument,
  PdfForms,
  PdfPageOverlays,
  PdfPageRect,
  type PdfRect,
  PdfView,
  PdfViewer,
  type SpreadMode,
  setFormValues,
  useCreateViewer,
  useDocumentState,
  useFormChange,
  useSelection,
  useSession,
  useViewer,
  useViewState,
  type Viewer,
} from "parapdf";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { corpusReadme, samples, sampleUrl } from "../samples.ts";
import { DocumentStatus, PageControls, SearchField, ZoomControls } from "./controls.tsx";

/** Attribution footer matching the rest of the documentation's live examples. */
function SampleNote({ file, lead }: { file: string; lead?: ReactNode }) {
  const sample = samples.find((candidate) => candidate.file === file);
  return (
    <p className="example-note">
      {lead}
      {lead ? " " : ""}
      {sample ? (
        <>
          <a href={sample.sourceUrl}>{sample.title}</a>
          {sample.generated ? "" : `, ${sample.source}`} (<a href={corpusReadme}>license</a>).
        </>
      ) : null}
    </p>
  );
}

interface ReviewNote {
  id: number;
  section: string;
  quote: string;
  comment: string;
  resolved: boolean;
  pages: readonly { pageIndex: number; rects: readonly PdfRect[] }[];
}

const INITIAL_NOTES: readonly ReviewNote[] = [
  {
    id: 1,
    section: "§1 Introduction",
    quote: "firstly a programming language for LaTeX3 (expl3) and then a range of tools",
    comment: "Context for why document command syntax moved into the kernel.",
    resolved: false,
    pages: [{ pageIndex: 1, rects: [{ x: 123, y: 300, width: 348, height: 39 }] }],
  },
  {
    id: 2,
    section: "§2.1 Argument types",
    quote: "The basic form of the argument specifier is a list of letters",
    comment: "Cross-check every specifier letter against our parser table.",
    resolved: false,
    pages: [{ pageIndex: 2, rects: [{ x: 123, y: 179, width: 348, height: 26 }] }],
  },
  {
    id: 3,
    section: "§2.2 Defining commands",
    quote: "\\NewDocumentCommand\\chapter{s o m}",
    comment: "Canonical star + optional + mandatory signature.",
    resolved: true,
    pages: [{ pageIndex: 4, rects: [{ x: 136, y: 126, width: 192, height: 59 }] }],
  },
];

interface SelectionDraft {
  text: string;
  pages: readonly { pageIndex: number; rects: readonly PdfRect[] }[];
}

function SelectionBridge({
  viewer,
  onCapture,
}: {
  viewer: Viewer;
  onCapture: (draft: SelectionDraft) => void;
}) {
  const ready = useViewState((state) => state.layout !== null, viewer);
  const centered = useRef(false);
  const selection = useSelection(viewer);

  useEffect(() => {
    if (!ready || centered.current) return;
    centered.current = true;
    viewer.setViewState({ page: 1, y: 236 });
  }, [ready, viewer]);

  useEffect(() => {
    const trimmed = selection?.text.replace(/\s+/g, " ").trim() ?? "";
    if (!selection || trimmed.length === 0 || selection.pages.length === 0) return;
    onCapture({ text: trimmed, pages: selection.pages });
  }, [selection, onCapture]);
  return null;
}

/**
 * Demonstrates rendering real React components on PDF pages in PDF points:
 * review notes and user-selected passages stay anchored through zoom and rotation.
 */
export function CitationsShowcase() {
  const viewer = useCreateViewer();
  const [notes, setNotes] = useState<readonly ReviewNote[]>(INITIAL_NOTES);
  const [activeId, setActiveId] = useState<number | null>(1);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [comment, setComment] = useState("");
  const nextId = useRef(INITIAL_NOTES.length + 1);
  const commentId = useId();
  const formTitleId = useId();

  const jumpTo = (note: ReviewNote) => {
    setActiveId(note.id);
    const firstPage = note.pages[0];
    const firstRect = firstPage?.rects[0];
    if (!firstPage) return;
    viewer.setViewState({
      page: firstPage.pageIndex,
      ...(firstRect ? { y: Math.max(0, firstRect.y - 56) } : {}),
    });
  };

  const toggleResolved = (id: number) => {
    setNotes((current) =>
      current.map((item) => (item.id === id ? { ...item, resolved: !item.resolved } : item)),
    );
  };

  const removeNote = (id: number) => {
    setNotes((current) => current.filter((item) => item.id !== id));
    setActiveId((current) => (current === id ? null : current));
  };

  const pinSelection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const firstPage = draft.pages[0]?.pageIndex ?? 0;
    const id = nextId.current++;
    const created: ReviewNote = {
      id,
      section: `Selected on p. ${firstPage + 1}`,
      quote: draft.text.length > 96 ? `${draft.text.slice(0, 93)}…` : draft.text,
      comment: comment.trim() || "Pinned from the reader's text selection.",
      resolved: false,
      pages: draft.pages,
    };
    setNotes((current) => [created, ...current]);
    setActiveId(id);
    setDraft(null);
    setComment("");
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="example showcase not-content">
      <PdfDocument source={sampleUrl("usrguide.pdf")} viewer={viewer}>
        <SelectionBridge viewer={viewer} onCapture={setDraft} />
        <div className="example-toolbar" role="toolbar" aria-label="Citation viewer controls">
          <PageControls />
          <ZoomControls />
          <button type="button" onClick={() => viewer.rotate(90)}>
            Rotate 90°
          </button>
          <span className="spacer" />
          <DocumentStatus className="example-status" />
        </div>
        <div className="showcase-split">
          <div className="showcase-panel">
            <div className="showcase-panel-head">
              <strong>App state: review notes</strong>
              <span className="showcase-badge">{notes.length} on pages</span>
            </div>
            {draft ? (
              <form
                className="showcase-composer"
                aria-labelledby={formTitleId}
                onSubmit={pinSelection}
              >
                <p id={formTitleId} className="showcase-composer-quote">
                  <span>p. {(draft.pages[0]?.pageIndex ?? 0) + 1}</span> “
                  {draft.text.length > 84 ? `${draft.text.slice(0, 81)}…` : draft.text}”
                </p>
                <div className="showcase-field">
                  <label htmlFor={commentId}>Comment</label>
                  <input
                    id={commentId}
                    name="comment"
                    type="text"
                    value={comment}
                    placeholder="Add a note for this passage"
                    onChange={(event) => setComment(event.target.value)}
                  />
                </div>
                <div className="showcase-actions">
                  <button type="submit" className="showcase-primary">
                    Pin to page
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      setComment("");
                      if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </form>
            ) : (
              <p className="showcase-hint">
                Select any text on the PDF to pin a React component to its coordinates, or click a
                note below to jump there.
              </p>
            )}
            {/* biome-ignore lint/a11y/noRedundantRoles: Safari removes list semantics when list-style: none and display: flex are applied. */}
            <ul className="showcase-note-list" role="list">
              {notes.map((note) => {
                const pageNumber = (note.pages[0]?.pageIndex ?? 0) + 1;
                const active = note.id === activeId;
                return (
                  <li
                    key={note.id}
                    className="showcase-note-item"
                    data-active={active || undefined}
                    data-resolved={note.resolved || undefined}
                  >
                    <button
                      type="button"
                      className="showcase-note-jump"
                      aria-current={active ? "true" : undefined}
                      onClick={() => jumpTo(note)}
                    >
                      <span className="showcase-note-meta">
                        <span className="showcase-pin-num">#{note.id}</span>
                        <span>{note.section}</span>
                        <span className="showcase-page-tag">p. {pageNumber}</span>
                      </span>
                      <span className="showcase-note-comment">{note.comment}</span>
                    </button>
                    <div className="showcase-note-foot">
                      <button
                        type="button"
                        aria-pressed={note.resolved}
                        aria-label={`Resolved, note ${note.id}`}
                        onClick={() => toggleResolved(note.id)}
                      >
                        Resolved
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove note ${note.id}`}
                        onClick={() => removeNote(note.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <PdfViewer
            viewer={viewer}
            defaultPage={1}
            className="example-viewport"
            label="LaTeX2e for authors with React review overlays"
          >
            <PdfPageOverlays>
              {(pageIndex) => {
                const pageNotes = notes.flatMap((note) => {
                  const match = note.pages.find((entry) => entry.pageIndex === pageIndex);
                  return match
                    ? [{ note, rects: match.rects, isLead: note.pages[0] === match }]
                    : [];
                });
                const draftRects =
                  draft?.pages.find((entry) => entry.pageIndex === pageIndex)?.rects ?? [];
                if (pageNotes.length === 0 && draftRects.length === 0) return null;
                return (
                  <>
                    {draftRects.map((rect, index) => (
                      <PdfPageRect
                        // biome-ignore lint/suspicious/noArrayIndexKey: selection rectangles are transient per drag.
                        key={`draft-${index}`}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                      >
                        <span className="pdf-highlight pdf-highlight-draft" />
                      </PdfPageRect>
                    ))}
                    {pageNotes.map(({ note, rects, isLead }) => {
                      const first = rects[0];
                      const last = rects[rects.length - 1];
                      const active = note.id === activeId;
                      const cardBelow = (last?.y ?? 0) + (last?.height ?? 0) < 690;
                      return (
                        <div key={note.id}>
                          {rects.map((rect, index) => (
                            <PdfPageRect
                              // biome-ignore lint/suspicious/noArrayIndexKey: rectangles of a pinned note never reorder.
                              key={index}
                              x={rect.x}
                              y={rect.y}
                              width={rect.width}
                              height={rect.height}
                            >
                              <span
                                className="pdf-highlight"
                                data-active={active || undefined}
                                data-resolved={note.resolved || undefined}
                              />
                            </PdfPageRect>
                          ))}
                          {isLead && first ? (
                            <PdfPageRect
                              x={Math.max(12, first.x - 30)}
                              y={Math.max(8, first.y - 2)}
                              width={24}
                              height={18}
                            >
                              <button
                                type="button"
                                className="pdf-pin"
                                data-resolved={note.resolved || undefined}
                                aria-pressed={active}
                                aria-label={`#${note.id}: ${note.comment}`}
                                onClick={() => setActiveId(active ? null : note.id)}
                              >
                                #{note.id}
                              </button>
                            </PdfPageRect>
                          ) : null}
                          {isLead && active && first && last ? (
                            <PdfPageRect
                              x={Math.max(24, Math.min(first.x, 305))}
                              y={cardBelow ? last.y + last.height + 6 : Math.max(12, first.y - 76)}
                              width={260}
                              height={64}
                            >
                              <div className="pdf-note-card">
                                <p className="pdf-note-card-text">
                                  <strong>#{note.id}</strong> {note.comment}
                                </p>
                                <div className="pdf-note-card-actions">
                                  <button
                                    type="button"
                                    aria-pressed={note.resolved}
                                    aria-label={`Resolved, note ${note.id}`}
                                    onClick={() => toggleResolved(note.id)}
                                  >
                                    Resolved
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Hide card, note ${note.id}`}
                                    onClick={() => setActiveId(null)}
                                  >
                                    Hide card
                                  </button>
                                </div>
                              </div>
                            </PdfPageRect>
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                );
              }}
            </PdfPageOverlays>
          </PdfViewer>
        </div>
      </PdfDocument>
      <SampleNote
        file="usrguide.pdf"
        lead="Highlights, badges, and cards are React elements portaled into each mounted page in PDF points: zoom or rotate and they stay aligned without re-rendering."
      />
    </div>
  );
}

const F1040_FIELDS = {
  firstName: "topmostSubform[0].Page1[0].f1_14[0]",
  lastName: "topmostSubform[0].Page1[0].f1_15[0]",
  street: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_20[0]",
  city: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_22[0]",
  state: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_23[0]",
  zip: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_24[0]",
  single: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[0]",
  joint: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[1]",
} as const;

type FilingStatus = "single" | "joint" | "none";

interface TaxpayerRecord {
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  status: FilingStatus;
}

const ADA_RECORD: TaxpayerRecord = {
  firstName: "Ada",
  lastName: "Lovelace",
  street: "12 St James's Square",
  city: "Boston",
  state: "MA",
  zip: "02116",
  status: "single",
};

const INCOMPLETE_ZIP_RECORD: TaxpayerRecord = {
  firstName: "Grace",
  lastName: "Hopper",
  street: "1700 N Moore St",
  city: "Arlington",
  state: "VA",
  zip: "222",
  status: "joint",
};

const EMPTY_RECORD: TaxpayerRecord = {
  firstName: "",
  lastName: "",
  street: "",
  city: "",
  state: "",
  zip: "",
  status: "none",
};

function toPdfFormValues(record: TaxpayerRecord): Record<string, string | boolean> {
  return {
    [F1040_FIELDS.firstName]: record.firstName,
    [F1040_FIELDS.lastName]: record.lastName,
    [F1040_FIELDS.street]: record.street,
    [F1040_FIELDS.city]: record.city,
    [F1040_FIELDS.state]: record.state,
    [F1040_FIELDS.zip]: record.zip,
    [F1040_FIELDS.single]: record.status === "single" ? "1" : "Off",
    [F1040_FIELDS.joint]: record.status === "joint" ? "2" : "Off",
  };
}

const VALID_ZIP = /^\d{5}(-\d{4})?$/;

function FormSyncBridge({
  viewer,
  initial,
  onPdfEdit,
}: {
  viewer: Viewer;
  initial: TaxpayerRecord;
  onPdfEdit: (patch: Partial<TaxpayerRecord>, label: string, validateZip?: boolean) => void;
}) {
  const session = useSession();
  const ready = useViewState((state) => state.layout !== null, viewer);
  const seeded = useRef(false);
  const initialRef = useRef(initial);

  useEffect(() => {
    if (!ready || seeded.current) return;
    seeded.current = true;
    void setFormValues(session, toPdfFormValues(initialRef.current));
  }, [ready, session]);

  useFormChange(({ name, value }) => {
    const text = typeof value === "string" ? value : (value[0] ?? "");
    switch (name) {
      case F1040_FIELDS.firstName:
        onPdfEdit({ firstName: text }, "First name");
        break;
      case F1040_FIELDS.lastName:
        onPdfEdit({ lastName: text }, "Last name");
        break;
      case F1040_FIELDS.street:
        onPdfEdit({ street: text }, "Address");
        break;
      case F1040_FIELDS.city:
        onPdfEdit({ city: text }, "City");
        break;
      case F1040_FIELDS.state:
        onPdfEdit({ state: text }, "State");
        break;
      case F1040_FIELDS.zip:
        onPdfEdit({ zip: text }, "ZIP code", text.length > 0 && !VALID_ZIP.test(text));
        break;
      case F1040_FIELDS.single:
        onPdfEdit({ status: text !== "Off" ? "single" : "none" }, "Filing status");
        if (text !== "Off") void setFormValues(session, { [F1040_FIELDS.joint]: "Off" });
        break;
      case F1040_FIELDS.joint:
        onPdfEdit({ status: text !== "Off" ? "joint" : "none" }, "Filing status");
        if (text !== "Off") void setFormValues(session, { [F1040_FIELDS.single]: "Off" });
        break;
      default:
        onPdfEdit({}, name.split(".").pop() ?? "Field");
    }
  }, viewer);

  return null;
}

/**
 * Demonstrates live two-way synchronization between React state and a fillable
 * PDF form, plus React validation rendered directly over a PDF form widget.
 */
export function FormSyncShowcase() {
  return (
    <PdfDocument source={sampleUrl("f1040.pdf")}>
      <FormSyncContent />
    </PdfDocument>
  );
}

function FormSyncContent() {
  const viewer = useViewer();
  const session = useSession();
  const [record, setRecord] = useState<TaxpayerRecord>(ADA_RECORD);
  const [zipChecked, setZipChecked] = useState(false);
  const [syncNotice, setSyncNotice] = useState("Prefilled Form 1040 from React state");
  const baseId = useId();

  const zipInvalid = zipChecked && record.zip.length > 0 && !VALID_ZIP.test(record.zip);

  const applyPreset = (next: TaxpayerRecord, label: string, checkZip: boolean) => {
    setRecord(next);
    setZipChecked(checkZip);
    setSyncNotice(`React → PDF: loaded ${label}`);
    void setFormValues(session, toPdfFormValues(next));
    viewer.setViewState({ page: 0, y: 28 });
  };

  const updateText = (
    key: "firstName" | "lastName" | "street" | "city" | "state" | "zip",
    label: string,
    value: string,
  ) => {
    setRecord((current) => ({ ...current, [key]: value }));
    if (key === "zip" && (value.length === 0 || VALID_ZIP.test(value))) {
      setZipChecked(false);
    }
    setSyncNotice(`React → PDF: ${label}`);
    void setFormValues(session, { [F1040_FIELDS[key]]: value });
  };

  const updateStatus = (status: FilingStatus) => {
    setRecord((current) => ({ ...current, status }));
    setSyncNotice("React → PDF: Filing status");
    void setFormValues(session, {
      [F1040_FIELDS.single]: status === "single" ? "1" : "Off",
      [F1040_FIELDS.joint]: status === "joint" ? "2" : "Off",
    });
  };

  return (
    <div className="example showcase not-content">
      <FormSyncBridge
        viewer={viewer}
        initial={ADA_RECORD}
        onPdfEdit={(patch, label, flagZip) => {
          if (Object.keys(patch).length > 0) {
            setRecord((current) => ({ ...current, ...patch }));
          }
          if (flagZip !== undefined) setZipChecked(flagZip);
          setSyncNotice(`PDF → React: ${label}`);
        }}
      />
      <div className="example-toolbar" role="toolbar" aria-label="Form sync controls">
        <button type="button" onClick={() => applyPreset(ADA_RECORD, "Ada Lovelace", false)}>
          Prefill Ada
        </button>
        <button
          type="button"
          onClick={() => applyPreset(INCOMPLETE_ZIP_RECORD, "incomplete ZIP", true)}
        >
          Try invalid ZIP
        </button>
        <button type="button" onClick={() => applyPreset(EMPTY_RECORD, "blank form", false)}>
          Clear
        </button>
        <ZoomControls fit={false} />
        <span className="spacer" />
        <button
          type="button"
          onClick={() => void download(session, { filename: "f1040-filled.pdf" })}
        >
          Download filled PDF
        </button>
        <DocumentStatus className="example-status" />
      </div>
      <div className="showcase-split">
        <div className="showcase-panel">
          <div className="showcase-panel-head">
            <strong>App state: taxpayer record</strong>
            <output className="showcase-sync-pill" aria-live="polite">
              {syncNotice}
            </output>
          </div>
          <div className="showcase-form-grid">
            <div className="showcase-field">
              <label htmlFor={`${baseId}-first`}>First name</label>
              <input
                id={`${baseId}-first`}
                name="firstName"
                type="text"
                autoComplete="given-name"
                value={record.firstName}
                onChange={(event) => updateText("firstName", "First name", event.target.value)}
              />
            </div>
            <div className="showcase-field">
              <label htmlFor={`${baseId}-last`}>Last name</label>
              <input
                id={`${baseId}-last`}
                name="lastName"
                type="text"
                autoComplete="family-name"
                value={record.lastName}
                onChange={(event) => updateText("lastName", "Last name", event.target.value)}
              />
            </div>
            <div className="showcase-field showcase-field-wide">
              <label htmlFor={`${baseId}-street`}>Street address</label>
              <input
                id={`${baseId}-street`}
                name="street"
                type="text"
                autoComplete="street-address"
                value={record.street}
                onChange={(event) => updateText("street", "Street address", event.target.value)}
              />
            </div>
            <div className="showcase-field">
              <label htmlFor={`${baseId}-city`}>City</label>
              <input
                id={`${baseId}-city`}
                name="city"
                type="text"
                autoComplete="address-level2"
                value={record.city}
                onChange={(event) => updateText("city", "City", event.target.value)}
              />
            </div>
            <div className="showcase-field showcase-field-short">
              <label htmlFor={`${baseId}-state`}>State</label>
              <input
                id={`${baseId}-state`}
                name="state"
                type="text"
                autoComplete="address-level1"
                maxLength={2}
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={record.state}
                onChange={(event) => updateText("state", "State", event.target.value)}
              />
            </div>
            <div className="showcase-field">
              <label htmlFor={`${baseId}-zip`}>ZIP code</label>
              <input
                id={`${baseId}-zip`}
                name="zip"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={10}
                aria-invalid={zipInvalid || undefined}
                aria-describedby={zipInvalid ? `${baseId}-zip-err` : undefined}
                value={record.zip}
                onChange={(event) => updateText("zip", "ZIP code", event.target.value)}
                onBlur={() => {
                  if (record.zip.length > 0) setZipChecked(true);
                }}
              />
            </div>
          </div>
          {zipInvalid ? (
            <div className="showcase-validation" role="alert">
              <span id={`${baseId}-zip-err`}>Enter a 5-digit US ZIP code (such as 02116).</span>
              <button type="button" onClick={() => viewer.setViewState({ page: 0, y: 120 })}>
                Show on PDF
              </button>
            </div>
          ) : null}
          <fieldset className="showcase-fieldset">
            <legend>Filing status</legend>
            <div className="showcase-radio-row">
              <input
                id={`${baseId}-single`}
                type="radio"
                name={`${baseId}-status`}
                checked={record.status === "single"}
                onChange={() => updateStatus("single")}
              />
              <label htmlFor={`${baseId}-single`}>Single</label>
            </div>
            <div className="showcase-radio-row">
              <input
                id={`${baseId}-joint`}
                type="radio"
                name={`${baseId}-status`}
                checked={record.status === "joint"}
                onChange={() => updateStatus("joint")}
              />
              <label htmlFor={`${baseId}-joint`}>Married filing jointly</label>
            </div>
          </fieldset>
        </div>
        <PdfViewer
          viewer={viewer}
          className="example-viewport"
          label="Form 1040 synced with React state"
        >
          <PdfForms />
          <PdfPageOverlays>
            {(pageIndex) =>
              pageIndex === 0 && zipInvalid ? (
                <>
                  <PdfPageRect x={395} y={164} width={74} height={18}>
                    <span className="pdf-field-ring" />
                  </PdfPageRect>
                  <PdfPageRect x={395} y={162} width={74} height={1}>
                    <span className="pdf-field-flag">5-digit ZIP needed</span>
                  </PdfPageRect>
                </>
              ) : null
            }
          </PdfPageOverlays>
        </PdfViewer>
      </div>
      <SampleNote
        file="f1040.pdf"
        lead="Type on either side: React inputs write to pdf.js's form storage, typing in the PDF updates React state, and Download saves the filled bytes in your browser."
      />
    </div>
  );
}

const CHAPTER_JUMPS: readonly [string, string][] = [
  ["§1 Intro", "section.1"],
  ["§2 Commands", "section.2"],
  ["§3 Copying", "section.3"],
  ["§5 Floating point", "section.5"],
];

/**
 * Demonstrates opening a PDF once in `<PdfDocument>` while driving two
 * independent `<PdfViewer>` viewports with separate scroll positions and zoom.
 */
export function SplitSessionShowcase() {
  const left = useCreateViewer();
  const right = useCreateViewer();
  return (
    <div className="example showcase not-content">
      <PdfDocument source={sampleUrl("usrguide.pdf")}>
        <div className="example-toolbar" role="toolbar" aria-label="Shared session controls">
          <span className="showcase-badge">1 PdfDocument · 1 worker · 2 viewports</span>
          {CHAPTER_JUMPS.map(([label, dest]) => (
            <button key={dest} type="button" onClick={() => void right.goToDestination(dest)}>
              Right → {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const view = left.viewState();
              if (view) right.setViewState(view);
            }}
          >
            Sync right to left
          </button>
          <span className="spacer" />
          <DocumentStatus className="example-status" />
        </div>
        <div className="showcase-dual">
          <PdfView viewer={left}>
            <div className="showcase-pane">
              <div className="showcase-pane-bar" role="toolbar" aria-label="Left viewport controls">
                <strong>Contents</strong>
                <span className="spacer" />
                <PageControls />
                <ZoomControls fit={false} />
              </div>
              <PdfViewer
                viewer={left}
                defaultPage={0}
                className="example-viewport showcase-dual-viewport"
                label="Reference viewport"
              />
            </div>
          </PdfView>
          <PdfView viewer={right}>
            <div className="showcase-pane">
              <div
                className="showcase-pane-bar"
                role="toolbar"
                aria-label="Right viewport controls"
              >
                <strong>Reading pane</strong>
                <span className="spacer" />
                <PageControls />
                <ZoomControls fit={false} />
              </div>
              <PdfViewer
                viewer={right}
                defaultPage={18}
                className="example-viewport showcase-dual-viewport"
                label="Reading viewport"
              />
            </div>
          </PdfView>
        </div>
      </PdfDocument>
      <SampleNote
        file="usrguide.pdf"
        lead="Follow links in Contents on the left while keeping page 19 open on the right: both viewports share one open PDF, text index, and worker."
      />
    </div>
  );
}

type ThemeName = "paper" | "sepia" | "night";

const PALETTES: Record<ThemeName, PageColors | undefined> = {
  paper: undefined,
  sepia: { background: "#f5efe2", foreground: "#2a2016" },
  night: { background: "#141926", foreground: "#e4e9f7" },
};

function UnmountedReadout({ viewer, onMount }: { viewer: Viewer; onMount: () => void }) {
  const page = useViewState((state) => state.currentPage, viewer);
  const scale = useViewState((state) => state.scale, viewer);
  const pageCount = useDocumentState((state) => state.pageCount);
  return (
    <div className="showcase-unmounted">
      <div className="showcase-unmounted-card">
        <strong>
          <code>&lt;PdfViewer /&gt;</code> is unmounted from the DOM
        </strong>
        <p>
          An unmounted <code>&lt;iframe&gt;</code> destroys its browsing context and reloads{" "}
          <code>viewer.html</code> at page 1. Here, <code>useCreateViewer()</code> stopped drawing
          and released its canvases while keeping your place in React state:
        </p>
        <dl className="showcase-stat-grid">
          <div>
            <dt>Saved page</dt>
            <dd>{pageCount > 0 ? `Page ${page + 1} of ${pageCount}` : `Page ${page + 1}`}</dd>
          </div>
          <div>
            <dt>Saved zoom</dt>
            <dd>{Math.round((scale * 72 * 100) / 96)}%</dd>
          </div>
          <div>
            <dt>Mounted canvases</dt>
            <dd>0</dd>
          </div>
        </dl>
        <button type="button" className="showcase-primary" onClick={onMount}>
          Mount &lt;PdfViewer /&gt; again
        </button>
      </div>
    </div>
  );
}

/**
 * Demonstrates unmounting and remounting `<PdfViewer />` without losing scroll
 * position, zoom, or search matches, plus changing live props like `pageColors`.
 */
export function LifecycleShowcase() {
  const viewer = useCreateViewer();
  const [mounted, setMounted] = useState(true);
  const [theme, setTheme] = useState<ThemeName>("paper");
  const [spread, setSpread] = useState<SpreadMode>("none");
  const paletteId = useId();

  return (
    <div className="example showcase not-content">
      <PdfDocument source={sampleUrl("usrguide.pdf")} viewer={viewer}>
        <div
          className="example-toolbar"
          role="toolbar"
          aria-label="Lifecycle and live option controls"
        >
          <button type="button" onClick={() => setMounted((current) => !current)}>
            {mounted ? "Unmount <PdfViewer />" : "Mount <PdfViewer /> again"}
          </button>
          <PageControls />
          <ZoomControls fit={false} />
          <SearchField />
          <label htmlFor={paletteId}>
            Palette{" "}
            <select
              id={paletteId}
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemeName)}
            >
              <option value="paper">Paper</option>
              <option value="sepia">Sepia</option>
              <option value="night">Night ink</option>
            </select>
          </label>
          <button
            type="button"
            aria-pressed={spread === "odd"}
            onClick={() => setSpread((current) => (current === "none" ? "odd" : "none"))}
          >
            Two-page spread
          </button>
          <span className="spacer" />
          <DocumentStatus className="example-status" />
        </div>
        {mounted ? (
          <PdfViewer
            viewer={viewer}
            defaultPage={2}
            pageColors={PALETTES[theme]}
            spread={spread}
            onSpreadChange={setSpread}
            className="example-viewport"
            label="Viewer with preserved React lifetime"
          />
        ) : (
          <UnmountedReadout viewer={viewer} onMount={() => setMounted(true)} />
        )}
      </PdfDocument>
      <SampleNote
        file="usrguide.pdf"
        lead="Scroll, zoom, search for “command”, switch palettes, then unmount the viewport and mount it again: it returns right where you left off."
      />
    </div>
  );
}

const STRESS_FILES = [
  "synthetic-text-1000.pdf",
  "synthetic-vector-200k.pdf",
  "mhlw-doc.pdf",
  "wdl6812-manuscript.pdf",
  "synthetic-mixed-sizes.pdf",
];

function RuntimeTelemetry({ viewer, file }: { viewer: Viewer; file: string }) {
  const first = useViewState((state) => state.first, viewer);
  const last = useViewState((state) => state.last, viewer);
  const page = useViewState((state) => state.currentPage, viewer);
  const scale = useViewState((state) => state.scale, viewer);
  const laidOut = useViewState((state) => state.layout !== null, viewer);
  const pageCount = useDocumentState((state) => state.pageCount);
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const tracker = useRef({ file, key: "", commits: 0 });

  if (tracker.current.file !== file) {
    tracker.current = { file, key: "", commits: 0 };
  }
  const key = laidOut ? `${first}:${last}:${page}:${Math.round(scale * 1000)}` : "";
  if (key && key !== tracker.current.key) {
    tracker.current.key = key;
    tracker.current.commits += 1;
  }
  const mountedPages = laidOut && last >= first ? last - first + 1 : 0;

  return (
    // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA toolbar groups use role="group" rather than <fieldset>.
    <div className="showcase-metrics" role="group" aria-label="Live runtime metrics">
      <output aria-label="Mounted DOM pages">
        DOM pages: <strong>{mountedPages}</strong>
        {pageCount > 0 ? ` / ${pageCount.toLocaleString("en")}` : ""}
      </output>
      <output aria-label="React view commits">
        React commits: <strong>{tracker.current.commits}</strong>
      </output>
      <button
        type="button"
        onClick={() => {
          tracker.current.commits = 0;
          refresh();
        }}
      >
        Reset count
      </button>
    </div>
  );
}

/**
 * Demonstrates 1,000-page virtualization and zero per-frame React commits with
 * live telemetry from `useViewState` and `viewer`.
 */
export function StressShowcase() {
  const [file, setFile] = useState("synthetic-text-1000.pdf");
  const sample = samples.find((candidate) => candidate.file === file);
  const viewer = useCreateViewer();
  const selectId = useId();

  return (
    <div className="example showcase not-content">
      <PdfDocument source={sampleUrl(file)} viewer={viewer}>
        <div className="example-toolbar" role="toolbar" aria-label="Stress corpus controls">
          <label htmlFor={selectId}>
            <span className="sr-only">Document</span>
            <select id={selectId} value={file} onChange={(event) => setFile(event.target.value)}>
              {samples
                .filter((candidate) => STRESS_FILES.includes(candidate.file))
                .map((candidate) => (
                  <option key={candidate.file} value={candidate.file}>
                    {candidate.title} — {candidate.about}
                  </option>
                ))}
            </select>
          </label>
          <PageControls />
          {file === "synthetic-text-1000.pdf" ? (
            <>
              <button type="button" onClick={() => viewer.goToPage(0)}>
                p. 1
              </button>
              <button type="button" onClick={() => viewer.goToPage(499)}>
                p. 500
              </button>
              <button type="button" onClick={() => viewer.goToPage(999)}>
                p. 1,000
              </button>
            </>
          ) : null}
          <ZoomControls fit={false} />
          <span className="spacer" />
          <RuntimeTelemetry viewer={viewer} file={file} />
          <DocumentStatus className="example-status" />
        </div>
        <PdfViewer viewer={viewer} className="example-viewport" label={sample?.title} />
      </PdfDocument>
      <SampleNote
        file={file}
        lead="Drag the scrollbar across hundreds of pages: React commits only when the mounted window or current page moves, never once per animation frame."
      />
    </div>
  );
}

type HeroTab = "overlays" | "forms" | "split" | "speed";

const HERO_TABS: readonly {
  id: HeroTab;
  label: string;
  caption: ReactNode;
}[] = [
  {
    id: "overlays",
    label: "1. Components on pages",
    caption: (
      <>
        <strong>No iframe border between your UI and the PDF.</strong> Select any sentence or click
        a review note: React components mount right on the page in PDF points and follow zoom and
        rotation through layout alone.
      </>
    ),
  },
  {
    id: "forms",
    label: "2. Two-way form state",
    caption: (
      <>
        <strong>No postMessage or undocumented viewer globals.</strong> Edit Form 1040 from React
        state or directly on the page, flag invalid fields with a React overlay, and download the
        filled PDF bytes in-browser.
      </>
    ),
  },
  {
    id: "split",
    label: "3. One session, two views",
    caption: (
      <>
        <strong>One worker and one parsed PDF, instead of two iframes.</strong> Keep Contents open
        on the left while reading a later section on the right, each with its own scroll and zoom.
      </>
    ),
  },
  {
    id: "speed",
    label: "4. 1,000 pages & live metrics",
    caption: (
      <>
        <strong>React stays out of the frame loop.</strong> Scroll a 1,000-page document or zoom a
        200,000-segment drawing and watch mounted DOM pages and React commits in real time.
      </>
    ),
  },
];

/**
 * The home page's interactive workbench: four live demonstrations of why a
 * React application uses ParaPDF instead of embedding pdf.js in an `<iframe>`.
 */
export function HeroViewer() {
  const [active, setActive] = useState<HeroTab>("overlays");
  const [focused, setFocused] = useState<HeroTab>("overlays");
  const tablistRef = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const activeEntry = HERO_TABS.find((tab) => tab.id === active) ?? HERO_TABS[0];

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (typeof HTMLElement !== "undefined" && "focusGroup" in HTMLElement.prototype) return;
    const rtl =
      typeof window !== "undefined" &&
      tablistRef.current !== null &&
      getComputedStyle(tablistRef.current).direction === "rtl";
    const step =
      event.key === "ArrowRight"
        ? rtl
          ? -1
          : 1
        : event.key === "ArrowLeft"
          ? rtl
            ? 1
            : -1
          : null;
    const currentIndex = HERO_TABS.findIndex((tab) => tab.id === focused);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? HERO_TABS.length - 1
          : step === null
            ? null
            : (currentIndex + step + HERO_TABS.length) % HERO_TABS.length;
    if (nextIndex === null) return;
    const target = HERO_TABS[nextIndex];
    if (!target) return;
    event.preventDefault();
    setFocused(target.id);
    const button = document.getElementById(`${prefix}-tab-${target.id}`);
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div className="hero-workbench not-content">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Why React instead of an iframe"
        className="showcase-tabs"
        onKeyDown={onTabKeyDown}
        {...({ focusgroup: "tablist nomemory" } as Record<string, string>)}
      >
        {HERO_TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`${prefix}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={tab.id === focused ? 0 : -1}
              onFocus={() => setFocused(tab.id)}
              onClick={(event) => {
                setActive(tab.id);
                setFocused(tab.id);
                event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              {...(selected ? ({ focusgroupstart: "" } as Record<string, string>) : {})}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="showcase-caption">
        <p>{activeEntry?.caption}</p>
        <p className="showcase-caption-links">
          <a href="/why-react/">See the code &amp; iframe comparison →</a>
          <a href="/demo/">Full viewer demo</a>
        </p>
      </div>
      <div
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-${active}`}
        className="showcase-tabpanel"
      >
        {active === "overlays" ? <CitationsShowcase /> : null}
        {active === "forms" ? <FormSyncShowcase /> : null}
        {active === "split" ? <SplitSessionShowcase /> : null}
        {active === "speed" ? <StressShowcase /> : null}
      </div>
    </div>
  );
}

const COMPARISON_ROWS: readonly {
  topic: string;
  browserIframe: string;
  pdfjsIframe: string;
  parapdf: string;
}[] = [
  {
    topic: "Same viewer across browsers & mobile",
    browserIframe:
      "No. Desktop chrome varies by browser; mobile browsers often show page 1 or download.",
    pdfjsIframe: "Yes, pdf.js renders every page.",
    parapdf: "Yes, the same pdf.js engine and layers.",
  },
  {
    topic: "Your React components on pages",
    browserIframe: "Impossible.",
    pdfjsIframe:
      "Separate window and DOM: overlays outside lag over postMessage or clip at the frame.",
    parapdf:
      "Portals in PDF points (<PdfPageRect>) that follow zoom and rotation through CSS layout.",
  },
  {
    topic: "State, selection, search & forms",
    browserIframe: "Opaque to JavaScript.",
    pdfjsIframe:
      "Undocumented PDFViewerApplication globals or custom postMessage bridges across frames.",
    parapdf:
      "Typed hooks and functions: useViewState(), useSelection(), useSearch(), useFormChange(), setFormValues().",
  },
  {
    topic: "Split views & thumbnails of one PDF",
    browserIframe: "Each frame loads its own copy.",
    pdfjsIframe:
      "Each iframe loads pdf.js, starts a worker, and downloads and parses the PDF again.",
    parapdf:
      "One PdfDocument session and one worker shared by any number of PdfViewers and PdfThumbnails.",
  },
  {
    topic: "Tab switches, drawers & React <Activity>",
    browserIframe: "Unmounting reloads the PDF from page 1.",
    pdfjsIframe:
      "Unmounting destroys the window and loses scroll position, zoom, search, and edits.",
    parapdf:
      "useCreateViewer() stops work while unmounted and restores position, zoom, search, and edits on remount.",
  },
  {
    topic: "Auth headers, byte buffers & SSR",
    browserIframe: "Cookie URLs only; no custom request headers.",
    pdfjsIframe:
      "Needs same-origin viewer.html, Blob URL handoffs, or patching viewer.mjs for headers.",
    parapdf:
      "Takes { url, httpHeaders, withCredentials }, { data: Uint8Array }, or { range }; renders cleanly in RSC.",
  },
  {
    topic: "Assets & bundle payload",
    browserIframe: "0 KB shipped, zero control.",
    pdfjsIframe:
      "Copy and update pdfjs-dist/web/ in public/; ship the full viewer UI even for read-only previews.",
    parapdf:
      "npm install parapdf; bundlers emit the worker and files, and forms, scripts, search, and annotations load only when used.",
  },
  {
    topic: "Built-in toolbar, dialogs & 100+ locales",
    browserIframe: "Browser's own chrome.",
    pdfjsIframe: "Included out of the box.",
    parapdf:
      "Not included: your application builds its own controls in its own design system and language.",
  },
];

/**
 * Accessible, container-queried comparison table contrasting browser iframes,
 * pdf.js's viewer in an iframe, and ParaPDF in React.
 */
export function ComparisonTable() {
  const captionId = useId();
  return (
    <section
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll wide tables horizontally.
      tabIndex={0}
      aria-labelledby={captionId}
      className="comparison-region not-content"
    >
      <table className="comparison-table">
        <caption id={captionId} className="sr-only">
          Comparison of browser PDF iframes, pdf.js viewer.html in an iframe, and ParaPDF in React
        </caption>
        <thead>
          <tr>
            <th scope="col">What your app needs</th>
            <th scope="col">
              Browser <code>&lt;iframe src="…pdf"&gt;</code>
            </th>
            <th scope="col">
              pdf.js <code>viewer.html</code> in <code>&lt;iframe&gt;</code>
            </th>
            <th scope="col">ParaPDF in React</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.topic}>
              <th scope="row">{row.topic}</th>
              <td>{row.browserIframe}</td>
              <td>{row.pdfjsIframe}</td>
              <td>{row.parapdf}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
