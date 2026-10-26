import {
  type SearchOptions,
  useDocumentState,
  useSearch,
  useSession,
  useViewState,
  type Viewer,
} from "parapdf";
import { useEffect, useState } from "react";

/** Previous and next page, and the page being read. */
export function PageControls({ viewer }: { viewer: Viewer }) {
  const page = useViewState(viewer, (state) => state.currentPage);
  const pageCount = useDocumentState((state) => state.pageCount);
  return (
    <>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 0}
        onClick={() => viewer.previousPage()}
      >
        ←
      </button>
      <output aria-label="Page">{pageCount > 0 ? `${page + 1} / ${pageCount}` : "–"}</output>
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pageCount - 1}
        onClick={() => viewer.nextPage()}
      >
        →
      </button>
    </>
  );
}

/** Zoom out and in, the zoom as a share of the printed size, and fitting. */
export function ZoomControls({ viewer, fit = true }: { viewer: Viewer; fit?: boolean }) {
  const scale = useViewState(viewer, (state) => state.scale);
  const zoomMode = useViewState(viewer, (state) => state.zoomMode);
  return (
    <>
      <button type="button" aria-label="Zoom out" onClick={() => viewer.zoomBy(1 / 1.25)}>
        −
      </button>
      {/* 96 / 72 CSS pixels per point is the printed size. */}
      <output aria-label="Zoom">{Math.round((scale * 72 * 100) / 96)}%</output>
      <button type="button" aria-label="Zoom in" onClick={() => viewer.zoomBy(1.25)}>
        +
      </button>
      {fit ? (
        <>
          <button
            type="button"
            aria-pressed={zoomMode === "fit-width"}
            onClick={() => viewer.setScale("fit-width")}
          >
            Fit width
          </button>
          <button
            type="button"
            aria-pressed={zoomMode === "fit-page"}
            onClick={() => viewer.setScale("fit-page")}
          >
            Fit page
          </button>
        </>
      ) : null}
    </>
  );
}

/**
 * Find in the document: typing searches after a pause, Enter and Shift+Enter
 * move between matches, and Escape clears.
 */
export function SearchField({
  viewer,
  id,
  withOptions = false,
}: {
  viewer: Viewer;
  id?: string;
  withOptions?: boolean;
}) {
  const search = useSearch(viewer);
  const pageCount = useDocumentState((state) => state.pageCount);
  const [value, setValue] = useState("");
  const [options, setOptions] = useState<SearchOptions>({});
  const { search: run, query } = search;

  useEffect(() => {
    if (value === query) return;
    const timer = setTimeout(() => run(value, options), 250);
    return () => clearTimeout(timer);
  }, [value, query, run, options]);

  const toggle = (name: keyof SearchOptions) => {
    const next = { ...options, [name]: !options[name] };
    setOptions(next);
    if (value) run(value, next);
  };

  const total = search.matches.length;
  const summary =
    search.status === "idle"
      ? ""
      : search.status === "searching" && total === 0
        ? `${search.pagesSearched} of ${pageCount} pages`
        : total === 0
          ? "No matches"
          : `${search.current + 1} of ${total}${search.status === "searching" ? "+" : ""}`;

  return (
    <search style={{ display: "contents" }}>
      <input
        id={id}
        type="search"
        aria-label="Find in document"
        placeholder="Find"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (value !== query) run(value, options);
            else if (event.shiftKey) search.previous();
            else search.next();
          } else if (event.key === "Escape") {
            setValue("");
            search.clear();
          }
        }}
      />
      <button
        type="button"
        aria-label="Previous match"
        disabled={total === 0}
        onClick={search.previous}
      >
        ↑
      </button>
      <button type="button" aria-label="Next match" disabled={total === 0} onClick={search.next}>
        ↓
      </button>
      {withOptions
        ? (
            [
              ["caseSensitive", "Aa", "Match case"],
              ["entireWord", "W", "Whole words"],
              ["matchDiacritics", "é", "Match diacritics"],
            ] as const
          ).map(([name, text, label]) => (
            <button
              key={name}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={Boolean(options[name])}
              onClick={() => toggle(name)}
            >
              {text}
            </button>
          ))
        : null}
      <output aria-live="polite" style={{ minWidth: "7em" }}>
        {summary}
      </output>
    </search>
  );
}

/** Asks for the password of an encrypted document while its session waits for one. */
export function PasswordPrompt({ className, hint }: { className?: string; hint?: string }) {
  const session = useSession();
  const reason = useDocumentState((state) => state.passwordReason);
  const [password, setPassword] = useState("");
  if (reason === null) return null;
  return (
    <form
      className={className}
      aria-label="Password"
      onSubmit={(event) => {
        event.preventDefault();
        session.submitPassword(password);
        setPassword("");
      }}
    >
      <label>
        {reason === "incorrect" ? "Incorrect password. Try again: " : "Password: "}
        <input
          type="password"
          value={password}
          placeholder={hint}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button type="submit">Open</button>
      <button type="button" onClick={() => session.submitPassword(null)}>
        Cancel
      </button>
    </form>
  );
}

/** Loading and errors, which the viewport itself does not show. */
export function DocumentStatus({ className }: { className?: string }) {
  const status = useDocumentState((state) => state.status);
  const error = useDocumentState((state) => state.error);
  const progress = useDocumentState((state) => state.progress);
  if (status === "error") {
    return (
      <span className={className} role="alert" data-error="">
        {error ?? "The document could not be opened."}
      </span>
    );
  }
  if (status !== "loading") return null;
  const percent =
    progress?.total && progress.total > 0
      ? ` ${Math.round((progress.loaded / progress.total) * 100)}%`
      : "";
  return (
    <span className={className} role="status">
      Loading{percent}…
    </span>
  );
}
