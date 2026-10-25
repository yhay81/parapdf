/** A controller that each of `parents` aborts too, for work that may also stop before them. */
export function linked(...parents: readonly (AbortSignal | undefined)[]): AbortController {
  const controller = new AbortController();
  // With the parent's reason, which the work then fails with.
  for (const parent of parents) {
    if (parent?.aborted) controller.abort(parent.reason);
    else {
      parent?.addEventListener("abort", () => controller.abort(parent.reason), {
        once: true,
        signal: controller.signal,
      });
    }
  }
  return controller;
}
