import { PdfDocument, PdfViewer, usePrint, useSave } from "parapdf";
import { Activity, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { configureEngine } from "../src/engines.ts";
import { controllerOf, type ViewerController } from "../src/internals.ts";

interface ActionProbe {
  viewer: ViewerController | null;
  controls: { save: ReturnType<typeof useSave>; print: ReturnType<typeof usePrint> } | null;
  secondary: { saving: boolean; printing: boolean } | null;
  show(visible: boolean): void;
  showSecondary(visible: boolean): void;
}

function ActionControls({ probe }: { probe: ActionProbe }) {
  const save = useSave();
  const print = usePrint();
  useEffect(() => {
    probe.controls = { save, print };
  });
  return <output data-saving={save.saving} data-printing={print.printing} />;
}

function SecondaryActionControls({ probe }: { probe: ActionProbe }) {
  const saving = useSave((s) => s.saving);
  const printing = usePrint((p) => p.printing);
  useEffect(() => {
    probe.secondary = { saving, printing };
  });
  return <output data-secondary-saving={saving} data-secondary-printing={printing} />;
}

function ActionReader({ probe }: { probe: ActionProbe }) {
  const [visible, setVisible] = useState(true);
  const [secondaryVisible, setSecondaryVisible] = useState(true);
  probe.show = setVisible;
  probe.showSecondary = setSecondaryVisible;
  return (
    <PdfDocument source="/corpus/usrguide.pdf">
      <PdfViewer
        ref={(next) => {
          probe.viewer = next ? controllerOf(next) : null;
        }}
        style={{ height: 400 }}
      />
      <Activity mode={visible ? "visible" : "hidden"}>
        <ActionControls probe={probe} />
      </Activity>
      <Activity mode={secondaryVisible ? "visible" : "hidden"}>
        <SecondaryActionControls probe={probe} />
      </Activity>
    </PdfDocument>
  );
}

/** Exercise action hooks whose controls hide while the document stays open. */
export async function checkActionLifetimes(engine: string) {
  configureEngine(engine, true, undefined, undefined);
  const probe: ActionProbe = {
    viewer: null,
    controls: null,
    secondary: null,
    show() {},
    showSecondary() {},
  };
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
    await until(
      () => probe.viewer?.session != null && probe.controls !== null && probe.secondary !== null,
    );
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
        action === "save"
          ? currentControls().save.saving && probe.secondary?.saving === true
          : currentControls().print.printing && probe.secondary?.printing === true,
      );
      if (action === "save") {
        results.sharedSave = probe.secondary?.saving === true;
      } else {
        // Hiding only one usePrint() holder keeps preparation running for the remaining holder.
        flushSync(() => probe.showSecondary(false));
        await tick();
        results.sharedPrint = currentControls().print.printing === true;
      }
      flushSync(() => {
        probe.show(false);
        probe.showSecondary(false);
      });
      finish();
      await pending;
      stop.abort();
      flushSync(() => {
        probe.show(true);
        probe.showSecondary(true);
      });
      // Reconnected passive effects schedule a render; a loaded CI runner can
      // take more than one timer tick to publish that render's controls.
      await until(() =>
        action === "save"
          ? !currentControls().save.saving && probe.secondary?.saving === false
          : !currentControls().print.printing &&
            currentControls().print.progress === null &&
            probe.secondary?.printing === false,
      );
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
