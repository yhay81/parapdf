import type { PdfEngine, PdfEngineDocument, PdfSource } from "../engine/types.ts";

/**
 * Loaded documents shared by every viewer of the same source. React
 * StrictMode mounts, unmounts, and mounts again, and applications remount
 * viewers when routes or layouts change; without sharing, every mount would
 * download and parse the PDF again. A document is destroyed once its last
 * viewer has released it and no viewer has acquired it again within
 * RELEASE_DELAY_MS.
 */
const RELEASE_DELAY_MS = 1000;

interface Entry {
  readonly document: Promise<PdfEngineDocument>;
  users: number;
  releaseTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface DocumentLease {
  /** The shared document; rejects when it cannot be opened. */
  readonly document: Promise<PdfEngineDocument>;
  /** Gives the document back. Call it once, even before the document loads. */
  release(): void;
}

const registries = new WeakMap<PdfEngine, Map<unknown, Entry>>();

/** URL sources share by URL; data sources by the identity of their bytes. */
const keyOf = (source: PdfSource): unknown => ("url" in source ? `url:${source.url}` : source.data);

function registryOf(engine: PdfEngine): Map<unknown, Entry> {
  let registry = registries.get(engine);
  if (!registry) {
    registry = new Map();
    registries.set(engine, registry);
  }
  return registry;
}

export function acquireDocument(engine: PdfEngine, source: PdfSource): DocumentLease {
  const registry = registryOf(engine);
  const key = keyOf(source);
  let entry = registry.get(key);
  if (entry) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = undefined;
  } else {
    const created: Entry = { document: engine.open(source), users: 0, releaseTimer: undefined };
    registry.set(key, created);
    // Forget a failed open at once, so the next viewer tries again.
    created.document.catch(() => {
      if (registry.get(key) === created) registry.delete(key);
    });
    entry = created;
  }
  const held = entry;
  held.users++;
  let released = false;
  return {
    document: held.document,
    release() {
      if (released) return;
      released = true;
      held.users--;
      if (held.users > 0) return;
      held.releaseTimer = setTimeout(() => {
        if (held.users > 0 || registry.get(key) !== held) return;
        registry.delete(key);
        held.document
          .then((document) => document.destroy())
          .catch(() => {
            // The document failed to open, or destroying it failed: nothing is left to free.
          });
      }, RELEASE_DELAY_MS);
    },
  };
}
