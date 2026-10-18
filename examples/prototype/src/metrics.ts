/**
 * Main-thread availability: a 4 ms timer chain records how late each tick
 * fires. The summed lateness approximates how long the page could not
 * respond to input. Only lateness beyond `thresholdMs` counts as blocked;
 * see blockedThreshold().
 */
export function startLagMonitor(thresholdMs: number, intervalMs = 4) {
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
      blockedMs: lags.reduce((sum, lag) => sum + Math.max(0, lag - thresholdMs), 0),
    };
  };
}

/** Animation-frame intervals; a frame longer than 1.5 idle intervals missed at least one vsync. */
export function startFrameMonitor(idleFrameMs: number) {
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
      dropped: intervals.filter((interval) => interval > idleFrameMs * 1.5).length,
    };
  };
}

/**
 * Lateness that counts as blocked: beyond 2 ms, so the small delays every
 * frame adds while the page scrolls do not pile up, and beyond the idle
 * page's 95th percentile, because WebKit delivers even idle timers about
 * 4 ms late.
 */
export const blockedThreshold = (idle: Pick<IdleBaseline, "timerLagP95Ms">): number =>
  Math.max(2, idle.timerLagP95Ms);

export interface IdleBaseline {
  timerLagP50Ms: number;
  timerLagP95Ms: number;
  frameIntervalMs: number;
}

/** Timer lateness and animation-frame interval of a page doing nothing else. */
export async function measureIdle(durationMs = 1000): Promise<IdleBaseline> {
  const lags: number[] = [];
  const frames: number[] = [];
  const until = performance.now() + durationMs;
  await Promise.all([
    new Promise<void>((resolve) => {
      let expected = performance.now() + 4;
      const tick = () => {
        const now = performance.now();
        lags.push(Math.max(0, now - expected));
        expected = now + 4;
        if (now < until) setTimeout(tick, 4);
        else resolve();
      };
      setTimeout(tick, 4);
    }),
    new Promise<void>((resolve) => {
      let last = -1;
      const tick = (now: number) => {
        if (last >= 0) frames.push(now - last);
        last = now;
        if (now < until) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    }),
  ]);
  lags.sort((a, b) => a - b);
  frames.sort((a, b) => a - b);
  return {
    timerLagP50Ms: quantile(lags, 0.5),
    timerLagP95Ms: quantile(lags, 0.95),
    frameIntervalMs: quantile(frames, 0.5),
  };
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
}

export const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
