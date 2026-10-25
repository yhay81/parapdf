import { type SearchOptions, searchOf, usePdfSearch, usePdfState, usePdfViewer } from "parapdf";
import { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "./icons.tsx";

const OPTIONS = [
  ["caseSensitive", "Match case"],
  ["entireWord", "Whole words"],
  ["matchDiacritics", "Match diacritics"],
] as const;

/**
 * Find in the document, under the toolbar's button as in pdf.js's viewer:
 * typing searches after a pause, Enter and Shift+Enter move between
 * matches, and Escape closes it, which clears the highlights.
 */
export function FindBar({ onClose }: { onClose: () => void }) {
  const viewer = usePdfViewer();
  const search = usePdfSearch();
  const pageCount = usePdfState((state) => state.pageCount);
  const [value, setValue] = useState("");
  const [options, setOptions] = useState<SearchOptions>({});
  const input = useRef<HTMLInputElement>(null);
  const { query } = search;

  useEffect(() => {
    input.current?.focus();
    return () => searchOf(viewer).clear();
  }, [viewer]);

  useEffect(() => {
    if (value === query) return;
    const timer = setTimeout(() => searchOf(viewer).search(value, options), 250);
    return () => clearTimeout(timer);
  }, [value, query, viewer, options]);

  const toggle = (name: keyof SearchOptions) => {
    const next = { ...options, [name]: !options[name] };
    setOptions(next);
    if (value) search.search(value, next);
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
    <search id="demo-find" className="demo-find" aria-label="Find in document">
      <div className="demo-find-row">
        <label className="demo-find-field">
          <Icon name="search" size={18} />
          <input
            ref={input}
            id="demo-search"
            type="search"
            aria-label="Find in document"
            placeholder="Find in document"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (value !== query) search.search(value, options);
                else if (event.shiftKey) search.previous();
                else search.next();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <output aria-live="polite" data-empty={total === 0 && search.status === "done"}>
            {summary}
          </output>
        </label>
        <IconButton
          icon="chevronUp"
          label="Previous match"
          shortcut="Shift+Enter"
          disabled={total === 0}
          onClick={search.previous}
        />
        <IconButton
          icon="chevronDown"
          label="Next match"
          shortcut="Enter"
          disabled={total === 0}
          onClick={search.next}
        />
        <IconButton icon="close" label="Close" shortcut="Esc" onClick={onClose} />
      </div>
      <div className="demo-find-options">
        {OPTIONS.map(([name, label]) => (
          <button
            key={name}
            type="button"
            className="demo-chip"
            aria-pressed={Boolean(options[name])}
            onClick={() => toggle(name)}
          >
            {label}
          </button>
        ))}
      </div>
    </search>
  );
}
