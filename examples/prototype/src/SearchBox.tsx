import { type SearchOptions, useDocumentState, useSearch, type Viewer } from "parapdf";
import { useEffect, useRef, useState } from "react";

/**
 * Find-in-document. Typing searches after a short pause; Enter and Shift+Enter
 * move between matches; Escape clears; Ctrl/Cmd+F focuses the field because
 * the browser's own find cannot see pages that are not mounted.
 */
export function SearchBox({ viewer }: { viewer: Viewer }) {
  const search = useSearch(viewer);
  const pageCount = useDocumentState((state) => state.pageCount);
  const [value, setValue] = useState("");
  const [options, setOptions] = useState<SearchOptions>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const { search: run, query } = search;

  useEffect(() => {
    if (value === query) return;
    const timer = setTimeout(() => run(value, options), 250);
    return () => clearTimeout(timer);
  }, [value, query, run, options]);

  /** Changing an option searches again at once. */
  const toggle = (name: keyof SearchOptions) => {
    const next = { ...options, [name]: !options[name] };
    setOptions(next);
    if (value) run(value, next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const total = search.matches.length;
  const summary =
    search.status === "idle"
      ? ""
      : search.status === "searching" && total === 0
        ? `Searching ${search.pagesSearched} of ${pageCount} pages`
        : total === 0
          ? "No matches"
          : `${search.current + 1} of ${total}${search.status === "searching" ? "+" : ""}`;

  return (
    <search className="search">
      <input
        ref={inputRef}
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
        onClick={search.previous}
        disabled={total === 0}
        aria-label="Previous match"
      >
        ↑
      </button>
      <button type="button" onClick={search.next} disabled={total === 0} aria-label="Next match">
        ↓
      </button>
      {(
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
          aria-pressed={Boolean(options[name])}
          onClick={() => toggle(name)}
        >
          {text}
        </button>
      ))}
      {/* Announced politely so screen-reader users hear result counts. */}
      <output aria-live="polite" className="search-summary">
        {summary}
      </output>
    </search>
  );
}
