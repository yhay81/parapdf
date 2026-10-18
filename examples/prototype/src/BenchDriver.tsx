import { usePdfState, usePdfViewer } from "parapdf";
import { useEffect } from "react";
import { summarizeRecords } from "./instrument.ts";
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
  /** CSS pixels scrolled per second, independent of the browser's frame rate. */
  speed: number;
  durationMs: number;
  /** Idle timer lateness and frame interval from calibrate.html in the same browser. */
  idle: Pick<IdleBaseline, "timerLagP95Ms" | "frameIntervalMs">;
  /** Shared commit counter fed by the app's <Profiler>. */
  commits: { count: number };
  label: Record<string, unknown>;
  /** Stops the lag monitor that has run since startup; called when scrolling begins. */
  stopStartupLag: (() => ReturnType<ReturnType<typeof startLagMonitor>>) | null;
}

/**
 * Scripted scroll benchmark: waits for the first page, scrolls at a constant
 * speed, and publishes main-thread, frame, blank-area, React-commit, and
 * render counts on `window.__result` for the Playwright runner.
 */
export function BenchDriver({
  speed,
  durationMs,
  idle,
  commits,
  label,
  stopStartupLag,
}: BenchDriverProps) {
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
      const startPage = viewer.store.get().currentPage;
      const startupLag = stopStartupLag?.();
      const stopLag = startLagMonitor(blockedThreshold(idle));
      const stopFrames = startFrameMonitor(idle.frameIntervalMs);
      let sampledFrames = 0;
      let blankSum = 0;
      let blankFrames = 0;
      const start = performance.now();
      const startTop = scroller.scrollTop;

      await new Promise<void>((resolve) => {
        const tick = () => {
          if (cancelled) return resolve();
          const blank = viewer.blankFraction();
          blankSum += blank;
          if (blank > 0.01) blankFrames++;
          sampledFrames++;
          const elapsed = performance.now() - start;
          const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
          if (elapsed >= durationMs || atEnd) return resolve();
          // Position follows elapsed time, so a slow or dropped frame jumps
          // further instead of slowing the scroll down.
          scroller.scrollTop = startTop + (speed * elapsed) / 1000;
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
      const layout = viewer.store.get().layout;
      publish({
        ...label,
        engine: viewer.engineName,
        firstPaintMs,
        startupLag,
        ...(layout ? await summarizeRecords(layout.scale) : {}),
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
  }, [status, viewer, speed, durationMs, idle, commits, label, stopStartupLag]);

  return null;
}
