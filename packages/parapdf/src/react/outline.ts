"use client";

import {
  type CSSProperties,
  createElement,
  memo,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import type { OutlineNode } from "../document/session.ts";
import type { ViewerStoreKey } from "../view/state.ts";
import type { Viewer } from "../view/viewer.ts";
import { useOptionalViewer, useStoreKeys } from "./context.ts";
import { useOutline } from "./data.ts";

const EXTERNAL_LINKS_KEYS: readonly ViewerStoreKey[] = ["externalLinks"];
const EMPTY_TOGGLED: ReadonlySet<OutlineNode> = new Set<OutlineNode>();

/** State and pre-wired elements passed to `<PdfOutline renderItem>` for each bookmark. */
export interface OutlineItemHelpers {
  /** Zero-based nesting depth (`0` for top-level entries). */
  readonly depth: number;
  /** Whether `item.items.length > 0`. */
  readonly hasChildren: boolean;
  /** Whether this entry's nested children are expanded. */
  readonly expanded: boolean;
  /** Toggles `expanded` for this entry. */
  toggle(): void;
  /** The viewer's active `externalLinks` policy (`"new-tab"` or `"disabled"`). */
  readonly externalLinks: "new-tab" | "disabled";
  /**
   * Navigates `viewer` to `item.dest` (or calls `onNavigate`), resolving to
   * whether an internal destination was reached.
   */
  activate(): Promise<boolean>;
  /**
   * Default control for `item`: a `<button>` for internal destinations
   * (disabled when `item.dest === null`), `<a target="_blank"
   * rel="noopener noreferrer nofollow">` for external URLs when `externalLinks`
   * is `"new-tab"`, or an inert `<a aria-disabled="true">` without `href` when
   * `externalLinks` is `"disabled"`, styled with `item.bold` and `item.italic`.
   */
  readonly link: ReactNode;
  /**
   * Recursively rendered `<ol>` of `item.items` while `expanded` is `true`, or
   * `null` when `item.items` is empty or collapsed.
   */
  readonly children: ReactNode;
}

export interface PdfOutlineProps {
  /** Optional DOM id on the `<nav>` landmark (for `aria-controls`). */
  id?: string;
  /**
   * The viewer that internal outline entries jump through and whose
   * `externalLinks` policy external URL entries follow; without it,
   * `<PdfOutline>` uses `useViewer()`.
   */
  viewer?: Viewer;
  /** Accessible name of the `<nav>` landmark (default `"Document outline"`). */
  label?: string;
  /** Whether entries with nested children start expanded (default `true`). */
  defaultExpanded?: boolean;
  /**
   * Optional override called when an internal outline entry is activated; by
   * default calls `viewer.goToDestination(item.dest)`.
   */
  onNavigate?: (item: OutlineNode) => boolean | Promise<boolean>;
  /**
   * Renders each `<li>`'s contents while `<PdfOutline>` manages recursion,
   * destination jumps, `externalLinks` enforcement, and `expanded` state.
   */
  renderItem?: (item: OutlineNode, helpers: OutlineItemHelpers) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Inline typography styles for an outline entry's PDF `bold` / `italic` flags. */
export function outlineItemStyle(
  item: Pick<OutlineNode, "bold" | "italic">,
): CSSProperties | undefined {
  if (!item.bold && !item.italic) return undefined;
  return {
    ...(item.bold ? { fontWeight: 600 } : {}),
    ...(item.italic ? { fontStyle: "italic" } : {}),
  };
}

/**
 * Headless, accessible document outline (`<nav><ol>…</ol></nav>`). Reads
 * `useOutline()` (suspending under the caller's `<Suspense>` boundary, apart
 * from `<PdfViewer>`), jumps internal entries through `viewer.goToDestination()`,
 * honors `viewer`'s `externalLinks` policy (`"new-tab"` vs `"disabled"`), and
 * returns `null` when the document has no outline.
 */
export function PdfOutline(props: PdfOutlineProps): ReactNode {
  const outline = useOutline();
  return createElement(OutlineTree, { ...props, items: outline });
}

export interface OutlineTreeProps extends PdfOutlineProps {
  readonly items: readonly OutlineNode[];
}

/** Internal outline tree renderer, taking resolved `items`. */
export function OutlineTree({
  items,
  id,
  viewer: externalViewer,
  label = "Document outline",
  defaultExpanded = true,
  onNavigate,
  renderItem,
  className,
  style,
}: OutlineTreeProps): ReactNode {
  const viewer = useOptionalViewer(externalViewer);
  const externalLinks = useStoreKeys(
    viewer.store,
    EXTERNAL_LINKS_KEYS,
    () => viewer.store.externalLinks,
  );
  const [toggledState, setToggledState] = useState<{
    items: readonly OutlineNode[];
    defaultExpanded: boolean;
    toggled: ReadonlySet<OutlineNode>;
  }>({ items, defaultExpanded, toggled: EMPTY_TOGGLED });

  const toggled =
    toggledState.items === items && toggledState.defaultExpanded === defaultExpanded
      ? toggledState.toggled
      : EMPTY_TOGGLED;

  const toggleItem = useCallback(
    (node: OutlineNode) => {
      setToggledState((prev) => {
        const base =
          prev.items === items && prev.defaultExpanded === defaultExpanded
            ? prev.toggled
            : EMPTY_TOGGLED;
        const next = new Set(base);
        if (next.has(node)) next.delete(node);
        else next.add(node);
        return {
          items,
          defaultExpanded,
          toggled: next.size === 0 ? EMPTY_TOGGLED : next,
        };
      });
    },
    [items, defaultExpanded],
  );

  if (items.length === 0) return null;
  return createElement(
    "nav",
    {
      id,
      className: className ? `parapdf-outline ${className}` : "parapdf-outline",
      style,
      "aria-label": label,
    },
    createElement(OutlineBranch, {
      items,
      depth: 0,
      viewer,
      externalLinks,
      defaultExpanded,
      toggled,
      onToggle: toggleItem,
      onNavigate,
      renderItem,
    }),
  );
}

interface OutlineBranchProps {
  items: readonly OutlineNode[];
  depth: number;
  viewer: Viewer;
  externalLinks: "new-tab" | "disabled";
  defaultExpanded: boolean;
  toggled: ReadonlySet<OutlineNode>;
  onToggle: (node: OutlineNode) => void;
  onNavigate: ((item: OutlineNode) => boolean | Promise<boolean>) | undefined;
  renderItem: ((item: OutlineNode, helpers: OutlineItemHelpers) => ReactNode) | undefined;
}

function OutlineBranch({
  items,
  depth,
  viewer,
  externalLinks,
  defaultExpanded,
  toggled,
  onToggle,
  onNavigate,
  renderItem,
}: OutlineBranchProps): ReactNode {
  return createElement(
    "ol",
    null,
    items.map((item, index) => {
      const hasChildren = item.items.length > 0;
      const tracksToggle = hasChildren || renderItem !== undefined;
      return createElement(OutlineEntry, {
        key: `${index}:${item.title}`,
        item,
        depth,
        viewer,
        externalLinks,
        defaultExpanded,
        expanded: tracksToggle && toggled.has(item) ? !defaultExpanded : defaultExpanded,
        subtreeToggled: hasChildren ? toggled : EMPTY_TOGGLED,
        onToggle,
        onNavigate,
        renderItem,
      });
    }),
  );
}

interface OutlineEntryProps {
  item: OutlineNode;
  depth: number;
  viewer: Viewer;
  externalLinks: "new-tab" | "disabled";
  defaultExpanded: boolean;
  expanded: boolean;
  subtreeToggled: ReadonlySet<OutlineNode>;
  onToggle: (node: OutlineNode) => void;
  onNavigate: ((item: OutlineNode) => boolean | Promise<boolean>) | undefined;
  renderItem: ((item: OutlineNode, helpers: OutlineItemHelpers) => ReactNode) | undefined;
}

const OutlineEntry = /*#__PURE__*/ memo(function OutlineEntry({
  item,
  depth,
  viewer,
  externalLinks,
  defaultExpanded,
  expanded,
  subtreeToggled,
  onToggle,
  onNavigate,
  renderItem,
}: OutlineEntryProps): ReactNode {
  const toggle = useCallback(() => onToggle(item), [onToggle, item]);
  const activate = useCallback(async () => {
    if (item.url) return false;
    if (onNavigate) return Boolean(await onNavigate(item));
    return viewer.goToDestination(item.dest);
  }, [item, onNavigate, viewer]);

  const hasChildren = item.items.length > 0;
  const textStyle = outlineItemStyle(item);
  const link = item.url
    ? externalLinks === "disabled"
      ? createElement("a", { "aria-disabled": "true", style: textStyle }, item.title)
      : createElement(
          "a",
          {
            href: item.url,
            target: "_blank",
            rel: "noopener noreferrer nofollow",
            style: textStyle,
          },
          item.title,
        )
    : createElement(
        "button",
        {
          type: "button",
          disabled: item.dest === null,
          onClick: () => void activate(),
          style: textStyle,
        },
        item.title,
      );

  const childList =
    hasChildren && expanded
      ? createElement(OutlineBranch, {
          items: item.items,
          depth: depth + 1,
          viewer,
          externalLinks,
          defaultExpanded,
          toggled: subtreeToggled,
          onToggle,
          onNavigate,
          renderItem,
        })
      : null;

  if (renderItem) {
    return createElement(
      "li",
      null,
      renderItem(item, {
        depth,
        hasChildren,
        expanded,
        toggle,
        externalLinks,
        activate,
        link,
        children: childList,
      }),
    );
  }
  return createElement(
    "li",
    null,
    hasChildren
      ? createElement(
          "button",
          {
            type: "button",
            "aria-expanded": expanded,
            "aria-label": `${expanded ? "Collapse" : "Expand"} ${item.title}`,
            onClick: toggle,
          },
          expanded ? "−" : "+",
        )
      : null,
    link,
    childList,
  );
});
