import { type OutlineNode, usePdfNavigation, usePdfOutline } from "parapdf";

/** The document outline as nested lists of links, a navigation landmark. */
export function OutlinePanel({ id }: { id: string }) {
  const outline = usePdfOutline();
  if (!outline || outline.length === 0) return null;
  return (
    <nav id={id} className="sidebar outline" aria-label="Document outline">
      <OutlineList items={outline} />
    </nav>
  );
}

function OutlineList({ items }: { items: readonly OutlineNode[] }) {
  const navigation = usePdfNavigation();
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
              onClick={() => void navigation.goToDestination(item.dest)}
              style={{
                fontWeight: item.bold ? 600 : undefined,
                fontStyle: item.italic ? "italic" : undefined,
              }}
            >
              {item.title}
            </button>
          )}
          {item.items.length > 0 ? <OutlineList items={item.items} /> : null}
        </li>
      ))}
    </ul>
  );
}
