import type { WorkerRequest } from "./types.ts";

export interface Reply {
  result: unknown;
  transfer?: Transferable[];
}

type Handlers = {
  [K in WorkerRequest["type"]]: (request: Extract<WorkerRequest, { type: K }>) => Promise<Reply>;
};

// The bench compiles with the DOM library, so describe the worker scope directly.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

/** Serve engine requests inside a worker, one at a time and in order. */
export function serve(handlers: Handlers): void {
  let queue = Promise.resolve();
  scope.onmessage = (event) => {
    const request = event.data;
    queue = queue.then(async () => {
      try {
        const handler = handlers[request.type] as (request: WorkerRequest) => Promise<Reply>;
        const reply = await handler(request);
        scope.postMessage({ id: request.id, ok: true, result: reply.result }, reply.transfer ?? []);
      } catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        scope.postMessage({ id: request.id, ok: false, error: message });
      }
    });
  };
}

/** Wrap tightly packed RGBA8 pixels in an ImageBitmap ready for transfer. */
export async function toBitmap(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(pixels, width, height));
}
