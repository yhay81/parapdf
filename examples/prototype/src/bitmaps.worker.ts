/**
 * Worker half of the bitmap display benchmark (bitmaps.ts). It makes page
 * pixels the way hayro hands them over, tightly packed RGBA rows, and turns
 * them into what the main thread shows: an ImageBitmap made from ImageData
 * (the hybrid engine today), an ImageBitmap snapshot of an OffscreenCanvas
 * (pdf.js's renderer worker), or the raw pixels. For canvases the main thread
 * handed over with transferControlToOffscreen() it draws them itself.
 */
import type { BitmapReply, BitmapRequest } from "./bitmaps.ts";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BitmapRequest>) => void) | null;
  postMessage(message: BitmapReply, transfer?: Transferable[]): void;
};

let canvases: OffscreenCanvas[] = [];

/** Opaque grey noise, so no stage can skip work for flat or transparent pixels. */
function pixels(width: number, height: number, seed: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(width * height * 4);
  const words = new Uint32Array(data.buffer);
  let state = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < words.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const grey = 160 + ((state >>> 24) & 0x5f);
    words[i] = 0xff000000 | (grey << 16) | (grey << 8) | grey;
  }
  return data;
}

scope.onmessage = async ({ data: request }) => {
  if (request.type === "canvases") {
    canvases = request.canvases;
    return;
  }
  const canvas = canvases[request.page];
  if (request.type === "release") {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    scope.postMessage({ id: request.id, workerMs: 0 });
    return;
  }
  const { id, page, width, height, make, show } = request;
  const image = new ImageData(pixels(width, height, page + 1), width, height);
  const start = performance.now();
  if (show === "worker-2d" || show === "worker-bitmaprenderer") {
    if (!canvas) throw new Error(`no canvas for page ${page}`);
    canvas.width = width;
    canvas.height = height;
    if (show === "worker-2d") {
      canvas.getContext("2d", { alpha: false })?.putImageData(image, 0, 0);
    } else {
      canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(await createImageBitmap(image));
    }
    scope.postMessage({ id, workerMs: performance.now() - start });
    return;
  }
  if (make === "pixels") {
    const buffer = image.data.buffer;
    scope.postMessage({ id, workerMs: performance.now() - start, buffer, width, height }, [buffer]);
    return;
  }
  let bitmap: ImageBitmap;
  if (make === "offscreen") {
    // pdf.js's renderer worker: an opaque 2D OffscreenCanvas, then its snapshot.
    const offscreen = new OffscreenCanvas(width, height);
    offscreen.getContext("2d", { alpha: false })?.putImageData(image, 0, 0);
    bitmap = offscreen.transferToImageBitmap();
  } else {
    bitmap = await createImageBitmap(image);
  }
  scope.postMessage({ id, workerMs: performance.now() - start, bitmap }, [bitmap]);
};
