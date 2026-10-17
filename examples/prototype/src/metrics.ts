/**
 * Main-thread availability: a 4 ms timer chain records how late each tick
 * fires. The summed lateness approximates how long the page could not
 * respond to input.
 */
const JITTER_MS = 2;

export function startLagMonitor(intervalMs = 4) {
  const lags: number[] = [];
  let running = true;
  let expected = performance.now() + intervalMs;
  const tick = () => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + intervalMs;
    if (running) setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
  return () => {
    running = false;
    const sorted = [...lags].sort((a, b) => a - b);
    return {
      p95Ms: quantile(sorted, 0.95),
      maxMs: sorted.at(-1) ?? 0,
      // Timers jitter by about a millisecond even on an idle page; count only
      // the lateness beyond that so idle scrolling reads as zero.
      blockedMs: lags.reduce((sum, lag) => sum + Math.max(0, lag - JITTER_MS), 0),
    };
  };
}

/** Animation-frame intervals; a frame longer than 34 ms dropped at least one vsync at 60 Hz. */
export function startFrameMonitor() {
  const intervals: number[] = [];
  let running = true;
  let last = performance.now();
  const tick = (now: number) => {
    intervals.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    running = false;
    const sorted = [...intervals].sort((a, b) => a - b);
    return {
      frames: intervals.length,
      p95Ms: quantile(sorted, 0.95),
      maxMs: sorted.at(-1) ?? 0,
      dropped: intervals.filter((interval) => interval > 34).length,
    };
  };
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
}

export const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
