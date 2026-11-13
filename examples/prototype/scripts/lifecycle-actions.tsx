import { PdfDocument, PdfViewer, usePrint, useSave, type Viewer } from "parapdf";
import { Activity, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { configureEngine } from "../src/engines.ts";

interface ActionProbe {
  viewer: Viewer | null;
  controls: { save: ReturnType<typeof useSave>; print: ReturnType<typeof usePrint> } | null;
  show(visible: boolean): void;
}

function ActionControls({ probe }: { probe: ActionProbe }) {
  const save = useSave();
  const print = usePrint();
  useEffect(() => {
    probe.controls = { save, print };
  });
  return <output data-saving={save.saving} data-printing={print.printing} />;
}
function ActionReader({ probe }: { probe: ActionProbe }) {
  const [visible, setVisible] = useState(true);
  probe.show = setVisible;
  return (
    <PdfDocument source="/corpus/usrguide.pdf">
      <PdfViewer
        ref={(next) => {
          probe.viewer = next;
        }}
        style={{ height: 400 }}
      />
      <Activity mode={visible ? "visible" : "hidden"}>
        <ActionControls probe={probe} />
      </Activity>
    </PdfDocument>
  );
}

/** Exercise action hooks whose controls hide while the document stays open. */
export async function checkActionLifetimes(engine: string) {
  configureEngine(engine, true, undefined, undefined);
  const probe: ActionProbe = { viewer: null, controls: null, show() {} };
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  const until = async (ready: () => boolean) => {
    const deadline = performance.now() + 10_000;
    while (!ready()) {
      if (performance.now() > deadline) throw new Error("Action controls did not become ready");
      await tick();
    }
  };
  try {
    flushSync(() => root.render(<ActionReader probe={probe} />));
    await until(() => probe.viewer?.session != null && probe.controls !== null);
    const currentControls = () => {
      if (!probe.controls) throw new Error("Missing action controls");
      return probe.controls;
    };
    const doc = probe.viewer?.session;
    if (!doc) throw new Error("Missing document");
    const results: Record<string, boolean> = {};
    for (const action of ["save", "print"] as const) {
      let finish = () => {};
      const waiting = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const stop = new AbortController();
      doc.onCommit(() => waiting, stop.signal);
      const pending =
        action === "save" ? currentControls().save.save() : currentControls().print.print();
      await until(() =>
        action === "save" ? currentControls().save.saving : currentControls().print.printing,
      );
      flushSync(() => probe.show(false));
      finish();
      await pending;
      stop.abort();
      flushSync(() => probe.show(true));
      await tick();
      results[action] =
        action === "save"
          ? !currentControls().save.saving
          : !currentControls().print.printing && currentControls().print.progress === null;
    }
    return results;
  } finally {
    flushSync(() => root.unmount());
    element.remove();
  }
}
