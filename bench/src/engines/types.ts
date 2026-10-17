export interface PageSize {
  width: number;
  height: number;
}

export interface RenderStats {
  width: number;
  height: number;
  /** Raster time measured inside the worker, when the engine renders in one. */
  rasterMs?: number;
}

/**
 * The benchmark's view of a rendering engine.
 *
 * `render` resolves only after the pixels are committed to `canvas`, so every
 * engine is timed to the same observable point: a displayable page.
 */
export interface EngineAdapter {
  readonly id: string;
  readonly version: string;
  readonly canvas: HTMLCanvasElement;
  init(): Promise<void>;
  open(data: ArrayBuffer): Promise<{ pageCount: number }>;
  pageSize(index: number): Promise<PageSize>;
  render(index: number, scale: number): Promise<RenderStats>;
  /** WebAssembly linear memory in bytes for wasm engines. */
  memoryBytes(): Promise<number | undefined>;
  close(): Promise<void>;
}

/** Messages understood by every worker-hosted engine. */
export type WorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "open"; data: ArrayBuffer }
  | { id: number; type: "pageSize"; index: number }
  | { id: number; type: "render"; index: number; scale: number }
  | { id: number; type: "memory" };

export interface WorkerRenderResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  rasterMs: number;
}
