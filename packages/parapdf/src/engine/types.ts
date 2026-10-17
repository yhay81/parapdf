/**
 * The narrow engine boundary. The runtime only ever talks to an engine through
 * these types, so another engine can be measured without touching React code.
 */

/** Page size in PDF points (1/72 in), rotation already applied. */
export interface PageSize {
  width: number;
  height: number;
}

export type PdfSource = { url: string } | { data: ArrayBuffer | Uint8Array };

export interface RenderRequest {
  pageIndex: number;
  /** Device pixels per PDF point. */
  scale: number;
  canvas: HTMLCanvasElement;
}

export interface RenderTask {
  /** Resolves once the pixels are on `canvas`; rejects with a cancellation error after `cancel`. */
  readonly promise: Promise<void>;
  cancel(): void;
}

export interface PdfEngineDocument {
  readonly pageCount: number;
  pageSize(pageIndex: number): Promise<PageSize>;
  render(request: RenderRequest): RenderTask;
  /** Drop cached parsing results for a page that left the mounted window. */
  releasePage(pageIndex: number): void;
  destroy(): Promise<void>;
}

export interface PdfEngine {
  readonly name: string;
  open(source: PdfSource): Promise<PdfEngineDocument>;
}

export class RenderCancelledError extends Error {
  override readonly name = "RenderCancelledError";
}

export const isRenderCancelled = (error: unknown): boolean =>
  error instanceof RenderCancelledError ||
  (error instanceof Error && error.name === "RenderingCancelledException");
