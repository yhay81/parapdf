import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASE_FACTOR,
  type Budgets,
  canvasPixels,
  DEFAULT_BUDGETS,
  detailPlan,
  type PageState,
  type PlanContext,
  type PlannedDrawing,
  pagePixels,
  plan,
  REDUCED_DETAIL_STEP,
  sameScale,
  shouldRedrawRegion,
  staleDetail,
  started,
  trim,
  type ViewInput,
} from "../src/render/planner.ts";
import { computeLayout, type PageArea, visibleArea, visibleRange } from "../src/view/layout.ts";

const LETTER = { width: 612, height: 792 };
const LANDSCAPE = { width: 842, height: 595 };
const TALL = { width: 400, height: 2400 };

/** A view of `sizes` at `scale`, scrolled to `top`, with the pages it mounts. */
function view(
  sizes: { width: number; height: number }[],
  scale: number,
  options: { top?: number; devicePixelRatio?: number; settled?: boolean; width?: number } = {},
): { input: ViewInput; mounted: number[] } {
  const layout = computeLayout(sizes, scale, { gap: 10 });
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
        assert.ok(
          !showsCurrentWholeDetail(context, page),
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
      const limit = Math.max(budgets.maxCanvasPixels ?? 0, visibleBases);
      assert.ok(
        total <= limit * 1.01 + 10_000,
        `${total} pixels over a budget of ${budgets.maxCanvasPixels}, visible bases ${visibleBases}`,
      );
    });
  }
});

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
