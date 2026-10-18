import { measureIdle } from "./metrics.ts";

/**
 * Idle baseline for the scroll benchmark: timer lateness and frame interval
 * of a cross-origin-isolated page from the same server, without the viewer.
 */
declare global {
  interface Window {
    __done?: boolean;
    __result?: unknown;
  }
}

void measureIdle().then((idle) => {
  window.__result = idle;
  window.__done = true;
});
