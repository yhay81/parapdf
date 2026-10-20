# Draft pdf.js issue: knockout groups composite every element over the whole group canvas

Status: draft only. Not filed and not posted anywhere; the user decides
whether to file it. Written on 2026-10-19 by a side session of the ParaPDF
work, from the zoom measurement whose JavaScript profile put 85 ms of
`drawImage` in `CanvasGraphics#compositeKnockoutSurface`.

Reproduction: `bench/scripts/knockout-repro.html` (the page: pdf.js's display
API only, with timing wrappers) and `bench/scripts/knockout-repro.ts` (the
Playwright driver that serves it and runs the configurations below). Raw
results: `bench/results/raw/knockout-*.json` (not committed).

## What changed from the hand-over finding

- The backdrop copies do not cost about 0.5 ms each. In Chromium 156 with
  `enableHWA: true`, the first of the 42 copies in a render takes about 16 ms
  on the 5000×3360 canvas at 8 px/pt, and the other 41 about 0.005 ms.
- That first copy is where Chromium flushes the drawing recorded on the GPU
  canvas so far. With the signature left out (`AnnotationMode.DISABLE`),
  reading one pixel of the canvas right after the render takes 16.8 ms;
  without such a read, the flush happens when the canvas is presented.
  Main-thread task time over the render and two frames is 20.6 ms with the
  signature and 17.8 ms without. So with `enableHWA` in Chromium the knockout
  code adds about 3 ms of main-thread time, and the 85 ms of `drawImage` in
  ParaPDF's zoom profile is mostly a flush that happens anyway. The flush
  costs much more for the 5000×3360 region at 8 px/pt than for the whole page
  at 4 px/pt (16.8 ms against 0.9 ms), which deserves its own look on
  ParaPDF's side; it is not a pdf.js problem.
- The knockout code is expensive where the hand-over did not look: each of
  the 42 elements makes nine passes over the whole 761×254 group canvas. With
  CPU canvases (`enableHWA: false`, the API default), the signature makes the
  render 63 ms longer in Chromium, 56 ms in Playwright's Firefox (50 ms with
  `enableHWA: true`, which that build does not seem to accelerate), and
  119 ms in WebKit. With WebKit's GPU canvas the main thread stays free, but
  the frame comes 27 ms later. The issue reports this.
- Reading the backdrop once per group would not help much. Chromium and
  WebKit serve every copy after the first one in a render from a snapshot.
  Only Firefox pays again: the first copy after pdf.js continues the render
  in a new animation frame partway through the group takes 8–12 ms, once per
  render here. Limiting each element's passes to its bounding box helps: as a
  sketch, it gives pixel-identical output and removes most of the cost in
  Chromium and Firefox, and a third of it in WebKit.

## Before filing

- Reproduce by hand in release Chrome, Firefox, and Safari. Only Playwright's
  builds were measured: Playwright's WebKit is not Safari, and its headless
  Firefox gives the same numbers with `enableHWA` true and false. To serve the
  page for other browsers, run `SERVE=1 node bench/scripts/knockout-repro.ts`
  and open the printed URLs; opened by hand, the page runs one warm-up render
  and five measured ones and prints them.
- Decide whether to lead with the API default (`enableHWA: false`, which
  libraries get when they call `getDocument()` without options) or with the
  viewer's default (`enableHWA: true`). The draft leads with the API default
  and reports both.
- Attach the PDF (360 KB, public domain) and `knockout-repro.html`, which has
  no local paths. `bench/results/raw/knockout-signature-8x.png` shows the
  signature at 8 px/pt.
- The sketch was tested as the same edit to built bundles: pdfjs-dist
  6.4.299's `pdf.mjs` (pixel comparison and timings) and master 157d30e's
  `pdf.mjs` and `pdf.renderer.mjs` (pixel comparison only). The diff makes
  the edit in master's `src/display/canvas.js`, which was not built:
  bench/vendor's checkout has no build dependencies installed. Run pdf.js's
  lint and reference tests before turning it into a pull request.
- The seal is GPO's authentication seal, so other govinfo.gov PDFs probably
  carry the same group. Checking one or two more would show whether the issue
  affects many documents; none were downloaded here.
- The issue text does not mention ParaPDF.
- The last paragraph (offering a pull request) is optional.

## Issue text

**Title:** [Bug]: Knockout groups composite every element over the whole group canvas, which makes small groups expensive to render

### Attach (recommended) or Link to PDF file

`BILLS-118hr815enr.pdf` (H.R. 815, 118th Congress, enrolled bill; a US government work in the public domain), from https://www.govinfo.gov/content/pkg/BILLS-118hr815enr/pdf/BILLS-118hr815enr.pdf

Page 1 (720×1080 pt) has one annotation, a signature widget in the top left corner (95×35 pt) that shows GPO's "Authenticated U.S. Government Information" seal. Its appearance stream paints a non-isolated knockout group (`/K true`) of 42 filled outlines (41 letters and an eagle), with `ca 1` and the Normal blend mode.

### Web browser and its version

Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 (Playwright 1.64.1 builds, headless)

### Operating system and its version

macOS 27.0.1 (Apple M2 Pro)

### PDF.js version

6.4.299 (pdfjs-dist), and master at 157d30e

### Is the bug present in the latest PDF.js version?

Yes

### Is a browser extension

No

### Steps to reproduce the problem

1. Render page 1 with the display API at 8 device pixels per point into a 5000×3360 canvas (the top left of the page, which holds the signature), with and without annotations, timing the renders and their `drawImage` calls:

   ```js
   import * as pdfjsLib from "./build/pdf.mjs";

   pdfjsLib.GlobalWorkerOptions.workerSrc = "./build/pdf.worker.mjs";

   // Time every drawImage call.
   let drawImageMs = 0;
   const { drawImage } = CanvasRenderingContext2D.prototype;
   CanvasRenderingContext2D.prototype.drawImage = function (...args) {
     const start = performance.now();
     drawImage.apply(this, args);
     drawImageMs += performance.now() - start;
   };

   // enableHWA is false by default: CPU canvases.
   const pdf = await pdfjsLib.getDocument({ url: "BILLS-118hr815enr.pdf" }).promise;
   const page = await pdf.getPage(1);
   const viewport = page.getViewport({ scale: 8 }); // device pixels per point
   const { ENABLE, DISABLE } = pdfjsLib.AnnotationMode;
   for (const annotationMode of [ENABLE, DISABLE, ENABLE, DISABLE]) {
     const canvas = document.createElement("canvas");
     canvas.width = 5000; // the top left of the page, with the signature
     canvas.height = 3360;
     drawImageMs = 0;
     const start = performance.now();
     await page.render({ canvas, viewport, annotationMode }).promise;
     const ms = performance.now() - start;
     console.log(
       `${annotationMode === ENABLE ? "with" : "without"} the signature: ` +
         `${ms.toFixed(1)} ms, drawImage ${drawImageMs.toFixed(1)} ms`
     );
   }
   ```

2. Compare the last two renders; the first two warm up. In Chromium this prints, for example:

   ```text
   with the signature: 122.4 ms, drawImage 63.1 ms
   without the signature: 23.0 ms, drawImage 0.0 ms
   with the signature: 89.9 ms, drawImage 48.6 ms
   without the signature: 14.0 ms, drawImage 0.0 ms
   ```

The attached `knockout-repro.html` does the same with more options (`enableHWA`, the scale and region, pdf.js master's renderer worker) and times each `drawImage` call, telling the backdrop copies apart. Serve it from a folder that also holds the PDF and the `pdfjs-dist` package folder, open `knockout-repro.html?hwa=0&region=0,0,5000,3360` and then the same with `&annotations=0`, and it prints five timed renders after a warm-up; the page lists its other query parameters.

### What is the expected behavior?

The signature adds a few milliseconds to the render, in proportion to what its 42 fills paint: their bounding boxes cover about 68,000 device pixels at 8 px/pt.

### What went wrong?

With CPU canvases (`enableHWA: false`, the default), the signature makes the render 56–119 ms longer, depending on the browser, and nearly all of that time is in `drawImage` calls made by the knockout compositing. Median of five renders after a warm-up, 5000×3360 canvas at 8 px/pt, until the render task's promise resolves:

| Browser | Without the signature | With it | `drawImage` during the render |
| --- | --- | --- | --- |
| Chromium 156 | 15.3 ms | 78.6 ms | 47.9 ms in 253 calls |
| Firefox 157 | 18.1 ms | 73.9 ms | 47.5 ms in 253 calls |
| WebKit 27.2 | 13.5 ms | 132.7 ms | 119.5 ms in 253 calls |

In Chromium, main-thread task time over the render and two animation frames (from the DevTools protocol's `Performance.getMetrics`) goes from 14.5 to 70.1 ms.

The cost follows the size of the group's canvas, not the page's: with a 1000×600 canvas at the same scale, Chromium's main-thread time still goes from 2.4 to 53.4 ms. It grows with the zoom: for the whole page at 4 px/pt (2880×4320), the signature adds 17 ms in Chromium, 21 ms in Firefox, and 59 ms in WebKit, and at 2 px/pt 7 ms in Chromium.

### Link to a viewer

Not needed: the display API reproduces it. The viewer draws the signature as well: every annotation mode except `DISABLE` paints it, including the viewer's `ENABLE_FORMS`.

### Additional context

**Where the time goes.** Since #21242, every painting operator in a knockout group is composited as an element. For each element, [`#beginKnockoutElement`](https://github.com/mozilla/pdf.js/blob/157d30e833e5afbd282db5b1280aae4843f55c0a/src/display/canvas.js#L1770-L1813) clears the pooled temp canvas, which is as large as the group canvas, and the element is painted into it. Then [`#compositeKnockoutSurface`](https://github.com/mozilla/pdf.js/blob/157d30e833e5afbd282db5b1280aae4843f55c0a/src/display/canvas.js#L1669-L1760) works over the whole group canvas:

1. [`#createKnockoutMaskCanvas`](https://github.com/mozilla/pdf.js/blob/157d30e833e5afbd282db5b1280aae4843f55c0a/src/display/canvas.js#L1584-L1642) clears the pooled mask and draws the temp canvas into it.
2. The group canvas is drawn `destination-out` through the mask.
3. For a non-isolated group, the pooled backdrop canvas is cleared, refilled from the backdrop (here the page canvas), drawn `destination-in` through the mask, and drawn `destination-over` onto the group canvas.
4. The temp canvas is drawn onto the group canvas.

That is six `drawImage` and three `clearRect` calls over 761×254 pixels (at 8 px/pt) for each of the 42 elements: 119 times the pixels of the elements' bounding boxes. With CPU canvases the time follows: in Chromium, the 210 `drawImage` calls between group-sized canvases take 44 ms per render, and the 42 backdrop copies 1.3 ms. In Firefox, one backdrop copy also takes 8–12 ms: the first one after pdf.js continues the render in a new animation frame partway through the group.

**With `enableHWA: true`** the picture depends on the browser:

- Chromium: the passes run on the GPU, and the signature adds about 3 ms of main-thread time (17.8 → 20.6 ms). A JavaScript profile suggests otherwise: the first backdrop copy of each render takes about 16 ms, the other 41 about 0.005 ms. That copy is the first read of the canvas being rendered, which makes Chromium flush the drawing recorded on it so far. Without the signature, the same flush happens when the canvas is presented, and reading one pixel right after such a render takes 16.8 ms. So it is not a cost of the knockout code, but profiles attribute it to `#compositeKnockoutSurface`.
- WebKit: the main thread stays free (the render takes 13.6 ms without the signature and 15.0 ms with it), but the frame comes later: two animation frames after the render, 40.2 ms without the signature and 67.6 ms with it.
- Playwright's headless Firefox gives about the same numbers as with `enableHWA: false` (19.1 → 69.1 ms).

**pdf.js master** at 157d30e has the same code and gives the same numbers on the main thread. With its renderer worker (`GlobalWorkerOptions.rendererSrc`), the main thread stays free, but the render still takes 41–107 ms longer with the signature: 34.8 → 81.8 ms in Chromium, 36.2 → 77.7 ms in Firefox, and 24.2 → 130.7 ms in WebKit, with CPU canvases.

**Possible fix: composite only the element's bounding box.** Outside a box that holds everything the element painted, the temp canvas, and so the mask, are transparent, so every pass leaves those pixels unchanged, and limiting the passes to the box gives the same result. `fill()` already has the [clipped device-space bounding box](https://github.com/mozilla/pdf.js/blob/157d30e833e5afbd282db5b1280aae4843f55c0a/src/display/canvas.js#L2308) before it paints. A sketch for plain fills only, which leaves every other element on the whole canvas (diff below), renders the signature pixel-identically to the original in all three browsers, with both `enableHWA` settings, at 2, 4, and 8 px/pt, on 6.4.299 and on master (on the main thread and in the renderer worker). At 8 px/pt:

| Browser, `enableHWA`, measure | Without the signature | With it | With it and the sketch |
| --- | --- | --- | --- |
| Chromium, false, main-thread time | 14.5 ms | 70.1 ms | 25.9 ms |
| Chromium, true, main-thread time | 17.8 ms | 20.6 ms | 20.4 ms |
| Firefox, false, render | 18.1 ms | 73.9 ms | 21.0 ms |
| Firefox, true, render | 19.1 ms | 69.1 ms | 21.3 ms |
| WebKit, false, render | 13.5 ms | 132.7 ms | 92.8 ms |
| WebKit, true, two frames after the render | 40.2 ms | 67.6 ms | 67.2 ms |

In WebKit the sketch removes only a third of the added time with CPU canvases, and none of the delay with its GPU canvas. With CPU canvases, a WebKit `drawImage` that reads a canvas changed since its last read copies the whole source canvas: drawing a 30×22 rectangle from such a canvas takes 0.04 ms from a 32×24 canvas, 0.18 ms from a 761×254 one, and 11 ms from a 5000×3360 one (Chromium and Firefox stay below 0.1 ms). So for WebKit the per-element canvases would need to shrink to the element as well, and the first backdrop copy still copies the whole page canvas (16–17 ms here), which the next option avoids.

**A further option: skip the backdrop passes where they cannot change the result.** When the group needs no isolation (`needsIsolation` is false: no blend mode other than Normal and no soft mask inside, as here), is itself drawn with the Normal blend mode and without a soft mask, and its backdrop canvas is opaque (the page canvas has `alpha: false`), compositing the group onto its backdrop restores the backdrop under each element anyway, so step 3 leaves the final pixels unchanged. I checked this numerically for one pixel with the canvas compositing pdf.js does: random elements, coverage, alpha, and group alpha below 1 give the same result to rounding, while over a translucent backdrop the results differ. Skipping step 3 saves three of the nine passes per element and the reads of the page canvas.

I'm happy to turn the first change into a pull request, with a reference test whose knockout elements overlap and leave the group's canvas.

<details>
<summary>Sketch: limit each knockout element's passes to its bounding box (plain fills only)</summary>

```diff
--- a/src/display/canvas.js
+++ b/src/display/canvas.js
@@ -1581,8 +1581,15 @@
     this._clearPreparedSMask();
   }
 
-  #createKnockoutMaskCanvas(sourceCanvas, reuseEntry = null, alpha = 1) {
+  #createKnockoutMaskCanvas(
+    sourceCanvas,
+    reuseEntry = null,
+    alpha = 1,
+    rect = null
+  ) {
     const { width, height } = sourceCanvas;
+    // Only `rect` is read back, so only `rect` needs rebuilding.
+    const [rx, ry, rw, rh] = rect ?? [0, 0, width, height];
     // reuseEntry is assumed to match sourceCanvas in size (all current call
     // sites guarantee this); the mask is rebuilt in-place.
     const maskEntry = reuseEntry ?? this.canvasFactory.create(width, height);
@@ -1616,11 +1623,11 @@
       if (reuseEntry) {
         maskCtx.save();
         maskCtx.setTransform(1, 0, 0, 1, 0, 0);
-        maskCtx.clearRect(0, 0, width, height);
+        maskCtx.clearRect(rx, ry, rw, rh);
         maskCtx.restore();
       }
       maskCtx.filter = knockoutFilter;
-      maskCtx.drawImage(sourceCanvas, 0, 0);
+      maskCtx.drawImage(sourceCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
       maskCtx.filter = "none";
       return maskEntry;
     }
@@ -1641,7 +1648,7 @@
     return maskEntry;
   }
 
-  #getOrCreatePooledEntry(meta, key, width, height) {
+  #getOrCreatePooledEntry(meta, key, width, height, dirtyRect = null) {
     let entry = meta?.[key] ?? null;
     if (
       entry &&
@@ -1661,7 +1668,11 @@
     const ctx = entry.context;
     ctx.save();
     ctx.setTransform(1, 0, 0, 1, 0, 0);
-    ctx.clearRect(0, 0, width, height);
+    if (dirtyRect) {
+      ctx.clearRect(...dirtyRect);
+    } else {
+      ctx.clearRect(0, 0, width, height);
+    }
     ctx.restore();
     return entry;
   }
@@ -1692,12 +1703,21 @@
       sourceAlpha = 1,
       sourceFilter = "none",
       knockoutAlpha = 1,
+      // Pixel rectangle of surfaceCanvas that holds everything the element
+      // painted, or null for all of it. Outside it, every pass below is a
+      // no-op: the surface, and so the mask, is transparent there.
+      rect = null,
     } = options;
     const { width, height } = surfaceCanvas;
+    const [rx, ry, rw, rh] = rect ?? [0, 0, width, height];
+    if (rw <= 0 || rh <= 0) {
+      return;
+    }
     const knockoutMaskEntry = this.#createKnockoutMaskCanvas(
       surfaceCanvas,
       reuseMaskEntry,
-      knockoutAlpha
+      knockoutAlpha,
+      rect
     );
     const sourceCompositeOperation = destCtx.globalCompositeOperation;
 
@@ -1710,7 +1730,7 @@
 
     // Erase prior group content wherever the new surface has any coverage.
     destCtx.globalCompositeOperation = "destination-out";
-    destCtx.drawImage(knockoutMaskEntry.canvas, 0, 0);
+    destCtx.drawImage(knockoutMaskEntry.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
 
     if (backdropCanvas) {
       // Non-isolated: refill the just-erased footprint with the backdrop,
@@ -1721,27 +1741,44 @@
         poolMeta,
         "knockoutBackdropEntry",
         width,
-        height
+        height,
+        rect
       );
       const backdropCtx = backdropEntry.context;
       backdropCtx.drawImage(
         backdropCanvas,
-        bx,
-        by,
-        width,
-        height,
-        0,
-        0,
-        width,
-        height
+        bx + rx,
+        by + ry,
+        rw,
+        rh,
+        rx,
+        ry,
+        rw,
+        rh
       );
+      // destination-in also clears outside the drawn image: keep it to rect.
+      backdropCtx.save();
+      backdropCtx.beginPath();
+      backdropCtx.rect(rx, ry, rw, rh);
+      backdropCtx.clip();
       backdropCtx.globalCompositeOperation = "destination-in";
-      backdropCtx.drawImage(knockoutMaskEntry.canvas, 0, 0);
+      backdropCtx.drawImage(
+        knockoutMaskEntry.canvas,
+        rx,
+        ry,
+        rw,
+        rh,
+        rx,
+        ry,
+        rw,
+        rh
+      );
+      backdropCtx.restore();
       // Reset the GCO so the pooled entry is in a known state for next use.
       backdropCtx.globalCompositeOperation = "source-over";
 
       destCtx.globalCompositeOperation = "destination-over";
-      destCtx.drawImage(backdropEntry.canvas, 0, 0);
+      destCtx.drawImage(backdropEntry.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
       if (!poolMeta) {
         this.canvasFactory.destroy(backdropEntry);
       }
@@ -1751,7 +1788,7 @@
     if (FeatureTest.isCanvasFilterSupported) {
       destCtx.filter = sourceFilter ?? "none";
     }
-    destCtx.drawImage(surfaceCanvas, 0, 0);
+    destCtx.drawImage(surfaceCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
 
     destCtx.restore();
     if (!reuseMaskEntry) {
@@ -1779,12 +1816,17 @@
     this.#knockoutElementAlpha = alpha;
     const groupMeta = this.#groupStackMeta.at(-1);
     const { canvas } = this.ctx;
+    // Only the previous element's pixels need clearing.
     const tempEntry = this.#getOrCreatePooledEntry(
       groupMeta,
       "knockoutTempEntry",
       canvas.width,
-      canvas.height
+      canvas.height,
+      groupMeta?.knockoutTempDirtyRect
     );
+    if (groupMeta) {
+      groupMeta.knockoutTempDirtyRect = null;
+    }
     this.#knockoutTempCanvasEntry = tempEntry;
     const tempCtx = tempEntry.context;
     // Bracket-save before installing mirroring so #endKnockoutElement can
@@ -1820,12 +1862,24 @@
    * mask, restore the initial backdrop into the cleared footprint
    * (non-isolated only), then paint the element on top.
    * @param {boolean} started - the value returned by `#beginKnockoutElement`.
+   * @param {Array<number>|null} bbox - the element's device-space bounding
+   *   box on the group canvas, when the caller knows it; null for unknown.
    */
-  #endKnockoutElement(started) {
+  #endKnockoutElement(started, bbox = null) {
     if (!started) {
       return;
     }
     const tempEntry = this.#knockoutTempCanvasEntry;
+    let rect = null;
+    if (bbox) {
+      // One pixel of margin for anti-aliasing.
+      const { width, height } = tempEntry.canvas;
+      const x0 = Math.max(0, Math.floor(bbox[0]) - 1);
+      const y0 = Math.max(0, Math.floor(bbox[1]) - 1);
+      const x1 = Math.min(width, Math.ceil(bbox[2]) + 1);
+      const y1 = Math.min(height, Math.ceil(bbox[3]) + 1);
+      rect = [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
+    }
     const savedCtx = this.#knockoutSavedCtx;
     const savedSMaskCtx = this.#knockoutSavedSMaskCtx;
     const tempCtx = tempEntry.context;
@@ -1865,9 +1919,13 @@
           reuseMaskEntry: groupMeta?.knockoutMaskEntry ?? null,
           poolMeta: groupMeta,
           knockoutAlpha,
+          rect,
         }
       );
     } finally {
+      if (groupMeta) {
+        groupMeta.knockoutTempDirtyRect = rect;
+      }
       // Pop the begin-element bracket save so the pooled canvas re-enters
       // with a clean clip+transform stack.
       tempCtx.restore();
@@ -2362,7 +2420,11 @@
     if (consumePath) {
       this.consumePath(opIdx, path, intersect);
     }
-    this.#endKnockoutElement(started);
+    // A plain fill paints nothing outside its clipped bounding box.
+    this.#endKnockoutElement(
+      started,
+      isPatternFill ? null : (intersect ?? [0, 0, 0, 0])
+    );
   }
 
   eoFill(opIdx, path) {
@@ -3569,6 +3631,7 @@
       knockoutMaskEntry,
       // Per-group scratch pools, lazily filled and freed in endGroup.
       knockoutTempEntry: null,
+      knockoutTempDirtyRect: null,
       knockoutBackdropEntry: null,
     });
     this.groupLevel++;
```

</details>

## Results recorded for this draft

Runs of 2026-10-19, 17:55–18:09 JST, on macOS 27.0.1 on an Apple M2 Pro
(12 cores, 32 GB) on AC power, with Node 24.21.0 and Playwright 1.64.1's
Chromium 156.0.8078.4 (headless shell, ANGLE on Metal), Firefox 157.0, and
WebKit 27.2, headless, with a 1280×900 viewport at device scale factor 2.
Each job opened the document in a fresh browser context, rendered once to
warm up, and then five times; the tables give medians. The driver took turns
with other sessions' Playwright scripts (`measureInTurn`; each header line
says how often it waited) and ignored the mostly idle browsers of an
unrelated project's screenshot chains (`IGNORE_PIDS`). Other sessions kept
the load average at 6–10; the comparisons that matter ran minutes apart
under the same conditions and match exploratory runs made in the hour
before. The extra checks below (pixels, frames, micro-benchmark, snippet)
ran right after, taking turns the same way; their scripts are in the
side-session notes folder (`pdfjs-knockout-extra/`), not in the repository.

Commands, from the repository root:

```sh
node bench/scripts/knockout-repro.ts
BROWSER=firefox VIEWS=detail,page-4 node bench/scripts/knockout-repro.ts
BROWSER=webkit VIEWS=detail,page-4 node bench/scripts/knockout-repro.ts
PROBE=1 BUILDS=pdfjs-dist VIEWS=detail,page-4 node bench/scripts/knockout-repro.ts
PDFJS_DIST=/path/to/patched/pdfjs-dist BUILDS=pdfjs-dist VIEWS=detail,page-4 ANNOTATIONS=1 node bench/scripts/knockout-repro.ts
```

The patched copy is `bench/node_modules/pdfjs-dist` copied elsewhere with the
bundle diff at the end of this file applied. In the tables, "Render" ends
when the render task's promise resolves and "Settled" two animation frames
later; "Main-thread tasks" is Chromium's `TaskDuration` over the settled
time; `drawImage` calls and backdrop copies are counted where the page is
drawn (the main thread, or master's renderer worker); "Other copies" is the
median of the 41 copies after the first; "Copy size" is the group canvas the
copies go to.

### Chromium 156

Chromium 156.0.8078.4 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version); bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 5.9–7.1; waited 2 times (2 min in all) for other Playwright browsers and repeated 1 jobs one overlapped.

| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | on | 33.2 | 64.0 | 20.6 | main thread | 253 | 17.1 | 42 | 16.1 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | off | 15.8 | 48.6 | 17.8 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | true | 1000×600 region at 8 px/pt | on | 17.3 | 47.9 | 4.0 | main thread | 253 | 0.9 | 42 | 0.1 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5) | true | 1000×600 region at 8 px/pt | off | 16.5 | 47.7 | 2.0 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | on | 18.5 | 47.9 | 5.6 | main thread | 253 | 1.8 | 42 | 0.9 | 0.000 | 381×128 |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | off | 16.1 | 49.3 | 2.7 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | true | whole page at 2 px/pt (1440×2160) | on | 18.6 | 48.1 | 4.8 | main thread | 253 | 1.7 | 42 | 0.9 | 0.000 | 191×64 |
| 6.4.299 (d0991a0d5) | true | whole page at 2 px/pt (1440×2160) | off | 16.5 | 48.9 | 2.9 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | false | 5000×3360 region at 8 px/pt | on | 78.6 | 96.9 | 70.1 | main thread | 253 | 47.9 | 42 | 1.3 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5) | false | 5000×3360 region at 8 px/pt | off | 15.3 | 47.9 | 14.5 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | false | 1000×600 region at 8 px/pt | on | 74.4 | 98.1 | 53.4 | main thread | 253 | 48.2 | 42 | 0.2 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5) | false | 1000×600 region at 8 px/pt | off | 15.9 | 48.6 | 2.4 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | false | whole page at 4 px/pt (2880×4320) | on | 33.6 | 47.2 | 29.6 | main thread | 253 | 16.9 | 42 | 1.3 | 0.000 | 381×128 |
| 6.4.299 (d0991a0d5) | false | whole page at 4 px/pt (2880×4320) | off | 16.7 | 48.4 | 12.3 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | false | whole page at 2 px/pt (1440×2160) | on | 25.2 | 48.2 | 14.2 | main thread | 253 | 7.2 | 42 | 1.3 | 0.000 | 191×64 |
| 6.4.299 (d0991a0d5) | false | whole page at 2 px/pt (1440×2160) | off | 18.0 | 48.3 | 6.7 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | on | 35.1 | 64.5 | 21.0 | main thread | 253 | 17.4 | 42 | 16.6 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | off | 16.1 | 48.4 | 18.3 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | 1000×600 region at 8 px/pt | on | 18.0 | 48.4 | 4.0 | main thread | 253 | 0.9 | 42 | 0.0 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | true | 1000×600 region at 8 px/pt | off | 16.1 | 48.1 | 1.7 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | on | 19.0 | 47.3 | 6.0 | main thread | 253 | 2.2 | 42 | 1.1 | 0.000 | 381×128 |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | off | 16.2 | 48.1 | 3.4 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | whole page at 2 px/pt (1440×2160) | on | 18.5 | 48.2 | 4.8 | main thread | 253 | 1.7 | 42 | 0.9 | 0.000 | 191×64 |
| 6.5.0 (157d30e) | true | whole page at 2 px/pt (1440×2160) | off | 16.3 | 48.7 | 2.8 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | on | 81.8 | 97.4 | 73.3 | main thread | 253 | 49.2 | 42 | 1.3 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | off | 14.6 | 47.8 | 15.6 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | 1000×600 region at 8 px/pt | on | 73.9 | 98.2 | 53.6 | main thread | 253 | 48.3 | 42 | 0.2 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | false | 1000×600 region at 8 px/pt | off | 15.7 | 48.3 | 2.7 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | on | 33.9 | 47.3 | 29.3 | main thread | 253 | 16.8 | 42 | 1.3 | 0.000 | 381×128 |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | off | 15.6 | 47.9 | 11.6 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | whole page at 2 px/pt (1440×2160) | on | 23.6 | 47.9 | 11.9 | main thread | 253 | 5.6 | 42 | 1.0 | 0.000 | 191×64 |
| 6.5.0 (157d30e) | false | whole page at 2 px/pt (1440×2160) | off | 16.4 | 47.7 | 7.4 | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | on | 34.9 | 47.4 | 2.8 | renderer worker | 253 | 17.9 | 42 | 17.0 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | off | 34.2 | 48.2 | 2.0 | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | 1000×600 region at 8 px/pt | on | 17.2 | 47.4 | 1.2 | renderer worker | 253 | 0.8 | 42 | 0.0 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | true | 1000×600 region at 8 px/pt | off | 16.0 | 48.1 | 1.0 | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | on | 18.8 | 47.9 | 2.5 | renderer worker | 253 | 1.8 | 42 | 0.9 | 0.000 | 381×128 |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | off | 17.0 | 47.7 | 2.5 | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | whole page at 2 px/pt (1440×2160) | on | 18.6 | 47.8 | 1.1 | renderer worker | 253 | 1.6 | 42 | 0.9 | 0.000 | 191×64 |
| 6.5.0 (157d30e) | true | whole page at 2 px/pt (1440×2160) | off | 17.6 | 48.3 | 1.1 | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | on | 81.8 | 89.4 | 16.7 | renderer worker | 253 | 48.5 | 42 | 4.7 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | off | 34.8 | 48.7 | 14.8 | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | 1000×600 region at 8 px/pt | on | 64.1 | 81.3 | 2.1 | renderer worker | 253 | 45.6 | 42 | 0.1 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | false | 1000×600 region at 8 px/pt | off | 17.4 | 47.9 | 1.9 | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | on | 42.3 | 47.6 | 11.7 | renderer worker | 253 | 16.3 | 42 | 4.2 | 0.000 | 381×128 |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | off | 29.2 | 47.7 | 11.3 | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | whole page at 2 px/pt (1440×2160) | on | 24.6 | 47.6 | 4.3 | renderer worker | 253 | 5.4 | 42 | 1.6 | 0.000 | 191×64 |
| 6.5.0 (157d30e) | false | whole page at 2 px/pt (1440×2160) | off | 19.5 | 48.3 | 3.5 | renderer worker | 0 | 0.0 | 0 | – | – | – |

### Chromium 156, reading one pixel right after each render (`PROBE=1`)

Chromium 156.0.8078.4 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version); bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 7.4–7.8; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs one overlapped.

| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size | Read after render (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | on | 33.6 | 64.3 | 20.9 | main thread | 253 | 17.3 | 42 | 16.4 | 0.000 | 761×254 | 0.0 |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | off | 16.1 | 48.0 | 18.4 | main thread | 0 | 0.0 | 0 | – | – | – | 16.8 |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | on | 18.5 | 47.9 | 5.3 | main thread | 253 | 1.8 | 42 | 0.9 | 0.000 | 381×128 | 0.0 |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | off | 16.2 | 48.8 | 2.7 | main thread | 0 | 0.0 | 0 | – | – | – | 0.9 |
| 6.4.299 (d0991a0d5) | false | 5000×3360 region at 8 px/pt | on | 85.2 | 96.0 | 78.6 | main thread | 253 | 51.2 | 42 | 1.6 | 0.000 | 761×254 | 0.1 |
| 6.4.299 (d0991a0d5) | false | 5000×3360 region at 8 px/pt | off | 14.4 | 47.0 | 16.4 | main thread | 0 | 0.0 | 0 | – | – | – | 1.3 |
| 6.4.299 (d0991a0d5) | false | whole page at 4 px/pt (2880×4320) | on | 34.1 | 47.4 | 30.9 | main thread | 253 | 17.2 | 42 | 1.3 | 0.000 | 381×128 | 0.0 |
| 6.4.299 (d0991a0d5) | false | whole page at 4 px/pt (2880×4320) | off | 14.6 | 47.3 | 13.2 | main thread | 0 | 0.0 | 0 | – | – | – | 1.3 |

### Firefox 157

Firefox 157.0 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU Apple M1, or similar; bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 9.1–10.0; waited 1 times (1 min in all) for other Playwright browsers and repeated 0 jobs one overlapped.

| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | on | 69.1 | 80.4 | – | main thread | 253 | 46.3 | 42 | 0.2 | 0.080 | 761×254 |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | off | 19.1 | 48.3 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | on | 40.4 | 62.4 | – | main thread | 253 | 18.3 | 42 | 0.1 | 0.020 | 381×128 |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | off | 19.2 | 47.4 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | false | 5000×3360 region at 8 px/pt | on | 73.9 | 82.8 | – | main thread | 253 | 47.5 | 42 | 0.2 | 0.060 | 761×254 |
| 6.4.299 (d0991a0d5) | false | 5000×3360 region at 8 px/pt | off | 18.1 | 48.1 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | false | whole page at 4 px/pt (2880×4320) | on | 39.0 | 61.1 | – | main thread | 253 | 18.0 | 42 | 0.1 | 0.020 | 381×128 |
| 6.4.299 (d0991a0d5) | false | whole page at 4 px/pt (2880×4320) | off | 18.2 | 49.6 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | on | 77.1 | 95.4 | – | main thread | 253 | 50.5 | 42 | 0.3 | 0.080 | 761×254 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | off | 19.6 | 50.2 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | on | 38.7 | 62.9 | – | main thread | 253 | 17.2 | 42 | 0.1 | 0.020 | 381×128 |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | off | 18.9 | 48.1 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | on | 74.8 | 83.7 | – | main thread | 253 | 48.5 | 42 | 0.3 | 0.080 | 761×254 |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | off | 20.4 | 48.6 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | on | 39.0 | 62.6 | – | main thread | 253 | 18.3 | 42 | 0.1 | 0.020 | 381×128 |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | off | 17.6 | 48.1 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | on | 77.8 | 97.3 | – | renderer worker | 253 | 37.2 | 42 | 0.2 | 0.060 | 761×254 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | off | 41.7 | 65.5 | – | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | on | 44.5 | 64.0 | – | renderer worker | 253 | 10.4 | 42 | 0.1 | 0.020 | 381×128 |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | off | 33.9 | 64.1 | – | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | on | 77.7 | 97.6 | – | renderer worker | 253 | 38.4 | 42 | 0.2 | 0.080 | 761×254 |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | off | 36.2 | 64.0 | – | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | on | 47.8 | 65.9 | – | renderer worker | 253 | 10.4 | 42 | 0.1 | 0.020 | 381×128 |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | off | 31.6 | 48.7 | – | renderer worker | 0 | 0.0 | 0 | – | – | – |

### WebKit 27.2

WebKit 27.2 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU Apple GPU; bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 8.4–10.3; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs one overlapped.

| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | on | 15.0 | 67.6 | – | main thread | 253 | 0.5 | 42 | 0.0 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5) | true | 5000×3360 region at 8 px/pt | off | 13.6 | 40.2 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | on | 15.2 | 53.8 | – | main thread | 253 | 0.5 | 42 | 0.0 | 0.000 | 381×128 |
| 6.4.299 (d0991a0d5) | true | whole page at 4 px/pt (2880×4320) | off | 13.3 | 40.1 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | false | 5000×3360 region at 8 px/pt | on | 132.7 | 153.6 | – | main thread | 253 | 119.5 | 42 | 15.9 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5) | false | 5000×3360 region at 8 px/pt | off | 13.5 | 40.4 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.4.299 (d0991a0d5) | false | whole page at 4 px/pt (2880×4320) | on | 71.9 | 95.3 | – | main thread | 253 | 40.8 | 42 | 12.2 | 0.000 | 381×128 |
| 6.4.299 (d0991a0d5) | false | whole page at 4 px/pt (2880×4320) | off | 13.4 | 40.5 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | on | 15.2 | 67.6 | – | main thread | 253 | 0.5 | 42 | 0.0 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | off | 13.3 | 40.0 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | on | 15.2 | 53.7 | – | main thread | 253 | 0.6 | 42 | 0.0 | 0.000 | 381×128 |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | off | 13.0 | 40.6 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | on | 136.6 | 157.5 | – | main thread | 253 | 125.6 | 42 | 16.0 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | off | 13.7 | 40.4 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | on | 70.1 | 88.0 | – | main thread | 253 | 42.8 | 42 | 12.0 | 0.000 | 381×128 |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | off | 13.9 | 40.5 | – | main thread | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | on | 75.2 | 108.8 | – | renderer worker | 253 | 0.6 | 42 | 0.0 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | true | 5000×3360 region at 8 px/pt | off | 29.5 | 53.1 | – | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | on | 61.9 | 81.4 | – | renderer worker | 253 | 0.6 | 42 | 0.0 | 0.000 | 381×128 |
| 6.5.0 (157d30e) | true | whole page at 4 px/pt (2880×4320) | off | 27.6 | 40.3 | – | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | on | 130.7 | 164.5 | – | renderer worker | 253 | 101.6 | 42 | 17.1 | 0.000 | 761×254 |
| 6.5.0 (157d30e) | false | 5000×3360 region at 8 px/pt | off | 24.2 | 53.0 | – | renderer worker | 0 | 0.0 | 0 | – | – | – |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | on | 64.0 | 95.1 | – | renderer worker | 253 | 38.9 | 42 | 12.2 | 0.000 | 381×128 |
| 6.5.0 (157d30e) | false | whole page at 4 px/pt (2880×4320) | off | 18.8 | 40.6 | – | renderer worker | 0 | 0.0 | 0 | – | – | – |

### The sketch in Chromium 156 (`PDFJS_DIST` set to the patched copy)

Chromium 156.0.8078.4 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version); bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 7.3–7.3; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs one overlapped.

| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5), sketch | true | 5000×3360 region at 8 px/pt | on | 34.1 | 64.5 | 20.4 | main thread | 253 | 16.9 | 42 | 16.2 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5), sketch | true | whole page at 4 px/pt (2880×4320) | on | 19.7 | 47.6 | 5.1 | main thread | 253 | 1.7 | 42 | 0.9 | 0.000 | 381×128 |
| 6.4.299 (d0991a0d5), sketch | false | 5000×3360 region at 8 px/pt | on | 26.7 | 47.3 | 25.9 | main thread | 253 | 7.5 | 42 | 1.2 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5), sketch | false | whole page at 4 px/pt (2880×4320) | on | 21.6 | 47.6 | 19.2 | main thread | 253 | 4.1 | 42 | 1.3 | 0.000 | 381×128 |

### The sketch in Firefox 157

Firefox 157.0 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU Apple M1, or similar; bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 9.1–10.3; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs one overlapped.

| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5), sketch | true | 5000×3360 region at 8 px/pt | on | 21.3 | 46.3 | – | main thread | 253 | 1.2 | 42 | 0.0 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5), sketch | true | whole page at 4 px/pt (2880×4320) | on | 19.8 | 47.0 | – | main thread | 253 | 0.7 | 42 | 0.0 | 0.000 | 381×128 |
| 6.4.299 (d0991a0d5), sketch | false | 5000×3360 region at 8 px/pt | on | 21.0 | 47.4 | – | main thread | 253 | 1.1 | 42 | 0.0 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5), sketch | false | whole page at 4 px/pt (2880×4320) | on | 18.6 | 47.0 | – | main thread | 253 | 0.6 | 42 | 0.0 | 0.000 | 381×128 |

### The sketch in WebKit 27.2

WebKit 27.2 (headless), darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores), GPU Apple GPU; bill-hr815.pdf page 1; median of 5 renders after a warm-up; load average 7.8–8.4; waited 1 times (3 min in all) for other Playwright browsers and repeated 1 jobs one overlapped.

| Build | enableHWA | Canvas | Annotations | Render (ms) | Settled (ms) | Main-thread tasks (ms) | Drawn in | drawImage calls | drawImage (ms) | Backdrop copies | First copy (ms) | Other copies (ms each) | Copy size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.4.299 (d0991a0d5), sketch | true | 5000×3360 region at 8 px/pt | on | 14.7 | 67.2 | – | main thread | 253 | 0.5 | 42 | 0.0 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5), sketch | true | whole page at 4 px/pt (2880×4320) | on | 15.5 | 67.0 | – | main thread | 253 | 0.5 | 42 | 0.0 | 0.000 | 381×128 |
| 6.4.299 (d0991a0d5), sketch | false | 5000×3360 region at 8 px/pt | on | 92.8 | 117.1 | – | main thread | 253 | 58.1 | 42 | 17.3 | 0.000 | 761×254 |
| 6.4.299 (d0991a0d5), sketch | false | whole page at 4 px/pt (2880×4320) | on | 61.7 | 81.1 | – | main thread | 253 | 28.1 | 42 | 12.7 | 0.000 | 381×128 |

### Pixel comparison

The signature area rendered by the original build and by the sketch, compared byte by byte: 820×330 device pixels from the 5000×3360 region at 8 px/pt ("detail"), and 410×165 and 205×83 from the whole page at 4 and 2 px/pt. pdfjs-dist 6.4.299 on the main thread:

```text
Chromium 156.0.8078.4 hwa=1 detail: 270600 pixels compared, 13562 inked, 0 differ, max channel difference 0
Chromium 156.0.8078.4 hwa=1 page-4: 67650 pixels compared, 3866 inked, 0 differ, max channel difference 0
Chromium 156.0.8078.4 hwa=1 page-2: 17015 pixels compared, 1179 inked, 0 differ, max channel difference 0
Chromium 156.0.8078.4 hwa=0 detail: 270600 pixels compared, 13309 inked, 0 differ, max channel difference 0
Chromium 156.0.8078.4 hwa=0 page-4: 67650 pixels compared, 3791 inked, 0 differ, max channel difference 0
Chromium 156.0.8078.4 hwa=0 page-2: 17015 pixels compared, 1098 inked, 0 differ, max channel difference 0
Firefox 157.0 hwa=1 detail: 270600 pixels compared, 13379 inked, 0 differ, max channel difference 0
Firefox 157.0 hwa=1 page-4: 67650 pixels compared, 3798 inked, 0 differ, max channel difference 0
Firefox 157.0 hwa=1 page-2: 17015 pixels compared, 1097 inked, 0 differ, max channel difference 0
Firefox 157.0 hwa=0 detail: 270600 pixels compared, 13379 inked, 0 differ, max channel difference 0
Firefox 157.0 hwa=0 page-4: 67650 pixels compared, 3798 inked, 0 differ, max channel difference 0
Firefox 157.0 hwa=0 page-2: 17015 pixels compared, 1097 inked, 0 differ, max channel difference 0
WebKit 27.2 hwa=1 detail: 270600 pixels compared, 13323 inked, 0 differ, max channel difference 0
WebKit 27.2 hwa=1 page-4: 67650 pixels compared, 3742 inked, 0 differ, max channel difference 0
WebKit 27.2 hwa=1 page-2: 17015 pixels compared, 1108 inked, 0 differ, max channel difference 0
WebKit 27.2 hwa=0 detail: 270600 pixels compared, 13299 inked, 0 differ, max channel difference 0
WebKit 27.2 hwa=0 page-4: 67650 pixels compared, 3726 inked, 0 differ, max channel difference 0
WebKit 27.2 hwa=0 page-2: 17015 pixels compared, 1104 inked, 0 differ, max channel difference 0
```

Master at 157d30e, on the main thread and in its renderer worker: all 36 comparisons (three browsers, two `enableHWA` settings, three scales, two drawing threads) give `0 differ, max channel difference 0`, for example:

```text
Chromium 156.0.8078.4 hwa=1 detail: 270600 pixels compared, 13562 inked, 0 differ, max channel difference 0
WebKit 27.2 hwa=0 detail (renderer worker): 270600 pixels compared, 13299 inked, 0 differ, max channel difference 0
```

### Per-call breakdown in Chromium, 5000×3360 at 8 px/pt

Medians over the five renders, from the per-size histogram in `knockout-chromium.json`:

| `enableHWA` | Group-sized to group-sized (210 calls) | Page canvas to backdrop canvas (42 copies) | Group to page (1 call) |
| --- | --- | --- | --- |
| true | 0.86 ms | 16.2 ms: the first copy 16.0–17.9 ms, the others at most 0.005 ms | 0.0 ms |
| false | 44.3 ms, one call up to 11.8 ms | 1.3 ms | 1.6 ms |

### Firefox's slow backdrop copy

A copy of the page that counts animation frame callbacks (pdf.js continues each 15 ms chunk of a render in one) shows the chunk each backdrop copy runs in. `enableHWA: false`, three renders in one page, the first of them a warm-up; "slow" means over 0.5 ms:

```text
Firefox 157.0 scale 8 run 0: slow copies #0 1.98 ms (frame 7); chunk changes #19→frame 8, #40→frame 9; first copy in frame 7
Firefox 157.0 scale 8 run 1: slow copies #19 11.32 ms (frame 2); chunk changes #19→frame 2, #30→frame 3; first copy in frame 1
Firefox 157.0 scale 8 run 2: slow copies #19 8.9 ms (frame 2); chunk changes #19→frame 2, #30→frame 3; first copy in frame 1
Firefox 157.0 scale 4 run 0: slow copies #8 11.9 ms (frame 4); chunk changes #8→frame 4, #19→frame 5; first copy in frame 3
Firefox 157.0 scale 4 run 1: slow copies #30 6.44 ms (frame 2); chunk changes #30→frame 2; first copy in frame 1
Firefox 157.0 scale 4 run 2: slow copies #40 9.04 ms (frame 2); chunk changes #40→frame 2; first copy in frame 1
```

Chromium, for comparison:

```text
Chromium 156.0.8078.4 scale 8 run 0: slow copies #0 16.26 ms (frame 2); chunk changes #8→frame 3, #30→frame 4; first copy in frame 2
Chromium 156.0.8078.4 scale 8 run 1: slow copies #0 2.75 ms (frame 1); chunk changes #19→frame 2, #40→frame 3; first copy in frame 1
Chromium 156.0.8078.4 scale 8 run 2: slow copies #0 1.92 ms (frame 1); chunk changes #19→frame 2, #40→frame 3; first copy in frame 1
Chromium 156.0.8078.4 scale 4 run 0: slow copies #0 15.665 ms (frame 2); chunk changes #8→frame 3; first copy in frame 2
Chromium 156.0.8078.4 scale 4 run 1: slow copies #0 1.505 ms (frame 1); chunk changes none; first copy in frame 1
Chromium 156.0.8078.4 scale 4 run 2: slow copies #0 1.345 ms (frame 1); chunk changes none; first copy in frame 1
```

### `drawImage` cost by source canvas size

Draws a 30×22 rectangle from a canvas into a 32×24 canvas right after changing two pixels of the source, 60 times; median of the last 50:

```text
Chromium 156.0.8078.4
  willReadFrequently true, source 32×24: 0.000 ms
  willReadFrequently true, source 761×254: 0.070 ms
  willReadFrequently true, source 5000×3360: 0.000 ms
  willReadFrequently false, source 32×24: 0.005 ms
  willReadFrequently false, source 761×254: 0.005 ms
  willReadFrequently false, source 5000×3360: 0.005 ms
WebKit 27.2
  willReadFrequently true, source 32×24: 0.040 ms
  willReadFrequently true, source 761×254: 0.180 ms
  willReadFrequently true, source 5000×3360: 11.280 ms
  willReadFrequently false, source 32×24: 0.000 ms
  willReadFrequently false, source 761×254: 0.000 ms
  willReadFrequently false, source 5000×3360: 0.000 ms
Firefox 157.0
  willReadFrequently true, source 32×24: 0.000 ms
  willReadFrequently true, source 761×254: 0.000 ms
  willReadFrequently true, source 5000×3360: 0.000 ms
  willReadFrequently false, source 32×24: 0.000 ms
  willReadFrequently false, source 761×254: 0.000 ms
  willReadFrequently false, source 5000×3360: 0.000 ms
```

### Numerical check of the backdrop passes

One pixel through pdf.js's per-element compositing in premultiplied RGBA: `destination-out` by the element's coverage; with the backdrop passes, the backdrop `destination-in` the coverage drawn `destination-over`; then the element `source-over`; finally the group `source-over` onto the backdrop at a group alpha. 200,000 random cases of one to four elements with random coverage, alpha, and color, and a random group alpha, with and without the backdrop passes:

```text
max difference, opaque backdrop: 4.44e-16 | translucent backdrop: 0.249
```

### Bundle diff used for the measurements

Applied to a copy of pdfjs-dist 6.4.299 (`patch -p1 -d <copy> < bundle.diff`); the same edit, made by
the same replacements, was applied to master's `build/pdf.mjs` and `build/pdf.renderer.mjs` for the
pixel comparison on master.

<details>
<summary>bundle.diff</summary>

```diff
--- a/build/pdf.mjs
+++ b/build/pdf.mjs
@@ -11488,11 +11488,12 @@
     this.smaskScratchCanvas = null;
     this._clearPreparedSMask();
   }
-  #createKnockoutMaskCanvas(sourceCanvas, reuseEntry = null, alpha = 1) {
+  #createKnockoutMaskCanvas(sourceCanvas, reuseEntry = null, alpha = 1, rect = null) {
     const {
       width,
       height
     } = sourceCanvas;
+    const [rx, ry, rw, rh] = rect ?? [0, 0, width, height];
     const maskEntry = reuseEntry ?? this.canvasFactory.create(width, height);
     const maskCtx = maskEntry.context;
     alpha = Math.round(alpha * 255) / 255;
@@ -11508,11 +11509,11 @@
       if (reuseEntry) {
         maskCtx.save();
         maskCtx.setTransform(1, 0, 0, 1, 0, 0);
-        maskCtx.clearRect(0, 0, width, height);
+        maskCtx.clearRect(rx, ry, rw, rh);
         maskCtx.restore();
       }
       maskCtx.filter = knockoutFilter;
-      maskCtx.drawImage(sourceCanvas, 0, 0);
+      maskCtx.drawImage(sourceCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
       maskCtx.filter = "none";
       return maskEntry;
     }
@@ -11529,7 +11530,7 @@
     maskCtx.putImageData(maskData, 0, 0);
     return maskEntry;
   }
-  #getOrCreatePooledEntry(meta, key, width, height) {
+  #getOrCreatePooledEntry(meta, key, width, height, clearRect = null) {
     let entry = meta?.[key] ?? null;
     if (entry && (entry.canvas.width !== width || entry.canvas.height !== height)) {
       this.canvasFactory.destroy(entry);
@@ -11545,7 +11546,11 @@
     const ctx = entry.context;
     ctx.save();
     ctx.setTransform(1, 0, 0, 1, 0, 0);
-    ctx.clearRect(0, 0, width, height);
+    if (clearRect) {
+      ctx.clearRect(...clearRect);
+    } else {
+      ctx.clearRect(0, 0, width, height);
+    }
     ctx.restore();
     return entry;
   }
@@ -11558,13 +11563,18 @@
       poolMeta = null,
       sourceAlpha = 1,
       sourceFilter = "none",
-      knockoutAlpha = 1
+      knockoutAlpha = 1,
+      rect = null
     } = options;
     const {
       width,
       height
     } = surfaceCanvas;
-    const knockoutMaskEntry = this.#createKnockoutMaskCanvas(surfaceCanvas, reuseMaskEntry, knockoutAlpha);
+    const [rx, ry, rw, rh] = rect ?? [0, 0, width, height];
+    if (rw <= 0 || rh <= 0) {
+      return;
+    }
+    const knockoutMaskEntry = this.#createKnockoutMaskCanvas(surfaceCanvas, reuseMaskEntry, knockoutAlpha, rect);
     const sourceCompositeOperation = destCtx.globalCompositeOperation;
     destCtx.save();
     destCtx.setTransform(...destTransform);
@@ -11573,17 +11583,22 @@
       destCtx.filter = "none";
     }
     destCtx.globalCompositeOperation = "destination-out";
-    destCtx.drawImage(knockoutMaskEntry.canvas, 0, 0);
+    destCtx.drawImage(knockoutMaskEntry.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
     if (backdropCanvas) {
       const [bx, by] = backdropOffset;
-      const backdropEntry = this.#getOrCreatePooledEntry(poolMeta, "knockoutBackdropEntry", width, height);
+      const backdropEntry = this.#getOrCreatePooledEntry(poolMeta, "knockoutBackdropEntry", width, height, rect);
       const backdropCtx = backdropEntry.context;
-      backdropCtx.drawImage(backdropCanvas, bx, by, width, height, 0, 0, width, height);
+      backdropCtx.drawImage(backdropCanvas, bx + rx, by + ry, rw, rh, rx, ry, rw, rh);
+      backdropCtx.save();
+      backdropCtx.beginPath();
+      backdropCtx.rect(rx, ry, rw, rh);
+      backdropCtx.clip();
       backdropCtx.globalCompositeOperation = "destination-in";
-      backdropCtx.drawImage(knockoutMaskEntry.canvas, 0, 0);
+      backdropCtx.drawImage(knockoutMaskEntry.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
+      backdropCtx.restore();
       backdropCtx.globalCompositeOperation = "source-over";
       destCtx.globalCompositeOperation = "destination-over";
-      destCtx.drawImage(backdropEntry.canvas, 0, 0);
+      destCtx.drawImage(backdropEntry.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
       if (!poolMeta) {
         this.canvasFactory.destroy(backdropEntry);
       }
@@ -11593,7 +11608,7 @@
     if (FeatureTest.isCanvasFilterSupported) {
       destCtx.filter = sourceFilter ?? "none";
     }
-    destCtx.drawImage(surfaceCanvas, 0, 0);
+    destCtx.drawImage(surfaceCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
     destCtx.restore();
     if (!reuseMaskEntry) {
       this.canvasFactory.destroy(knockoutMaskEntry);
@@ -11609,7 +11624,10 @@
     const {
       canvas
     } = this.ctx;
-    const tempEntry = this.#getOrCreatePooledEntry(groupMeta, "knockoutTempEntry", canvas.width, canvas.height);
+    const tempEntry = this.#getOrCreatePooledEntry(groupMeta, "knockoutTempEntry", canvas.width, canvas.height, groupMeta?.knockoutTempDirty ?? null);
+    if (groupMeta) {
+      groupMeta.knockoutTempDirty = null;
+    }
     this.#knockoutTempCanvasEntry = tempEntry;
     const tempCtx = tempEntry.context;
     tempCtx.save();
@@ -11627,11 +11645,23 @@
     }
     return true;
   }
-  #endKnockoutElement(started) {
+  #endKnockoutElement(started, bbox = null) {
     if (!started) {
       return;
     }
     const tempEntry = this.#knockoutTempCanvasEntry;
+    let rect = null;
+    if (bbox) {
+      const {
+        width,
+        height
+      } = tempEntry.canvas;
+      const x0 = Math.max(0, Math.floor(bbox[0]) - 1);
+      const y0 = Math.max(0, Math.floor(bbox[1]) - 1);
+      const x1 = Math.min(width, Math.ceil(bbox[2]) + 1);
+      const y1 = Math.min(height, Math.ceil(bbox[3]) + 1);
+      rect = [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
+    }
     const savedCtx = this.#knockoutSavedCtx;
     const savedSMaskCtx = this.#knockoutSavedSMaskCtx;
     const tempCtx = tempEntry.context;
@@ -11659,9 +11689,13 @@
         backdropOffset: groupMeta?.backdropCtx ? [groupMeta.offsetX, groupMeta.offsetY] : [0, 0],
         reuseMaskEntry: groupMeta?.knockoutMaskEntry ?? null,
         poolMeta: groupMeta,
-        knockoutAlpha
+        knockoutAlpha,
+        rect
       });
     } finally {
+      if (groupMeta) {
+        groupMeta.knockoutTempDirty = rect;
+      }
       tempCtx.restore();
       this.#knockoutElementDepth--;
       if (!groupMeta) {
@@ -11918,7 +11952,7 @@
     if (consumePath) {
       this.consumePath(opIdx, path, intersect);
     }
-    this.#endKnockoutElement(started);
+    this.#endKnockoutElement(started, isPatternFill ? null : intersect ?? [0, 0, 0, 0]);
   }
   eoFill(opIdx, path) {
     this.pendingEOFill = true;
```

</details>
