import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_FACTOR,
  type Budgets,
  baseScale,
  canvasPixels,
  capScale,
  DEFAULT_BUDGETS,
  demotes,
  detailBudget,
  detailPlan,
  failed,
  keepsDetail,
  layerPixels,
  needsDetail,
  type PageState,
  type PlanContext,
  type PlannedDrawing,
  pagePixels,
  pageSharpness,
  plan,
  REDUCED_DETAIL_STEP,
  sameScale,
  shouldRedrawRegion,
  snapRegion,
  staleDetail,
  started,
  trim,
  type ViewInput,
} from "../src/render/planner.ts";
import {
  computeLayout,
  type PageArea,
  turnedSize,
  visibleArea,
  visibleRange,
} from "../src/view/layout.ts";

const LETTER = { width: 612, height: 792 };
const LANDSCAPE = { width: 842, height: 595 };
const TALL = { width: 400, height: 2400 };

/** A view of `sizes` at `scale`, scrolled to `top`, with the pages it mounts. */
function view(
  sizes: { width: number; height: number }[],
  scale: number,
  options: {
    top?: number;
    devicePixelRatio?: number;
    settled?: boolean;
    width?: number;
    rotation?: 0 | 90 | 180 | 270;
  } = {},
): { input: ViewInput; mounted: number[] } {
  const layout = computeLayout(sizes, scale, { gap: 10, rotation: options.rotation ?? 0 });
  const width = options.width ?? 800;
  const viewport = {
    left: 0,
    top: options.top ?? 0,
    width,
    height: 900,
    scrollerWidth: width,
    scrollerHeight: 900,
  };
  const { first, last } = visibleRange(layout, viewport);
  const mounted: number[] = [];
  for (let index = Math.max(0, first - 2); index <= Math.min(sizes.length - 1, last + 2); index++) {
    mounted.push(index);
  }
  return {
    input: {
      layout,
      first,
      last,
      focus: first,
      viewport,
      devicePixelRatio: options.devicePixelRatio ?? 1,
      settled: options.settled ?? true,
    },
    mounted,
  };
}

type Page = { -readonly [K in keyof PageState]: PageState[K] };

function blank(index: number): Page {
  return {
    index,
    baseScale: 0,
    detailScale: 0,
    baseVersion: 0,
    detailVersion: 0,
    detailRegion: null,
    failures: {},
    job: undefined,
    hasSpare: true,
    basePixels: 0,
    detailPixels: 0,
    sparePixels: 0,
  };
}

const context = (input: ViewInput, budgets: Partial<Budgets> = {}, version = 0): PlanContext => ({
  input,
  budgets: { ...DEFAULT_BUDGETS, ...budgets },
  version,
});

const visible = ({ input }: PlanContext, index: number) =>
  index >= input.first && index <= input.last;

const showsCurrentWholeDetail = (context: PlanContext, page: PageState) =>
  page.detailScale > 0 &&
  page.detailRegion === null &&
  page.detailVersion === context.version &&
  sameScale(page.detailScale, context.input.layout.scale * context.input.devicePixelRatio);

/** Pixels of the canvas a drawing sizes, in whole pixels as drawPage() sizes it. */
function canvasSize({ input }: PlanContext, drawing: PlannedDrawing): number {
  if (drawing.pixels) return drawing.pixels.width * drawing.pixels.height;
  const size = input.layout.sizes[drawing.index] ?? { width: 0, height: 0 };
  return (
    Math.floor(size.width * drawing.scale + 1e-6) * Math.floor(size.height * drawing.scale + 1e-6)
  );
}

/**
 * Carries out plans as the renderer does, every drawing completing at once,
 * until there is nothing left to do; checks what must hold at every step.
 */
function run(context: PlanContext, pages: Map<number, Page>, concurrent = 2) {
  const drawn: { index: number; layer: "base" | "detail" }[] = [];
  for (let round = 0; round < 200; round++) {
    for (const page of pages.values()) {
      const { cancel, clear } = staleDetail(context, page);
      if (cancel) page.job = undefined;
      if (clear) {
        page.detailScale = 0;
        page.detailRegion = null;
        page.detailPixels = 0;
        page.sparePixels = 0;
      }
    }
    for (const { index, layer } of trim(context, pages.values())) {
      assert.ok(!visible(context, index), `page ${index + 1} is visible and keeps its pixels`);
      const page = pages.get(index) as Page;
      if (page.job?.layer === layer) page.job = undefined;
      if (layer === "base") {
        page.baseScale = 0;
        page.basePixels = 0;
      } else {
        page.detailScale = 0;
        page.detailRegion = null;
        page.detailPixels = 0;
        page.sparePixels = 0;
      }
    }
    const drawings = plan(context, pages.values(), concurrent);
    if (drawings.length === 0) return drawn;
    const blankVisible = [...pages.values()].some(
      (page) => visible(context, page.index) && page.baseScale === 0 && page.detailScale === 0,
    );
    if (blankVisible) {
      assert.ok(
        visible(context, drawings[0]?.index ?? -1),
        "a visible page waiting for pixels comes first",
      );
    }
    // What the plan starts, giving back pixels at once, would start and stop forever.
    const running = new Map(pages);
    for (const drawing of drawings) {
      running.set(drawing.index, started(running.get(drawing.index) as Page, drawing));
    }
    for (const { index, layer } of trim(context, running.values())) {
      assert.ok(
        !drawings.some((drawing) => drawing.index === index && drawing.layer === layer),
        `page ${index + 1}'s ${layer}, just started, is given back`,
      );
    }
    for (const drawing of drawings) {
      const page = pages.get(drawing.index) as Page;
      if (drawing.layer === "base") {
        // Except one that gives back the pixels of a base drawn at a larger zoom.
        assert.ok(
          !showsCurrentWholeDetail(context, page) || page.baseScale > drawing.scale * 2,
          `no base under page ${drawing.index + 1}'s whole-page detail`,
        );
      }
      drawn.push({ index: drawing.index, layer: drawing.layer });
      const pixels = canvasSize(context, drawing);
      if (drawing.layer === "base") {
        page.baseScale = drawing.scale;
        page.baseVersion = context.version;
        page.basePixels = pixels;
      } else {
        // Drawn into the spare, the new detail takes the shown one's place.
        page.detailPixels = pixels;
        page.sparePixels = 0;
        page.detailScale = drawing.scale;
        page.detailVersion = context.version;
        page.detailRegion = drawing.region;
      }
    }
  }
  assert.fail("the plan never settles");
}

/** A small deterministic generator, so that failures reproduce. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe("planner invariants", () => {
  const next = random(7);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
  for (let scenario = 0; scenario < 300; scenario++) {
    const sizes = Array.from({ length: 12 }, () => pick([LETTER, LETTER, LANDSCAPE, TALL]));
    const scale = pick([0.25, 0.5, 1, 1.5, 2, 4, 8]);
    const devicePixelRatio = pick([1, 2, 3]);
    const budgets: Partial<Budgets> = {
      maxCanvasPixels: pick([Number.POSITIVE_INFINITY, 33_554_432, 8_000_000, 2_000_000, 300_000]),
      maxDetailPixels: pick([16_777_216, 4_000_000, 1_000_000]),
      maxBasePixels: pick([2_097_152, 500_000]),
    };
    const settled = next() < 0.7;
    const layoutHeight = computeLayout(sizes, scale, { gap: 10 }).totalHeight;
    const top = Math.floor(next() * Math.max(0, layoutHeight - 900));
    const { input, mounted } = view(sizes, scale, { top, devicePixelRatio, settled });
    const name = `scale ${scale}, dpr ${devicePixelRatio}, ${JSON.stringify(budgets)}, top ${top}${settled ? "" : ", scrolling"}`;

    it(`keeps its invariants: ${name}`, () => {
      const plan = context(input, budgets);
      const pages = new Map(mounted.map((index) => [index, blank(index)]));
      run(plan, pages);
      checkSettled(plan, pages, budgets);
    });
  }

  // Pages zoomed with what they show from the zoom before: stale bases and
  // details, and pages that mount blank.
  const zoomNext = random(11);
  const zoomPick = <T>(values: readonly T[]): T =>
    values[Math.floor(zoomNext() * values.length)] as T;
  for (let scenario = 0; scenario < 120; scenario++) {
    const sizes = Array.from({ length: 12 }, () => zoomPick([LETTER, LANDSCAPE, TALL]));
    const from = zoomPick([0.5, 1, 1.5, 2, 4]);
    const to = zoomPick([0.25, 0.5, 1, 2.5, 4, 8]);
    const devicePixelRatio = zoomPick([1, 2, 3]);
    const budgets: Partial<Budgets> = {
      maxCanvasPixels: zoomPick([Number.POSITIVE_INFINITY, 33_554_432, 8_000_000, 2_000_000]),
      maxDetailPixels: zoomPick([16_777_216, 4_000_000]),
      maxBasePixels: zoomPick([2_097_152, 500_000]),
    };
    const layoutHeight = computeLayout(sizes, from, { gap: 10 }).totalHeight;
    const top = Math.floor(zoomNext() * Math.max(0, layoutHeight - 900));
    const name = `${from} to ${to}, dpr ${devicePixelRatio}, ${JSON.stringify(budgets)}, top ${top}`;

    it(`keeps its invariants through a zoom: ${name}`, () => {
      let plan = context(view(sizes, from).input);
      let pages = new Map<number, Page>();
      // Scrolled to with bases, settled, then zoomed with what the pages show.
      for (const [scale, settled] of [
        [from, false],
        [from, true],
        [to, true],
      ] as const) {
        const { input, mounted } = view(sizes, scale, {
          top: Math.floor((top * scale) / from),
          devicePixelRatio,
          settled,
        });
        plan = context(input, budgets);
        pages = new Map(mounted.map((index) => [index, pages.get(index) ?? blank(index)]));
        run(plan, pages);
      }
      checkSettled(plan, pages, budgets, true);
    });
  }
});

/** What must hold once `pages` settle under `plan`. */
function checkSettled(
  plan: PlanContext,
  pages: Map<number, Page>,
  budgets: Partial<Budgets>,
  zoomed = false,
) {
  const visibleBases = [...pages.values()]
    .filter((page) => visible(plan, page.index))
    .reduce((sum, page) => sum + page.basePixels, 0);
  for (const page of pages.values()) {
    if (visible(plan, page.index)) {
      assert.ok(page.baseScale > 0 || page.detailScale > 0, `page ${page.index + 1} is blank`);
    }
    // Whole pages within maxDetailPixels; regions within it, give or take
    // the pixel snapping adds on each side.
    assert.ok(
      page.detailPixels <= (budgets.maxDetailPixels ?? 0) * 1.01 + 10_000,
      `page ${page.index + 1}'s detail holds ${page.detailPixels}`,
    );
    assert.ok(
      page.basePixels <= (budgets.maxBasePixels ?? 0) * 1.0001,
      `page ${page.index + 1}'s base holds ${page.basePixels}`,
    );
  }
  const total = canvasPixels(plan, pages.values());
  // Zoomed, visible pages keep bases drawn at up to twice or half the scale
  // their details' shares count them at: the budget holds except for them.
  const limit = zoomed
    ? (budgets.maxCanvasPixels ?? 0) + visibleBases
    : Math.max(budgets.maxCanvasPixels ?? 0, visibleBases);
  assert.ok(
    total <= limit * 1.01 + 10_000,
    `${total} pixels over a budget of ${budgets.maxCanvasPixels}, visible bases ${visibleBases}`,
  );
}

describe("planner", () => {
  it("draws whole-page detail without a base for pages outside the viewport once scrolling settles", () => {
    const { input, mounted } = view(Array(8).fill(LETTER), 1, { devicePixelRatio: 2 });
    const plan = context(input);
    const pages = new Map(mounted.map((index) => [index, blank(index)]));
    const drawn = run(plan, pages);
    for (const { index, layer } of drawn) {
      if (!visible(plan, index)) assert.equal(layer, "detail", `page ${index + 1}`);
    }
  });

  it("draws a quick detail without a base for visible pages within four bases' worth", () => {
    const { input } = view([LETTER], 1, { devicePixelRatio: 2 });
    const [first] = plan(context(input), [blank(0)], 1);
    assert.equal(first?.layer, "detail");
    assert.equal(first?.region, null);
    // Scrolling, the page gets its base first.
    const [scrolling] = plan(context({ ...input, settled: false }), [blank(0)], 1);
    assert.equal(scrolling?.layer, "base");
    assert.equal(scrolling?.scale, BASE_FACTOR);
    // Past four bases' worth (8.4 MP), too.
    const large = view([LETTER], 2.5, { devicePixelRatio: 2 }).input;
    assert.equal(plan(context(large), [blank(0)], 1)[0]?.layer, "base");
  });

  it("caps a base at maxBasePixels", () => {
    const { input } = view([LETTER], 8, { settled: false });
    const [base] = plan(context(input), [blank(0)], 1);
    assert.equal(base?.layer, "base");
    assert.ok(Math.abs(pagePixels(input, 0, base?.scale ?? 0, null) - 2_097_152) < 1);
  });

  it("draws the next detail into the spare while the old one shows, with no base under it", () => {
    const page = blank(0);
    Object.assign(page, {
      detailScale: 2,
      detailPixels: 612 * 2 * 792 * 2,
      baseScale: 0,
    });
    // Zoomed in: the old detail stays, scaled by CSS, until the new one is in.
    const zoomed = view([LETTER], 1.2, { devicePixelRatio: 2 }).input;
    const drawings = plan(context(zoomed), [page], 2);
    assert.equal(drawings.length, 1);
    assert.equal(drawings[0]?.layer, "detail");
    assert.equal(drawings[0]?.intoSpare, true);
    // Without room for both within maxCanvasPixels, it is drawn in place,
    // over a base drawn first: a page runs one drawing at a time.
    const tight = context(zoomed, { maxCanvasPixels: 3_000_000 });
    const [base] = plan(tight, [page], 2);
    assert.equal(base?.layer, "base");
    page.baseScale = base?.scale ?? 0;
    page.basePixels = pagePixels(zoomed, 0, page.baseScale, null);
    const [detail] = plan(tight, [page], 2);
    assert.equal(detail?.layer, "detail");
    assert.equal(detail?.intoSpare, false);
  });

  it("draws no base under a whole-page detail no larger than a base that gives way to part of the page", () => {
    const page = blank(0);
    Object.assign(page, { detailScale: 1, detailPixels: 612 * 792 });
    // Zoomed past the detail budget: the visible page gets part of it.
    const zoomed = context(view([LETTER], 2).input, { maxDetailPixels: 1_000_000 });
    assert.equal(demotes(zoomed, page), true);
    const [detail] = plan(zoomed, [page], 1);
    assert.equal(detail?.layer, "detail");
    assert.equal(detail?.intoSpare, true);
    assert.ok(detail?.region);
    // A larger one, as on a desktop-sized viewport, gets a base first (decision 0008).
    const small = { ...zoomed, budgets: { ...zoomed.budgets, maxBasePixels: 400_000 } };
    assert.equal(demotes(small, page), false);
    assert.equal(plan(small, [page], 1)[0]?.layer, "base");
    // So does a detail of an older content version.
    assert.equal(demotes({ ...zoomed, version: 1 }, page), false);
  });

  it("plans the same for pages that count their pixels with getters, as the renderer's do", () => {
    class Slot implements PageState {
      readonly index: number;
      baseScale = 0.5;
      detailScale = 1;
      baseVersion = 0;
      detailVersion = 0;
      detailRegion = null;
      failures = {};
      job = undefined;
      hasSpare = true;
      sparePixels = 0;
      constructor(index: number) {
        this.index = index;
      }
      get basePixels() {
        return 306 * 396;
      }
      get detailPixels() {
        return 612 * 792;
      }
    }
    const plain = (index: number): Page => ({
      ...blank(index),
      baseScale: 0.5,
      detailScale: 1,
      basePixels: 306 * 396,
      detailPixels: 612 * 792,
    });
    // Two visible pages zoomed from 0.5 to 1 at devicePixelRatio 2.
    const { input } = view([LETTER, LETTER], 1, { devicePixelRatio: 2, width: 1400 });
    input.viewport = { ...input.viewport, height: 3000, scrollerHeight: 3000 };
    const zoomed = { ...input, first: 0, last: 1 };
    const fromSlots = plan(context(zoomed), [new Slot(0), new Slot(1)], 2);
    const fromObjects = plan(context(zoomed), [plain(0), plain(1)], 2);
    assert.equal(fromSlots.length, 2);
    assert.deepEqual(fromSlots, fromObjects);
    assert.ok(
      fromSlots.every((drawing) => drawing.intoSpare),
      "both into their spares",
    );
  });

  it("draws the visible area grown within the budget when the whole page is over it", () => {
    const { input } = view([LETTER], 4, { top: 1000 });
    const planned = detailPlan(context(input, { maxDetailPixels: 4_000_000 }), 0);
    const region = planned?.region as PageArea;
    assert.ok(region, "a region");
    const visibleNow = visibleArea(input.layout, 0, input.viewport) as PageArea;
    assert.ok(region.minY < visibleNow.minY && region.maxY > visibleNow.maxY, "grown around it");
    assert.equal(planned?.scale, 4, "at full resolution");
    const pixels = pagePixels(input, 0, planned?.scale ?? 0, region);
    assert.ok(pixels <= 4_000_000 * 1.0001, `${pixels}`);
  });

  it("lowers resolution in quarter-octave steps when the visible area does not fit", () => {
    const { input } = view([LETTER], 4, { top: 1000, devicePixelRatio: 2 });
    const planned = detailPlan(context(input, { maxDetailPixels: 1_000_000 }), 0);
    const steps = Math.log((planned?.scale ?? 0) / 8) / Math.log(REDUCED_DETAIL_STEP);
    assert.ok(steps > 0 && Math.abs(steps - Math.round(steps)) < 1e-9, `${steps} steps`);
    assert.ok(planned?.region);
    // A detail no sharper than the base is not drawn.
    assert.equal(detailPlan(context(input, { maxDetailPixels: 10_000 }), 0), null);
  });

  it("gives visible pages' details what their bases leave of maxCanvasPixels, by visible area", () => {
    const { input, mounted } = view(Array(4).fill(LETTER), 1, { devicePixelRatio: 2 });
    const plan = context(input, { maxCanvasPixels: 2_500_000 });
    const pages = new Map(mounted.map((index) => [index, blank(index)]));
    run(plan, pages);
    const visibleDetails = [...pages.values()]
      .filter((page) => visible(plan, page.index))
      .reduce((sum, page) => sum + page.detailPixels + page.basePixels, 0);
    assert.ok(visibleDetails <= 2_500_000 * 1.01, `${visibleDetails}`);
    for (const page of pages.values()) {
      if (!visible(plan, page.index)) assert.equal(page.basePixels + page.detailPixels, 0);
    }
  });

  it("gives back the pixels of pages outside the viewport, farthest first and detail before base", () => {
    const { input } = view(Array(8).fill(LETTER), 1, { top: 2400 });
    const pages = [1, 2, 3, 4, 5].map((index) => {
      const page = blank(index);
      Object.assign(page, {
        baseScale: 0.5,
        basePixels: 121_176,
        detailScale: 1,
        detailPixels: 484_704,
      });
      return page;
    });
    const plan = context(input, { maxCanvasPixels: 2_500_000 });
    const released = trim(plan, pages);
    assert.ok(released.length > 0);
    assert.ok(released.every(({ index }) => !visible(plan, index)));
    const firstBase = released.findIndex(({ layer }) => layer === "base");
    if (firstBase >= 0) {
      assert.ok(released.slice(firstBase).every(({ layer }) => layer === "base"));
    }
    const distances = released
      .filter(({ layer }) => layer === "detail")
      .map(({ index }) => Math.abs(index - input.focus));
    assert.deepEqual(
      distances,
      [...distances].sort((a, b) => b - a),
    );
  });

  it("cancels a detail drawing for a page that scrolls in blank during a fling", () => {
    const { input } = view([LETTER], 1, { settled: false });
    const page = blank(0);
    page.job = { layer: "detail", scale: 1, region: null, intoSpare: false };
    assert.deepEqual(staleDetail(context(input), page), { cancel: true, clear: false });
    assert.deepEqual(staleDetail(context({ ...input, settled: true }), page), {
      cancel: false,
      clear: false,
    });
  });

  it("redraws a region once the visible area leaves it or its margins get lopsided", () => {
    const region = { minX: 0, minY: 0.2, maxX: 1, maxY: 0.8 };
    assert.equal(shouldRedrawRegion(region, { minX: 0, minY: 0.4, maxX: 1, maxY: 0.6 }), false);
    assert.equal(shouldRedrawRegion(region, { minX: 0, minY: 0.1, maxX: 1, maxY: 0.3 }), true);
    assert.equal(shouldRedrawRegion(region, { minX: 0, minY: 0.65, maxX: 1, maxY: 0.75 }), true);
    // Margins of a pixel or so never count.
    assert.equal(
      shouldRedrawRegion(region, { minX: 0, minY: 0.2005, maxX: 1, maxY: 0.799 }),
      false,
    );
  });
});

describe("planner boundaries", () => {
  const area = (region: PageArea) => (region.maxX - region.minX) * (region.maxY - region.minY);
  const contains = (outer: PageArea, inner: PageArea) =>
    outer.minX <= inner.minX + 1e-9 &&
    outer.minY <= inner.minY + 1e-9 &&
    outer.maxX >= inner.maxX - 1e-9 &&
    outer.maxY >= inner.maxY - 1e-9;

  it("draws bases at half a device pixel per CSS pixel whatever the devicePixelRatio", () => {
    for (const devicePixelRatio of [1, 1.5, 2, 3]) {
      const { input } = view([LETTER], 1.3, { devicePixelRatio });
      assert.equal(baseScale(context(input), 0), 1.3 * BASE_FACTOR);
      assert.equal(detailPlan(context(input), 0)?.scale, 1.3 * devicePixelRatio);
    }
  });

  it("caps a scale only past maxPixels, to exactly maxPixels", () => {
    assert.equal(capScale(1, LETTER, 612 * 792), 1);
    const capped = capScale(1, LETTER, 612 * 792 - 1);
    assert.ok(capped < 1);
    assert.ok(Math.abs(612 * capped * 792 * capped - (612 * 792 - 1)) < 1e-6);
    assert.equal(capScale(2, undefined, 1), 2);
  });

  it("draws no base that would hold no pixels, and gives the page its detail once settled", () => {
    const { input, mounted } = view(Array(4).fill(LETTER), 1);
    const budgets = { maxBasePixels: 0 };
    assert.deepEqual(plan(context({ ...input, settled: false }, budgets), [blank(0)], 2), []);
    const settled = context(input, budgets);
    const pages = new Map(mounted.map((index) => [index, blank(index)]));
    const drawn = run(settled, pages);
    assert.ok(drawn.every(({ layer }) => layer === "detail"));
    assert.ok((pages.get(0)?.detailScale ?? 0) > 0);
  });

  it("draws whole-page detail at exactly its budget and part of the page one pixel over it", () => {
    const partly = view([LETTER], 1, { top: 400 }).input;
    assert.deepEqual(detailPlan(context(partly, { maxDetailPixels: 612 * 792 }), 0), {
      scale: 1,
      region: null,
    });
    const over = detailPlan(context(partly, { maxDetailPixels: 612 * 792 - 1 }), 0);
    assert.equal(over?.scale, 1);
    const shown = visibleArea(partly.layout, 0, partly.viewport) as PageArea;
    assert.ok(over?.region && contains(over.region, shown) && area(over.region) < 1);
    // A page in view whole loses a step of resolution instead.
    const whole = view([LETTER], 1).input;
    const reduced = detailPlan(context(whole, { maxDetailPixels: 612 * 792 - 1 }), 0);
    assert.equal(reduced?.scale, REDUCED_DETAIL_STEP);
    assert.deepEqual(reduced?.region, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it("lowers resolution by the fewest quarter-octave steps that fit the visible area", () => {
    const { input } = view([LETTER], 4, { top: 1000, devicePixelRatio: 2 });
    const shown = area(visibleArea(input.layout, 0, input.viewport) as PageArea);
    for (const maxDetailPixels of [500_000, 1_000_000, 2_345_678]) {
      const planned = detailPlan(context(input, { maxDetailPixels }), 0);
      assert.ok(planned, `${maxDetailPixels}`);
      const scale = planned.scale;
      assert.ok(shown * pagePixels(input, 0, scale, null) <= maxDetailPixels, `${maxDetailPixels}`);
      const finer = scale / REDUCED_DETAIL_STEP;
      assert.ok(shown * pagePixels(input, 0, finer, null) > maxDetailPixels, `${maxDetailPixels}`);
      assert.ok(pagePixels(input, 0, scale, planned.region) <= maxDetailPixels * 1.0001);
    }
  });

  it("snaps a turned page's region within its turned size", () => {
    const { input } = view([LANDSCAPE], 3, { rotation: 90, top: 500 });
    const turned = turnedSize(LANDSCAPE, 90);
    const all = snapRegion(input.layout, 0, 3, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    assert.deepEqual(all?.pixels, {
      x: 0,
      y: 0,
      width: Math.ceil(turned.width * 3),
      height: Math.ceil(turned.height * 3),
    });
    const planned = detailPlan(context(input, { maxDetailPixels: 1_000_000 }), 0);
    assert.ok(planned?.region);
    const snapped = snapRegion(input.layout, 0, 3, planned.region);
    assert.ok(snapped && contains(snapped.region, planned.region));
    assert.ok(snapped.pixels.x + snapped.pixels.width <= Math.ceil(turned.width * 3));
    assert.ok(snapped.pixels.y + snapped.pixels.height <= Math.ceil(turned.height * 3));
    assert.equal(snapped.region.minY, snapped.pixels.y / (turned.height * 3));
  });

  it("snaps a region outward to whole pixels, up to the page's last partial pixel", () => {
    const layout = computeLayout([LETTER], 1, { gap: 10 });
    const snapped = snapRegion(layout, 0, 1.3, { minX: 0.1, minY: 0.2, maxX: 1, maxY: 0.5 });
    // 795.6 by 1029.6 pixels.
    assert.deepEqual(snapped?.pixels, { x: 79, y: 205, width: 717, height: 310 });
    assert.equal(snapped?.region.minX, 79 / 795.6);
    assert.equal(snapRegion(layout, 1, 1.3, { minX: 0, minY: 0, maxX: 1, maxY: 1 }), null);
  });

  it("shares what visible bases leave of maxCanvasPixels by visible area, and gives pages outside the viewport the whole budget", () => {
    const { input } = view(Array(3).fill(LETTER), 1, { devicePixelRatio: 2 });
    assert.deepEqual([input.first, input.last], [0, 1]);
    const budgets = { maxCanvasPixels: 3_000_000 };
    const plan = context(input, budgets);
    const bases = pagePixels(input, 0, baseScale(plan, 0), null) * 2;
    const own = (index: number) =>
      area(visibleArea(input.layout, index, input.viewport) as PageArea);
    const [first, second] = [detailBudget(plan, 0), detailBudget(plan, 1)];
    assert.ok(Math.abs(first + second - (3_000_000 - bases)) < 1e-6);
    assert.ok(Math.abs(first / second - own(0) / own(1)) < 1e-9);
    assert.equal(detailBudget(plan, 2), DEFAULT_BUDGETS.maxDetailPixels);
    // Bases over the budget leave visible pages no detail.
    const tight = context(input, { maxCanvasPixels: bases - 1 });
    assert.equal(detailBudget(tight, 0), 0);
    assert.equal(detailPlan(tight, 0), null);
  });

  it("draws only the visible pages' bases when they alone exceed maxCanvasPixels", () => {
    const { input, mounted } = view(Array(4).fill(LETTER), 1);
    const plan = context(input, { maxCanvasPixels: 100_000 });
    const pages = new Map(mounted.map((index) => [index, blank(index)]));
    run(plan, pages);
    for (const page of pages.values()) {
      assert.equal(page.detailScale, 0, `page ${page.index + 1}`);
      assert.equal(page.baseScale > 0, visible(plan, page.index), `page ${page.index + 1}`);
    }
  });

  it("redraws a detail more than 1% off its scale, far over its budget, of another version, or of another extent", () => {
    const { input } = view([LETTER], 1);
    const plan = context(input, { maxDetailPixels: 500_000 });
    const whole = { scale: 1, region: null };
    const shown = { ...blank(0), detailScale: 1, detailPixels: 484_704 };
    assert.equal(needsDetail(plan, shown, whole), false);
    assert.equal(needsDetail(plan, { ...shown, detailScale: 1.0099 }, whole), false);
    assert.equal(needsDetail(plan, { ...shown, detailScale: 1.0101 }, whole), true);
    assert.equal(needsDetail(plan, { ...shown, detailPixels: 625_000 }, whole), false);
    assert.equal(needsDetail(plan, { ...shown, detailPixels: 625_001 }, whole), true);
    assert.equal(needsDetail({ ...plan, version: 1 }, shown, whole), true);
    const part = { minX: 0, minY: 0, maxX: 1, maxY: 0.5 };
    assert.equal(needsDetail(plan, { ...shown, detailRegion: part }, whole), true);
    assert.equal(needsDetail(plan, shown, { scale: 1, region: part }), true);
  });

  it("counts a running drawing's pixels in the canvas it draws into", () => {
    const { input } = view([LETTER], 1);
    const plan = context(input);
    const page = { ...blank(0), basePixels: 100, detailPixels: 1000, sparePixels: 10 };
    assert.equal(layerPixels(plan, page, "base"), 100);
    assert.equal(layerPixels(plan, page, "detail"), 1010);
    const job = { scale: 1, region: null };
    const drawn = 612 * 792;
    const base = { ...page, job: { ...job, layer: "base" as const, intoSpare: false } };
    assert.equal(layerPixels(plan, base, "base"), drawn);
    assert.equal(layerPixels(plan, base, "detail"), 1010);
    const spare = { ...page, job: { ...job, layer: "detail" as const, intoSpare: true } };
    assert.equal(layerPixels(plan, spare, "detail"), 1000 + drawn);
    const inPlace = { ...page, job: { ...job, layer: "detail" as const, intoSpare: false } };
    assert.equal(layerPixels(plan, inPlace, "detail"), 10 + drawn);
  });

  it("keeps the detail shown while the next one draws only with a spare and room for both", () => {
    const plan = context(view([LETTER], 1).input, { maxCanvasPixels: 1000 });
    const page = { ...blank(0), detailScale: 1 };
    assert.equal(keepsDetail(plan, page, 400, 600), true);
    assert.equal(keepsDetail(plan, page, 401, 600), false);
    assert.equal(keepsDetail(plan, { ...page, hasSpare: false }, 1, 0), false);
    assert.equal(keepsDetail(plan, { ...page, detailScale: 0 }, 1, 0), false);
  });

  it("tries a failed drawing again only once its scale, region, version, rotation, or page size changes", () => {
    const { input } = view([LETTER], 1);
    const at = context(input);
    const region = { minX: 0, minY: 0, maxX: 1, maxY: 0.5 };
    const failure = { scale: 2, region, version: 0, rotation: 0 as const, ...LETTER };
    const page = { ...blank(0), failures: { detail: failure } };
    assert.equal(failed(at, page, "detail", { scale: 2, region: { ...region } }), true);
    assert.equal(failed(at, page, "base", { scale: 2, region }), false);
    assert.equal(failed(at, page, "detail", { scale: 2.0001, region }), false);
    assert.equal(failed(at, page, "detail", { scale: 2, region: null }), false);
    assert.equal(failed(at, page, "detail", { scale: 2, region: { ...region, maxY: 0.6 } }), false);
    assert.equal(failed({ ...at, version: 1 }, page, "detail", { scale: 2, region }), false);
    const turned = view([LETTER], 1, { rotation: 90 }).input;
    assert.equal(failed(context(turned), page, "detail", { scale: 2, region }), false);
    const resized = view([{ width: 612, height: 793 }], 1).input;
    assert.equal(failed(context(resized), page, "detail", { scale: 2, region }), false);
    // While it stays blocked, nothing is drawn in its place.
    const blocked = { ...blank(0), failures: { base: { ...failure, scale: 0.5, region: null } } };
    assert.deepEqual(plan(context({ ...input, settled: false }), [blocked], 2), []);
  });

  it("gives back every outside detail before any base, farthest first, and stops within the budget", () => {
    const { input } = view(Array(8).fill(LETTER), 1);
    assert.deepEqual([input.first, input.last], [0, 1]);
    const page = (index: number) => ({
      ...blank(index),
      baseScale: 0.5,
      basePixels: 100,
      detailScale: 1,
      detailPixels: 1000,
    });
    const pages = [0, 1, 2, 3, 4].map(page);
    assert.deepEqual(trim(context(input), pages), []);
    assert.deepEqual(trim(context(input, { maxCanvasPixels: 5500 }), pages), []);
    assert.deepEqual(trim(context(input, { maxCanvasPixels: 5499 }), pages), [
      { index: 4, layer: "detail" },
    ]);
    assert.deepEqual(trim(context(input, { maxCanvasPixels: 2350 }), pages), [
      { index: 4, layer: "detail" },
      { index: 3, layer: "detail" },
      { index: 2, layer: "detail" },
      { index: 4, layer: "base" },
      { index: 3, layer: "base" },
    ]);
    // Visible pages keep theirs, over the budget or not.
    assert.equal(trim(context(input, { maxCanvasPixels: 0 }), pages).length, 6);
  });

  it("cancels a running detail at another scale and gives back one no longer planned", () => {
    const { input } = view([LETTER], 1);
    const job = { layer: "detail" as const, region: null, intoSpare: false };
    const running = (scale: number) => ({ ...blank(0), baseScale: 0.5, job: { ...job, scale } });
    assert.equal(staleDetail(context(input), running(1.0099)).cancel, false);
    assert.equal(staleDetail(context(input), running(1.0101)).cancel, true);
    // Zoomed past the budget, a page outside the viewport has no detail planned.
    const far = view(Array(4).fill(LETTER), 4, { top: 9000 }).input;
    const outside = context(far, { maxDetailPixels: 1_000_000 });
    assert.ok(!visible(outside, 0));
    const shown = { ...blank(0), baseScale: 2, detailScale: 4, detailPixels: 1_000_000 };
    assert.deepEqual(staleDetail(outside, shown), { cancel: false, clear: true });
    assert.deepEqual(
      staleDetail(outside, { ...shown, detailScale: 0, job: { ...job, scale: 4 } }),
      {
        cancel: true,
        clear: false,
      },
    );
  });

  it("weighs a page's sharpness by the area each layer covers", () => {
    const all = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    assert.equal(pageSharpness(undefined, all, 2), 0);
    assert.equal(pageSharpness({ ...blank(0), baseScale: 1 }, { ...all, maxX: 0 }, 2), 0);
    assert.equal(pageSharpness({ ...blank(0), baseScale: 1 }, all, 2), 0.5);
    assert.equal(pageSharpness({ ...blank(0), baseScale: 4 }, all, 2), 1);
    const half = { minX: 0, minY: 0, maxX: 1, maxY: 0.5 };
    const page = { ...blank(0), baseScale: 1, detailScale: 2, detailRegion: half };
    assert.equal(pageSharpness(page, all, 2), 0.75);
    assert.equal(pageSharpness(page, half, 2), 1);
    // A detail coarser than the base counts as the base.
    assert.equal(pageSharpness({ ...page, detailScale: 0.5 }, all, 2), 0.5);
  });

  it("draws no base under a current whole-page detail after a zoom, but gives back a larger one's pixels", () => {
    const covered = (scale: number, base: number) => ({
      ...blank(0),
      baseScale: base,
      basePixels: pagePixels(view([LETTER], scale).input, 0, base, null),
      detailScale: scale,
      detailPixels: Math.floor(612 * scale) * Math.floor(792 * scale),
    });
    // Zoomed in from 1 to 2.5.
    const zoomedIn = context(view([LETTER], 2.5).input);
    assert.deepEqual(plan(zoomedIn, [covered(2.5, 0.5)], 1), []);
    // Of an older content version, too.
    assert.deepEqual(
      plan({ ...zoomedIn, version: 1 }, [{ ...covered(2.5, 1.25), detailVersion: 1 }], 1),
      [],
    );
    // Zoomed out from 4 to 0.5, the base drawn at 4 gives way to a small one.
    const zoomedOut = context(view([LETTER], 0.5).input);
    const [base] = plan(zoomedOut, [covered(0.5, 2)], 1);
    assert.equal(base?.layer, "base");
    assert.equal(base?.scale, 0.25);
  });

  it("makes a whole-page detail of up to maxBasePixels the base, and nothing larger or partial", () => {
    const plan = context(view([LETTER], 1).input, { maxBasePixels: 1000 });
    const page = { ...blank(0), detailScale: 1, detailPixels: 1000 };
    assert.equal(demotes(plan, page), true);
    assert.equal(demotes(plan, { ...page, detailPixels: 1001 }), false);
    const part = { minX: 0, minY: 0, maxX: 1, maxY: 0.5 };
    assert.equal(demotes(plan, { ...page, detailRegion: part }), false);
    assert.equal(demotes(plan, { ...page, detailScale: 0 }), false);
  });

  it("takes a page's base away while it draws, and its detail only when drawn in place", () => {
    const page = { ...blank(0), baseScale: 0.5, detailScale: 1, basePixels: 1, detailPixels: 2 };
    const drawing = (layer: "base" | "detail", intoSpare: boolean): PlannedDrawing => ({
      index: 0,
      layer,
      scale: 2,
      region: null,
      plannedRegion: null,
      intoSpare,
    });
    const base = started(page, drawing("base", false));
    assert.deepEqual([base.baseScale, base.detailScale, base.basePixels], [0, 1, 1]);
    assert.deepEqual(base.job, { layer: "base", scale: 2, region: null, intoSpare: false });
    const spare = started(page, drawing("detail", true));
    assert.deepEqual([spare.baseScale, spare.detailScale], [0.5, 1]);
    const inPlace = started(page, drawing("detail", false));
    assert.deepEqual([inPlace.detailScale, inPlace.detailRegion], [0, null]);
  });

  it("starts at most the limit's drawings, one per page", () => {
    const { input, mounted } = view(Array(6).fill(LETTER), 1, { settled: false });
    const pages = mounted.map(blank);
    assert.deepEqual(plan(context(input), pages, 0), []);
    const drawings = plan(context(input), pages, 10);
    assert.equal(drawings.length, mounted.length);
    assert.equal(new Set(drawings.map(({ index }) => index)).size, mounted.length);
    assert.equal(plan(context(input), pages, 2).length, 2);
  });
});
