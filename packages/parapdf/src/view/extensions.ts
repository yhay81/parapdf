"use client";

import type { DocumentSession } from "../document/session.ts";
import type { AnnotationLayerHandle } from "../pdfjs/annotation-layer.ts";
import type { TextLayerHandle } from "../pdfjs/text.ts";

/**
 * What a feature hears from a viewer, registered with `extend()`. Every hook
 * is optional; the viewer knows no feature by name.
 */
export interface ViewerExtension {
  /**
   * The document is open, its permissions published, and its pages are
   * about to be laid out and drawn: a feature that changes how they are
   * drawn says so here. Called at once by `extend()` once the document is ready.
   */
  prepare?(session: DocumentSession, signal: AbortSignal): void;
  /**
   * The document is ready in this viewer, again after a viewport
   * reattaches; `signal` aborts when the document closes or the viewport
   * detaches. Called at once by `extend()` once the document is ready.
   */
  ready?(session: DocumentSession, signal: AbortSignal): void;
  /**
   * A viewport attached; `signal` aborts when it detaches. Called at once by
   * `extend()` while one is attached.
   */
  viewport?(scroller: HTMLElement, content: HTMLElement, signal: AbortSignal): void;
  /** The viewport is about to detach, its pages still in place. */
  detaching?(): void;
  /**
   * The document is closing, its pages still in place: what was kept for it
   * goes. The `ready` signal aborts right after.
   */
  closed?(): void;
  /** The document's pages first showed pixels, once each time it is shown. */
  painted?(): void;
  /** A page's text layer was built, or, with null, removed. */
  textLayer?(pageIndex: number, handle: TextLayerHandle | null): void;
  /** A page's annotation layer was built, or, with null, removed. */
  annotationLayer?(pageIndex: number, handle: AnnotationLayerHandle | null): void;
  /** A link, outline entry, or named action is about to jump. */
  jumping?(): void;
  /** A link's named action the viewer does not carry out itself, such as "GoBack". */
  namedAction?(action: string): void;
  /** A viewer of the document showed or hid layers: drawings are stale. */
  layersChanged?(): void;
}

/**
 * The features attached to a viewer, and what they heard: the viewer calls
 * a hook here once, and every extension hears it. A feature registered late
 * hears at once what already happened, from `add()`; one registered while a
 * hook runs hears no more of that hook than `add()` replays, as listeners
 * added while a DOM event dispatches do not hear it.
 */
export class ExtensionSet {
  readonly #extensions = new Set<ViewerExtension>();
  /** Features still loading, which the first layout of a document waits for. */
  readonly #deferred = new Set<Promise<unknown>>();
  /** The document whose `ready` hooks ran and the signal they got, which `add()` replays. */
  #ready: { session: DocumentSession; signal: AbortSignal } | null = null;
  /** The document whose `prepare` hooks run now, which `add()` replays too. */
  #preparing: { session: DocumentSession; signal: AbortSignal } | null = null;
  #painted = false;

  /**
   * Register `extension`; returns the function that removes it. It hears
   * `prepare` and `ready` for a ready document, and `viewport` for
   * `viewport`, the viewport attached, if any.
   */
  add(
    extension: ViewerExtension,
    viewport: { scroller: HTMLElement; content: HTMLElement; signal: AbortSignal } | null,
  ): () => void {
    this.#extensions.add(extension);
    const ready = this.#ready;
    const preparing = this.#preparing;
    if (preparing) extension.prepare?.(preparing.session, preparing.signal);
    else if (ready && !ready.signal.aborted) {
      extension.prepare?.(ready.session, ready.signal);
      extension.ready?.(ready.session, ready.signal);
    }
    if (viewport) extension.viewport?.(viewport.scroller, viewport.content, viewport.signal);
    if (ready && !ready.signal.aborted && this.#painted) extension.painted?.();
    return () => {
      this.#extensions.delete(extension);
    };
  }

  /** Make the next document's first layout wait for `loading` (see `loaded()`). */
  defer(loading: Promise<unknown>): void {
    const waiting = loading
      .catch((error: unknown) => console.error("loading a feature failed", error))
      .finally(() => this.#deferred.delete(waiting));
    this.#deferred.add(waiting);
  }

  /** Settles once the features loading now have loaded. */
  loaded(): Promise<unknown> {
    return Promise.all([...this.#deferred]);
  }

  /** Tell each extension registered now, but one removed meanwhile, through `hear`. */
  #each(hear: (extension: ViewerExtension) => void): void {
    for (const extension of [...this.#extensions]) {
      if (this.#extensions.has(extension)) hear(extension);
    }
  }

  prepare(session: DocumentSession, signal: AbortSignal): void {
    this.#preparing = { session, signal };
    try {
      this.#each((extension) => extension.prepare?.(session, signal));
    } finally {
      this.#preparing = null;
    }
  }

  ready(session: DocumentSession, signal: AbortSignal): void {
    this.#ready = { session, signal };
    this.#each((extension) => extension.ready?.(session, signal));
  }

  viewport(scroller: HTMLElement, content: HTMLElement, signal: AbortSignal): void {
    this.#each((extension) => extension.viewport?.(scroller, content, signal));
  }

  /** The viewport is about to detach; with `rebuilding`, the document is shown again after. */
  detaching(rebuilding = false): void {
    this.#each((extension) => extension.detaching?.());
    this.#painted = false;
    if (rebuilding) this.#ready = null;
  }

  closed(): void {
    this.#each((extension) => extension.closed?.());
    this.#ready = null;
    this.#painted = false;
  }

  painted(): void {
    this.#painted = true;
    this.#each((extension) => extension.painted?.());
  }

  textLayer(pageIndex: number, handle: TextLayerHandle | null): void {
    this.#each((extension) => extension.textLayer?.(pageIndex, handle));
  }

  annotationLayer(pageIndex: number, handle: AnnotationLayerHandle | null): void {
    this.#each((extension) => extension.annotationLayer?.(pageIndex, handle));
  }

  jumping(): void {
    this.#each((extension) => extension.jumping?.());
  }

  namedAction(action: string): void {
    this.#each((extension) => extension.namedAction?.(action));
  }

  layersChanged(): void {
    this.#each((extension) => extension.layersChanged?.());
  }
}
