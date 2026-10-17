import { usePdfState, usePdfViewer } from "parapdf";
import { useEffect } from "react";
import { nextFrame, sleep, startFrameMonitor, startLagMonitor } from "./metrics.ts";

declare global {
  interface Window {
    __done?: boolean;
    __result?: unknown;
  }
}

export interface BenchDriverProps {
  /** CSS pixels scrolled per animation frame. */
  speed: number;
  durationMs: number;
  /** Shared commit counter fed by the app's <Profiler>. */
  commits: { count: number };
  label: Record<string, unknown>;
}

/**
 * Scripted scroll benchmark: waits for the first page, scrolls at a constant
 * speed, and publishes main-thread, frame, blank-area, React-commit, and
 * render counts on `window.__result` for the Playwright runner.
 */
export function BenchDriver({ speed, durationMs, commits, label }: BenchDriverProps) {
  const viewer = usePdfViewer();
  const status = usePdfState((state) => state.status);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    const publish = (result: unknown) => {
      window.__result = result;
      window.__done = true;
    };

    void (async () => {
      const waitStart = performance.now();
      while (!viewer.hasPixels(0) && performance.now() - waitStart < 30_000) await nextFrame();
      const firstPaintMs = viewer.firstPaintAt;
      await sleep(600);
      const scroller = viewer.scroller;
      if (cancelled || !scroller) return;

      const before = { ...(viewer.stats ?? { base: 0, detail: 0, cancelled: 0, failed: 0 }) };
      const commitsBefore = commits.count;
      const startPage = viewer.store.get().currentPage;
      const stopLag = startLagMonitor();
      const stopFrames = startFrameMonitor();
      let sampledFrames = 0;
      let blankSum = 0;
      let blankFrames = 0;
      const start = performance.now();

      await new Promise<void>((resolve) => {
        const tick = () => {
          if (cancelled) return resolve();
          const blank = viewer.blankFraction();
          blankSum += blank;
          if (blank > 0.01) blankFrames++;
          sampledFrames++;
          const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
          if (performance.now() - start >= durationMs || atEnd) return resolve();
          scroller.scrollTop += speed;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      const scrollMs = performance.now() - start;
      const commitsDuringScroll = commits.count - commitsBefore;
      const lag = stopLag();
      const frames = stopFrames();
      const pagesCrossed = viewer.store.get().currentPage - startPage;
      const settleStart = performance.now();
      while (viewer.blankFraction() > 0 && performance.now() - settleStart < 10_000)
        await nextFrame();
      const settleMs = performance.now() - settleStart;
      const after = viewer.stats ?? before;
      publish({
        ...label,
        engine: viewer.engineName,
        firstPaintMs,
        scrollMs,
        pagesCrossed,
        commitsDuringScroll,
        blankMeanPct: (blankSum / Math.max(1, sampledFrames)) * 100,
        blankFramesPct: (blankFrames / Math.max(1, sampledFrames)) * 100,
        settleMs,
        lag,
        frames,
        renders: {
          base: after.base - before.base,
          detail: after.detail - before.detail,
          cancelled: after.cancelled - before.cancelled,
          failed: after.failed - before.failed,
        },
        crossOriginIsolated,
        devicePixelRatio,
      });
    })().catch((error: unknown) => publish({ ...label, error: String(error) }));

    return () => {
      cancelled = true;
    };
  }, [status, viewer, speed, durationMs, commits, label]);

  return null;
}
