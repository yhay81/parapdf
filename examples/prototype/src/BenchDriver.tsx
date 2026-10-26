import { useViewState, type Viewer } from "parapdf";
import { useEffect } from "react";
import {
  blockedThreshold,
  type IdleBaseline,
  nextFrame,
  sleep,
  startFrameMonitor,
  startLagMonitor,
} from "./metrics.ts";

declare global {
  interface Window {
    __done?: boolean;
    __result?: unknown;
  }
}

export interface BenchDriverProps {
  viewer: Viewer;
  /** CSS pixels scrolled per second, independent of the browser's frame rate. */
  speed: number;
  durationMs: number;
  /** Idle timer lateness and frame interval from calibrate.html in the same browser. */
  idle: Pick<IdleBaseline, "timerLagP95Ms" | "frameIntervalMs">;
  /** Shared commit counter fed by the app's <Profiler>. */
  commits: { count: number };
  label: Record<string, unknown>;
}

/**
 * Scripted scroll benchmark: waits for the first page, scrolls at a constant
 * speed along the direction pages follow each other (sideways in
 * "horizontal" mode), and publishes main-thread, frame, blank-area,
 * React-commit, store, and render counts on `window.__result` for the
 * Playwright runner.
 */
export function BenchDriver({ viewer, speed, durationMs, idle, commits, label }: BenchDriverProps) {
  const ready = useViewState(viewer, (state) => state.layout !== null);

  useEffect(() => {
    if (!ready) return;
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

      const before = {
        ...(viewer.stats ?? {
          base: 0,
          detail: 0,
          text: 0,
          annotations: 0,
          cancelled: 0,
          failed: 0,
        }),
      };
      const commitsBefore = commits.count;
      const { scrollMode, scale, currentPage: startPage } = viewer.store.get();
      // What the store publishes while scrolling: React commits should follow
      // changes of the mounted window and the current page, not frames.
      const published = { updates: 0, windows: 0, currentPages: 0 };
      let previous = viewer.store.get();
      const unsubscribe = viewer.store.subscribe(() => {
        const state = viewer.store.get();
        published.updates++;
        if (state.first !== previous.first || state.last !== previous.last) published.windows++;
        if (state.currentPage !== previous.currentPage) published.currentPages++;
        previous = state;
      });
      const stopLag = startLagMonitor(blockedThreshold(idle));
      const stopFrames = startFrameMonitor(idle.frameIntervalMs);
      let sampledFrames = 0;
      let blankSum = 0;
      let blankFrames = 0;
      const start = performance.now();
      // Pages follow each other sideways in "horizontal" mode and downward in
      // the others.
      const sideways = scrollMode === "horizontal";
      const startPosition = sideways ? scroller.scrollLeft : scroller.scrollTop;

      await new Promise<void>((resolve) => {
        const tick = () => {
          if (cancelled) return resolve();
          const blank = viewer.blankFraction();
          blankSum += blank;
          if (blank > 0.01) blankFrames++;
          sampledFrames++;
          const elapsed = performance.now() - start;
          const atEnd = sideways
            ? scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1
            : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
          if (elapsed >= durationMs || atEnd) return resolve();
          // Position follows elapsed time, so a slow or dropped frame jumps
          // further instead of slowing the scroll down.
          const position = startPosition + (speed * elapsed) / 1000;
          if (sideways) scroller.scrollLeft = position;
          else scroller.scrollTop = position;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      const scrollMs = performance.now() - start;
      const commitsDuringScroll = commits.count - commitsBefore;
      unsubscribe();
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
        scrollMode,
        scale,
        firstPaintMs,
        scrollMs,
        pagesCrossed,
        commitsDuringScroll,
        published,
        blankMeanPct: (blankSum / Math.max(1, sampledFrames)) * 100,
        blankFramesPct: (blankFrames / Math.max(1, sampledFrames)) * 100,
        settleMs,
        lag,
        frames,
        renders: {
          base: after.base - before.base,
          detail: after.detail - before.detail,
          text: after.text - before.text,
          annotations: after.annotations - before.annotations,
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
  }, [ready, viewer, speed, durationMs, idle, commits, label]);

  return null;
}
