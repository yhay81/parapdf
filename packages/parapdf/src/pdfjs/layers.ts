import type * as Pdfjs from "pdfjs-dist";
import type { OptionalContentConfig } from "./draw.ts";

/**
 * A layer (optional content group) of the document, or a heading that only
 * groups the layers under it.
 */
export interface PdfLayer {
  /** Null for a heading. */
  id: string | null;
  name: string;
  /** Whether the layer shows; true for a heading. */
  visible: boolean;
  /** Layers listed under this one. */
  children: readonly PdfLayer[];
}

/** The layers of `config` in the document's order; headings group the layers under them. */
function layersOf(config: OptionalContentConfig): PdfLayer[] {
  const node = (item: unknown): PdfLayer[] => {
    if (typeof item === "string") {
      const group = config.getGroup(item) as { name?: string | null; visible: boolean } | null;
      return group
        ? [{ id: item, name: group.name ?? "", visible: group.visible, children: [] }]
        : [];
    }
    if (item && typeof item === "object" && Array.isArray((item as { order?: unknown }).order)) {
      const { name, order } = item as { name: string | null; order: unknown[] };
      return [{ id: null, name: name ?? "", visible: true, children: order.flatMap(node) }];
    }
    return [];
  };
  const order = config.getOrder() as unknown[] | null;
  if (order?.length) return order.flatMap(node);
  return [...config].map(([id, group]: [string, { name?: string | null; visible: boolean }]) => ({
    id,
    name: group.name ?? "",
    visible: group.visible,
    children: [],
  }));
}

/**
 * Which of a document's layers show: pdf.js's display configuration, which
 * drawings and annotation layers take, and every change made to it, which
 * printing replays on a configuration of its own, since pdf.js refuses a
 * display configuration for a print drawing. It starts as the document shows
 * its layers by default.
 */
export class LayerState {
  /** What the screen shows. */
  readonly config: OptionalContentConfig;
  readonly #doc: Pdfjs.PDFDocumentProxy;
  /** Every change, in order, to replay on a configuration for printing. */
  readonly #changes: ((config: OptionalContentConfig) => void)[] = [];
  readonly #listeners = new Set<() => void>();

  private constructor(doc: Pdfjs.PDFDocumentProxy, config: OptionalContentConfig) {
    this.#doc = doc;
    this.config = config;
  }

  static async load(doc: Pdfjs.PDFDocumentProxy): Promise<LayerState> {
    return new LayerState(doc, await doc.getOptionalContentConfig({ intent: "display" }));
  }

  /** Whether any layer was shown or hidden since the document opened. */
  get changed(): boolean {
    return this.#changes.length > 0;
  }

  /** The document's layers in its own order, with their visibility now; empty when it has none. */
  layers(): readonly PdfLayer[] {
    return layersOf(this.config);
  }

  /** Show or hide a layer. Showing one of a set of exclusive layers hides the others. */
  setVisible(id: string, visible: boolean): void {
    this.#change((config) => config.setVisibility(id, visible));
  }

  /** Apply what a link that shows and hides layers asks for: pdf.js's SetOCGState action. */
  apply(action: unknown): void {
    const { state: operations, preserveRB } = action as { state?: unknown; preserveRB?: unknown };
    if (!Array.isArray(operations)) return;
    this.#change((config) =>
      config.setOCGState({ state: operations, preserveRB: preserveRB !== false }),
    );
  }

  /** The layers as they show, on a configuration for printing. */
  async forPrint(): Promise<OptionalContentConfig> {
    const config = await this.#doc.getOptionalContentConfig({ intent: "print" });
    for (const apply of this.#changes) apply(config);
    return config;
  }

  /** Call `listener` after every change; aborting `signal` stops it. */
  subscribe(listener: () => void, signal: AbortSignal): void {
    if (signal.aborted) return;
    this.#listeners.add(listener);
    signal.addEventListener("abort", () => this.#listeners.delete(listener), { once: true });
  }

  #change(apply: (config: OptionalContentConfig) => void): void {
    this.#changes.push(apply);
    apply(this.config);
    for (const listener of [...this.#listeners]) listener();
  }
}
