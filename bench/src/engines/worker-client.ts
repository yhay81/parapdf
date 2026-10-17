import type { EngineAdapter, PageSize, WorkerRenderResult } from "./types.ts";

type Request = { type: string } & Record<string, unknown>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** Promise-based request/response channel to an engine worker. */
class WorkerClient {
  #worker: Worker;
  #nextId = 1;
  #pending = new Map<number, Pending>();

  constructor(worker: Worker) {
    this.#worker = worker;
    worker.onmessage = (event: MessageEvent) => {
      const { id, ok, result, error } = event.data as {
        id: number;
        ok: boolean;
        result?: unknown;
        error?: string;
      };
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error));
    };
    worker.onerror = (event) => {
      for (const pending of this.#pending.values()) pending.reject(new Error(event.message));
      this.#pending.clear();
    };
  }

  call<T>(request: Request, transfer: Transferable[] = []): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.#worker.postMessage({ ...request, id }, transfer);
    });
  }

  terminate(): void {
    this.#worker.terminate();
  }
}

/**
 * Adapter for engines that rasterize in a dedicated worker.
 *
 * The worker transfers an ImageBitmap; the main thread hands it to a
 * `bitmaprenderer` context, which displays it without another pixel copy.
 */
export function createWorkerEngine(
  id: string,
  version: string,
  createWorker: () => Worker,
): EngineAdapter {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("bitmaprenderer");
  if (!context) throw new Error("bitmaprenderer is not supported");
  let client: WorkerClient | undefined;
  const ready = (): WorkerClient => {
    if (!client) throw new Error(`${id} is not initialized`);
    return client;
  };

  return {
    id,
    version,
    canvas,
    async init() {
      client = new WorkerClient(createWorker());
      await client.call({ type: "init" });
    },
    open: (data) => ready().call({ type: "open", data }, [data]),
    pageSize: (index) => ready().call<PageSize>({ type: "pageSize", index }),
    async render(index, scale) {
      const result = await ready().call<WorkerRenderResult>({ type: "render", index, scale });
      canvas.width = result.width;
      canvas.height = result.height;
      context.transferFromImageBitmap(result.bitmap);
      return { width: result.width, height: result.height, rasterMs: result.rasterMs };
    },
    memoryBytes: () => ready().call<number>({ type: "memory" }),
    async close() {
      client?.terminate();
      client = undefined;
    },
  };
}
