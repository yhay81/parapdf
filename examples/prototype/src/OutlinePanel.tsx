import { type OutlineNode, useOutline, type Viewer } from "parapdf";

/** The document outline as nested lists of links, a navigation landmark. */
export function OutlinePanel({ viewer, id }: { viewer: Viewer; id: string }) {
  const outline = useOutline();
  if (outline.length === 0) return null;
  return (
    <nav id={id} className="sidebar outline" aria-label="Document outline">
      <OutlineList viewer={viewer} items={outline} />
    </nav>
  );
}

function OutlineList({ viewer, items }: { viewer: Viewer; items: readonly OutlineNode[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        // Outline entries have no stable identity beyond their position.
        // biome-ignore lint/suspicious/noArrayIndexKey: the outline is static per document.
        <li key={index}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title}
            </a>
          ) : (
            <button
              type="button"
              disabled={item.dest === null}
              onClick={() => void viewer.goToDestination(item.dest)}
              style={{
                fontWeight: item.bold ? 600 : undefined,
                fontStyle: item.italic ? "italic" : undefined,
              }}
            >
              {item.title}
            </button>
          )}
          {item.items.length > 0 ? <OutlineList viewer={viewer} items={item.items} /> : null}
        </li>
      ))}
    </ul>
  );
}
