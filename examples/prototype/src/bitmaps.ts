/**
 * Bitmap display benchmark page (scripts/bitmap-bench.ts drives it). A worker
 * makes page-sized bitmaps the way an engine worker would, and this page shows
 * them on page canvases inside a scroll container, then reveals, scrolls, and
 * releases those canvases while a 4 ms timer chain and animation frames record
 * how long the main thread was blocked. Nothing else runs on the page, so the
 * cost of each display path is measured apart from rendering.
 */
import { blockedThreshold, measureIdle, nextFrame, sleep } from "./metrics.ts";

/** How the worker makes a page bitmap. */
export type BitmapMake = "imagedata" | "offscreen" | "pixels";
/**
 * How the main thread shows it: a `bitmaprenderer` context, `drawImage` on an
 * opaque 2D context, `putImageData` of the raw pixels, or not at all because
 * the worker draws into canvases it got through transferControlToOffscreen().
 */
export type BitmapShow =
  | "bitmaprenderer"
  | "2d"
  | "putimagedata"
  | "worker-2d"
  | "worker-bitmaprenderer";

export interface BitmapBenchConfig {
  make: BitmapMake;
  show: BitmapShow;
  pages: number;
  /** Bitmap size in device pixels; pages are laid out at this size in CSS pixels / devicePixelRatio. */
  width: number;
  height: number;
  /** CSS pixels per second and duration of the back-and-forth scroll. */
  scrollSpeed: number;
  scrollMs: number;
  /** How long each event's window lasts. */
  windowMs: number;
}

export type BitmapRequest =
  | { type: "canvases"; canvases: OffscreenCanvas[] }
  | {
      type: "render";
      id: number;
      page: number;
      width: number;
      height: number;
      make: BitmapMake;
      show: BitmapShow;
    }
  | { type: "release"; id: number; page: number };

export interface BitmapReply {
  id: number;
  workerMs: number;
  bitmap?: ImageBitmap;
  buffer?: ArrayBuffer;
  width?: number;
  height?: number;
}

/** Main-thread cost of one event, from its start until `windowMs` later. */
export interface BitmapEvent {
  kind: "deliver" | "reveal" | "revisit" | "release";
  page: number;
  /** The page was in the viewport when the event happened. */
  visible: boolean;
  /** The synchronous call: show, scroll position change, or release. */
  callMs: number;
  /** Until the second animation frame after the event started. */
  twoFramesMs: number;
  blockedMs: number;
  maxLagMs: number;
  droppedFrames: number;
  workerMs?: number;
}

export interface BitmapBenchResult {
  config: BitmapBenchConfig;
  userAgent: string;
  devicePixelRatio: number;
  crossOriginIsolated: boolean;
  idle: { timerLagP50Ms: number; timerLagP95Ms: number; frameIntervalMs: number };
  thresholdMs: number;
  events: BitmapEvent[];
  scroll: { blockedMs: number; maxLagMs: number; droppedFrames: number; frames: number };
  /** Everything from the first delivery to the last release. */
  totalBlockedMs: number;
}

declare global {
  interface Window {
    __runBitmapBench?: (config: BitmapBenchConfig) => Promise<BitmapBenchResult>;
    __ready?: boolean;
  }
}

/** Every 4 ms timer's lateness and every animation frame, kept for later windows. */
function startRecorder(thresholdMs: number, idleFrameMs: number) {
  const lags: { at: number; lag: number }[] = [];
  const frames: number[] = [];
  let running = true;
  let expected = performance.now() + 4;
  const tick = () => {
    const now = performance.now();
    lags.push({ at: now, lag: Math.max(0, now - expected) });
    expected = now + 4;
    if (running) setTimeout(tick, 4);
  };
  setTimeout(tick, 4);
  const frame = (now: number) => {
    frames.push(now);
    if (running) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    /** Lateness recorded from `from` to `to`; a stall counts where it ends. */
    window(from: number, to: number) {
      const inside = lags.filter((sample) => sample.at >= from && sample.at <= to);
      const times = frames.filter((at) => at >= from && at <= to);
      let dropped = 0;
      for (let i = 1; i < times.length; i++) {
        if ((times[i] as number) - (times[i - 1] as number) > idleFrameMs * 1.5) dropped++;
      }
      return {
        blockedMs: inside.reduce((sum, sample) => sum + Math.max(0, sample.lag - thresholdMs), 0),
        maxLagMs: inside.reduce((max, sample) => Math.max(max, sample.lag), 0),
        droppedFrames: dropped,
        frames: Math.max(0, times.length - 1),
      };
    },
    stop() {
      running = false;
    },
  };
}

async function run(config: BitmapBenchConfig): Promise<BitmapBenchResult> {
  const { make, show, pages, width, height, windowMs } = config;
  const ratio = devicePixelRatio;
  const cssWidth = width / ratio;
  const cssHeight = height / ratio;
  const gap = 16;
  const scroller = document.getElementById("scroller") as HTMLElement;
  const content = document.getElementById("content") as HTMLElement;
  content.style.height = `${gap + pages * (cssHeight + gap)}px`;
  const topOf = (page: number) => gap + page * (cssHeight + gap);
  const canvases: HTMLCanvasElement[] = [];
  for (let page = 0; page < pages; page++) {
    const section = document.createElement("section");
    section.className = "page";
    Object.assign(section.style, {
      top: `${topOf(page)}px`,
      width: `${cssWidth}px`,
      height: `${cssHeight}px`,
    });
    const canvas = document.createElement("canvas");
    section.append(canvas);
    content.append(section);
    canvases.push(canvas);
  }

  const worker = new Worker(new URL("./bitmaps.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, (reply: BitmapReply) => void>();
  worker.onmessage = ({ data }: MessageEvent<BitmapReply>) => {
    pending.get(data.id)?.(data);
    pending.delete(data.id);
  };
  let nextId = 1;
  const call = (request: BitmapRequest & { id: number }) =>
    new Promise<BitmapReply>((resolve) => {
      pending.set(request.id, resolve);
      worker.postMessage(request);
    });
  const workerDraws = show === "worker-2d" || show === "worker-bitmaprenderer";
  if (workerDraws) {
    const offscreen = canvases.map((canvas) => canvas.transferControlToOffscreen());
    worker.postMessage(
      { type: "canvases", canvases: offscreen } satisfies BitmapRequest,
      offscreen,
    );
  }

  const idle = await measureIdle(1000);
  const thresholdMs = blockedThreshold(idle);
  const recorder = startRecorder(thresholdMs, idle.frameIntervalMs);
  const events: BitmapEvent[] = [];
  const viewportHeight = scroller.clientHeight;
  const isVisible = (page: number) =>
    topOf(page) < scroller.scrollTop + viewportHeight &&
    topOf(page) + cssHeight > scroller.scrollTop;

  const observe = async (
    kind: BitmapEvent["kind"],
    page: number,
    action: () => void,
    extra: Partial<BitmapEvent> = {},
  ) => {
    performance.mark(`${kind} ${page + 1}`);
    const start = performance.now();
    action();
    const callMs = performance.now() - start;
    await nextFrame();
    await nextFrame();
    const twoFramesMs = performance.now() - start;
    await sleep(Math.max(0, start + windowMs - performance.now()));
    const { frames: _frames, ...stats } = recorder.window(start, start + windowMs);
    events.push({ kind, page, visible: isVisible(page), callMs, twoFramesMs, ...stats, ...extra });
  };

  const showReply = (canvas: HTMLCanvasElement, reply: BitmapReply) => {
    const { bitmap, buffer } = reply;
    if (bitmap) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      if (show === "bitmaprenderer") {
        canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(bitmap);
        return;
      }
      canvas.getContext("2d", { alpha: false })?.drawImage(bitmap, 0, 0);
      bitmap.close();
    } else if (buffer && reply.width && reply.height) {
      canvas.width = reply.width;
      canvas.height = reply.height;
      canvas
        .getContext("2d", { alpha: false })
        ?.putImageData(new ImageData(new Uint8ClampedArray(buffer), reply.width), 0, 0);
    }
  };

  const firstEvent = performance.now();
  // Page 1 arrives while it is visible, the others while they are below the viewport.
  for (let page = 0; page < pages; page++) {
    const id = nextId++;
    const reply = await call({ type: "render", id, page, width, height, make, show });
    const canvas = canvases[page] as HTMLCanvasElement;
    await observe("deliver", page, () => (workerDraws ? undefined : showReply(canvas, reply)), {
      workerMs: reply.workerMs,
    });
  }
  // Each page's first trip into the viewport, then return trips.
  for (let page = 1; page < pages; page++) {
    await observe("reveal", page, () => {
      scroller.scrollTop = topOf(page);
    });
  }
  for (const page of [0, 1]) {
    await observe("revisit", page, () => {
      scroller.scrollTop = topOf(page);
    });
  }

  // Back and forth over the first pages at a constant speed; nothing renders.
  const span = Math.min(topOf(Math.min(2, pages - 1)), scroller.scrollHeight - viewportHeight);
  performance.mark("scroll");
  const scrollStart = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const elapsed = now - scrollStart;
      if (elapsed >= config.scrollMs) return resolve();
      const distance = (elapsed / 1000) * config.scrollSpeed;
      const leg = distance % (2 * span);
      scroller.scrollTop = leg < span ? leg : 2 * span - leg;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const { frames, ...scroll } = recorder.window(scrollStart, performance.now());
  scroller.scrollTop = 0;
  await sleep(windowMs);

  for (let page = 0; page < pages; page++) {
    const canvas = canvases[page] as HTMLCanvasElement;
    if (workerDraws) {
      const id = nextId++;
      await call({ type: "release", id, page });
      await observe("release", page, () => {});
    } else {
      await observe("release", page, () => {
        canvas.width = 0;
        canvas.height = 0;
      });
    }
  }
  const total = recorder.window(firstEvent, performance.now());
  recorder.stop();
  worker.terminate();
  return {
    config,
    userAgent: navigator.userAgent,
    devicePixelRatio: ratio,
    crossOriginIsolated,
    idle,
    thresholdMs,
    events,
    scroll: { ...scroll, frames },
    totalBlockedMs: total.blockedMs,
  };
}

window.__runBitmapBench = run;
window.__ready = true;
