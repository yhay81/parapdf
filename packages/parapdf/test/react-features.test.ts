import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Loaded up front, so that the features' dynamic imports settle at once.
import "../src/features/annotations.ts";
import "../src/features/forms/layers.ts";
import type { AnnotationLabels } from "../src/pdfjs/editor-types.ts";
import {
  detachFeatures,
  type FeatureOptions,
  loadedFeatures,
  setFeatureOptions,
} from "../src/react/features.ts";
import { Viewer } from "../src/view/viewer.ts";
import { settle } from "./fake-pdfjs.ts";

const OFF: FeatureOptions = {
  autoLinks: false,
  forms: false,
  formScripts: false,
  annotationEditing: false,
  annotationLabels: undefined,
  enforcePermissions: false,
};

describe("the features of a viewer's options", () => {
  it("loads the features that change drawing, and takes each off as its option turns off", async () => {
    const viewer = new Viewer();
    setFeatureOptions(viewer, { ...OFF, forms: true, annotationEditing: true });
    assert.deepEqual(loadedFeatures(viewer).get(), { formLayers: null, annotations: null });
    await settle();
    const { formLayers, annotations } = loadedFeatures(viewer).get();
    assert.ok(formLayers);
    assert.ok(annotations);
    setFeatureOptions(viewer, { ...OFF, annotationEditing: true });
    assert.equal(loadedFeatures(viewer).get().formLayers, null);
    assert.equal(loadedFeatures(viewer).get().annotations, annotations);
    detachFeatures(viewer);
    assert.deepEqual(loadedFeatures(viewer).get(), { formLayers: null, annotations: null });
  });

  it("attaches nothing for options turned off before their modules load", async () => {
    const viewer = new Viewer();
    setFeatureOptions(viewer, { ...OFF, forms: true, annotationEditing: true });
    detachFeatures(viewer);
    await settle();
    assert.deepEqual(loadedFeatures(viewer).get(), { formLayers: null, annotations: null });
  });

  it("attaches each feature once when its option turns off and on again while it loads", async () => {
    const viewer = new Viewer();
    const on = { ...OFF, forms: true, annotationEditing: true };
    setFeatureOptions(viewer, on);
    setFeatureOptions(viewer, OFF);
    setFeatureOptions(viewer, on);
    const attached: unknown[] = [];
    loadedFeatures(viewer).subscribe(() => attached.push(loadedFeatures(viewer).get()));
    await settle();
    assert.equal(attached.length, 2);
    const { formLayers, annotations } = loadedFeatures(viewer).get();
    assert.ok(formLayers);
    assert.ok(annotations);
    detachFeatures(viewer);
  });

  it("sets labels only when they name a control differently, and scripts only when they change", async () => {
    const viewer = new Viewer();
    const labels: Partial<AnnotationLabels> = { highlight: "Marker" };
    const options = { ...OFF, forms: true, annotationEditing: true, annotationLabels: labels };
    setFeatureOptions(viewer, options);
    await settle();
    const { formLayers, annotations } = loadedFeatures(viewer).get();
    assert.ok(formLayers && annotations);
    const setLabels: Partial<AnnotationLabels>[] = [];
    const setScripts: boolean[] = [];
    annotations.setLabels = (next) => void setLabels.push(next);
    formLayers.setScripts = (next) => void setScripts.push(next);
    // Applications pass labels inline: equal ones are new objects at every render.
    setFeatureOptions(viewer, { ...options, annotationLabels: { highlight: "Marker" } });
    assert.deepEqual(setLabels, []);
    setFeatureOptions(viewer, {
      ...options,
      annotationLabels: { highlight: "Marker", ink: "Pen" },
    });
    setFeatureOptions(viewer, { ...options, annotationLabels: undefined });
    assert.deepEqual(setLabels, [{ highlight: "Marker", ink: "Pen" }, {}]);
    setFeatureOptions(viewer, { ...options, annotationLabels: undefined, formScripts: true });
    setFeatureOptions(viewer, { ...options, annotationLabels: undefined, formScripts: true });
    setFeatureOptions(viewer, { ...options, annotationLabels: undefined });
    assert.deepEqual(setScripts, [true, false]);
    assert.equal(setLabels.length, 2);
    detachFeatures(viewer);
  });
});
