import type { PageSize } from "../document/session.ts";
import type { DrawRegion, Rotation } from "../pdfjs/draw.ts";
import {
  areaSize,
  intersectAreas,
  type Layout,
  type PageArea,
  turnedSize,
  type Viewport,
  visibleArea,
} from "../view/layout.ts";

/**
 * The planner decides what the renderer draws, and nothing else: a pure
 * function of the view, the budgets, and what each page shows and draws
 * now. It runs in Node, where its invariants are tested; the renderer
 * carries out its plans.
 *
 * Each mounted page has two stacked canvas layers. The base layer is a
 * quick, low-resolution drawing that fills the page as soon as it scrolls
 * in; the detail layer covers it at full device resolution once scrolling
 * settles. Pages that slow scrolling brings into the mounted window draw
 * their detail before they scroll in and get a base only once they need one
 * in view. A page that shows a detail draws its next one into a spare
 * canvas while the old one shows (see the renderer).
 */
export type Layer = "base" | "detail";

export interface ViewInput {
  layout: Layout;
  /** Pages intersecting the viewport. */
  first: number;
  last: number;
  /** Page nearest the viewport center; work radiates out from it. */
  focus: number;
  viewport: Viewport;
  devicePixelRatio: number;
  /** Scrolling is slow or stopped, so full-resolution work is worth starting. */
  settled: boolean;
}

export interface Budgets {
  /**
   * The most pixels a detail canvas holds. A page whose full-resolution
   * drawing is larger gets detail only for its visible area plus a margin.
   */
  maxDetailPixels: number;
  /**
   * The most pixels a detail canvas holds as a multiple of the viewport's
   * device pixels, so the margin around the visible area follows the
   * viewport's size; maxDetailPixels still caps it. Below 1 the visible area
   * itself loses resolution.
   */
  maxDetailViewports: number;
  /** The most pixels a base canvas holds; beyond it the base is drawn at lower resolution. */
  maxBasePixels: number;
  /**
   * The most pixels all canvases hold together. Pages outside the viewport
   * draw only within what visible pages leave and give their pixels back,
   * farthest first and detail before base. Visible pages count too: after
   * their bases, each gets detail for its share of the rest, by visible area,
   * losing margin first and then resolution (see REDUCED_DETAIL_STEP). Their
   * bases are never given back, so a visible page never goes blank, and a
   * budget smaller than the visible bases is exceeded by them.
   */
  maxCanvasPixels: number;
}

export const DEFAULT_BUDGETS: Budgets = {
  maxDetailPixels: 16_777_216,
  maxDetailViewports: Number.POSITIVE_INFINITY,
  maxBasePixels: 2_097_152,
  maxCanvasPixels: Number.POSITIVE_INFINITY,
};

/** What the planner reads: the view, the budgets, and the content version pages should show. */
export interface PlanContext {
  readonly input: ViewInput;
  readonly budgets: Budgets;
  /**
   * Bumped when what pages show changes but not where, as when a layer is
   * shown or hidden: pixels of an older version stay until new ones replace
   * them, so the page never goes blank.
   */
  readonly version: number;
}

/** A drawing that failed, blocked until its conditions change or the page mounts again. */
export interface FailedDrawing {
  readonly scale: number;
  /** The planned region, not the one snapped to pixels. */
  readonly region: PageArea | null;
  readonly version: number;
  readonly rotation: Rotation;
  readonly width: number;
  readonly height: number;
}

/** A drawing of one of a page's layers that runs. */
export interface RunningDrawing {
  readonly layer: Layer;
  /** Device pixels per point. */
  readonly scale: number;
  /** The part of the page drawn, snapped to pixels; null for the whole page. */
  readonly region: PageArea | null;
  /** A detail drawn into the spare canvas while the page shows its current one. */
  readonly intoSpare: boolean;
}

/** What a mounted page shows and draws now. */
export interface PageState {
  readonly index: number;
  /** Device pixels per point of the last completed drawing, 0 when empty. */
  readonly baseScale: number;
  readonly detailScale: number;
  /** The content version each layer's pixels show. */
  readonly baseVersion: number;
  readonly detailVersion: number;
  /** The part of the page the detail layer covers; null for the whole page. */
  readonly detailRegion: PageArea | null;
  readonly failures: Readonly<Partial<Record<Layer, FailedDrawing>>>;
  readonly job: RunningDrawing | undefined;
  /** Whether the page has a spare detail canvas. */
  readonly hasSpare: boolean;
  /** Pixels each canvas holds now. */
  readonly basePixels: number;
  readonly detailPixels: number;
  readonly sparePixels: number;
}

/** A drawing the plan wants started. */
export interface PlannedDrawing extends RunningDrawing {
  readonly index: number;
  /** The region as planned, before snapping; failures are recorded by it. */
  readonly plannedRegion: PageArea | null;
  /** The region in device pixels of the drawn page; absent for the whole page. */
  readonly pixels?: DrawRegion;
}

/** Base drawings use half a device pixel per CSS pixel at most: fast, and fine as a placeholder. */
export const BASE_FACTOR = 0.5;

/**
 * Once scrolling settles, a visible page with no pixels yet gets its
 * whole-page detail without a base first when that detail holds at most this
 * many times maxBasePixels (8.4 MP by default, an A4 page about 1,200 CSS
 * pixels wide at devicePixelRatio 2). A base repeats all of the page's drawing
 * work, most of the cost of vector drawings, and delays the sharp page.
 */
export const QUICK_DETAIL_BASES = 4;

/**
 * A page whose detail budget cannot hold its visible area at full resolution,
 * a visible page's share of maxCanvasPixels or a viewport larger than
 * maxDetailPixels, gets detail at a lower one, in steps of a quarter octave
 * (2^-1/4, 16% fewer pixels per side) so that small changes of the budget as
 * the view moves do not redraw it. A detail no sharper than the base is not
 * drawn: the page shows its base alone.
 */
export const REDUCED_DETAIL_STEP = 2 ** -0.25;

/** A detail canvas holding this much more than its page's budget allows is drawn again, smaller. */
export const OVER_BUDGET = 1.25;

/**
 * pdf.js's PDFPageDetailView redraws its region once the visible area leaves
 * it, or once the margin on one side grows past (1 + 0.5) / 0.5 = 3 times the
 * margin on the opposite side, which is wasted on the region's far side.
 */
const LOPSIDED_MARGIN = 3;

/**
 * Margins narrower than this share of the visible span never make a region
 * lopsided. A region without a margin, which a detail budget smaller than the
 * visible area leaves, keeps only the pixel or so that snapping to whole
 * pixels adds on each side, unevenly: counted as lopsided, it was drawn again
 * and again, about 60 times a second, while the view stood still.
 */
const MIN_LOPSIDED_MARGIN = 0.02;

export function shouldRedrawRegion(region: PageArea, visible: PageArea): boolean {
  if (
    visible.minX < region.minX ||
    visible.minY < region.minY ||
    visible.maxX > region.maxX ||
    visible.maxY > region.maxY
  ) {
    return true;
  }
  const left = visible.minX - region.minX;
  const right = region.maxX - visible.maxX;
  const top = visible.minY - region.minY;
  const bottom = region.maxY - visible.maxY;
  const width = (visible.maxX - visible.minX) * MIN_LOPSIDED_MARGIN;
  const height = (visible.maxY - visible.minY) * MIN_LOPSIDED_MARGIN;
  return (
    (region.minX > 0 && right > width && right / left > LOPSIDED_MARGIN) ||
    (region.maxX < 1 && left > width && left / right > LOPSIDED_MARGIN) ||
    (region.minY > 0 && bottom > height && bottom / top > LOPSIDED_MARGIN) ||
    (region.maxY < 1 && top > height && top / bottom > LOPSIDED_MARGIN)
  );
}

/** Lowers `scale` until a page of `size` points fits in `maxPixels`. */
export function capScale(scale: number, size: PageSize | undefined, maxPixels: number): number {
  if (!size) return scale;
  const pixels = size.width * scale * (size.height * scale);
  return pixels > maxPixels ? scale * Math.sqrt(maxPixels / pixels) : scale;
}

export const sameScale = (a: number, b: number): boolean => Math.abs(a - b) <= b * 0.01;

const isVisible = (input: ViewInput, index: number): boolean =>
  index >= input.first && index <= input.last;

/** Pixels of page `index` drawn at `scale` device pixels per point, over `region` or all of it. */
export function pagePixels(
  input: ViewInput,
  index: number,
  scale: number,
  region: PageArea | null,
): number {
  const size = input.layout.sizes[index];
  if (!size) return 0;
  return size.width * scale * size.height * scale * (region ? areaSize(region) : 1);
}

export function baseScale({ input, budgets }: PlanContext, index: number): number {
  return capScale(
    input.layout.scale * BASE_FACTOR,
    input.layout.sizes[index],
    budgets.maxBasePixels,
  );
}

/**
 * The most pixels page `index`'s detail may hold: maxDetailPixels, at most
 * maxDetailViewports viewports' worth of device pixels, and, while the page
 * is visible and maxCanvasPixels is set, its share of what the visible
 * pages' bases leave of that budget, by visible area. Every visible page is
 * counted with its base, drawn or not, so a share does not change when a
 * base arrives.
 */
export function detailBudget(context: PlanContext, index: number): number {
  const { input, budgets } = context;
  const { viewport, devicePixelRatio } = input;
  const viewportPixels = viewport.width * viewport.height * devicePixelRatio ** 2;
  const budget = Math.min(budgets.maxDetailPixels, budgets.maxDetailViewports * viewportPixels);
  if (budgets.maxCanvasPixels === Number.POSITIVE_INFINITY) return budget;
  if (!isVisible(input, index)) return budget;
  const scale = input.layout.scale * devicePixelRatio;
  let bases = 0;
  let visibleTotal = 0;
  let own = 0;
  for (let page = input.first; page <= input.last; page++) {
    const area = visibleArea(input.layout, page, viewport);
    if (!area) continue;
    const visiblePixels = areaSize(area) * pagePixels(input, page, scale, null);
    bases += pagePixels(input, page, baseScale(context, page), null);
    visibleTotal += visiblePixels;
    if (page === index) own = visiblePixels;
  }
  const left = Math.max(0, budgets.maxCanvasPixels - bases);
  return Math.min(budget, visibleTotal > 0 ? (left * own) / visibleTotal : left);
}

/**
 * Whether the whole-page detail `page` shows becomes its base when it gives
 * way to a detail of part of the page or leaves the viewport, as zooming
 * past its budget does, instead of a base drawn again: only one no larger
 * than a base (decision 0012). On a phone a whole-page detail at fit-width
 * is about that size, and the base drawn instead is a full drawing of the
 * page; scaling down the larger ones of a desktop cost WebKit more than the
 * drawings it saved (decision 0008).
 */
export function demotes({ budgets, version }: PlanContext, page: PageState): boolean {
  return (
    page.detailScale > 0 &&
    page.detailRegion === null &&
    page.detailVersion === version &&
    page.detailPixels <= budgets.maxBasePixels
  );
}

/** What a page's detail layer should hold. */
export interface DetailPlan {
  /** Device pixels per point. */
  readonly scale: number;
  /** The part of the page to draw; null for the whole page. */
  readonly region: PageArea | null;
}

/**
 * A page whose full-resolution drawing fits its detail budget gets detail
 * for the whole page. A larger one gets detail only while visible, for the
 * visible area grown by up to its own size on each side as far as the
 * budget allows, as in pdf.js's PDFPageDetailView; when the visible area
 * alone does not fit, at a lower resolution (REDUCED_DETAIL_STEP), with
 * what that leaves of the budget as its margin. Null: no detail layer.
 */
export function detailPlan(context: PlanContext, index: number): DetailPlan | null {
  const { layout, devicePixelRatio } = context.input;
  const size = layout.sizes[index];
  if (!size) return null;
  let scale = layout.scale * devicePixelRatio;
  let pixels = size.width * scale * (size.height * scale);
  const budget = detailBudget(context, index);
  if (pixels <= budget) return { scale, region: null };
  const visible = visibleArea(layout, index, context.input.viewport);
  if (!visible) return null;
  const share = areaSize(visible);
  // Decided from the visible area, not from the grown region: a region
  // grown to fill the budget exactly came out over it by rounding in about
  // a third of the cases, which cost a whole step of resolution.
  if (share * pixels > budget) {
    const steps = Math.ceil(
      Math.log(Math.sqrt(budget / (share * pixels))) / Math.log(REDUCED_DETAIL_STEP),
    );
    scale *= REDUCED_DETAIL_STEP ** steps;
    if (scale <= baseScale(context, index)) return null;
    pixels = size.width * scale * (size.height * scale);
  }
  const overflow = Math.min(1, Math.max(0, (Math.sqrt(budget / (share * pixels)) - 1) / 2));
  const growX = (visible.maxX - visible.minX) * overflow;
  const growY = (visible.maxY - visible.minY) * overflow;
  return {
    scale,
    region: {
      minX: Math.max(0, visible.minX - growX),
      minY: Math.max(0, visible.minY - growY),
      maxX: Math.min(1, visible.maxX + growX),
      maxY: Math.min(1, visible.maxY + growY),
    },
  };
}

export function needsDetail(context: PlanContext, page: PageState, plan: DetailPlan): boolean {
  if (!sameScale(page.detailScale, plan.scale) || page.detailVersion !== context.version) {
    return true;
  }
  // A detail far over the page's budget, say after its share shrank, is drawn again smaller.
  if (page.detailPixels > detailBudget(context, page.index) * OVER_BUDGET) return true;
  if (!plan.region) return page.detailRegion !== null;
  if (!page.detailRegion) return true;
  const { input } = context;
  const visible = visibleArea(input.layout, page.index, input.viewport);
  return visible !== null && shouldRedrawRegion(page.detailRegion, visible);
}

export function failed(
  context: PlanContext,
  page: PageState,
  layer: Layer,
  plan: DetailPlan,
): boolean {
  const failure = page.failures[layer];
  const { layout } = context.input;
  const size = layout.sizes[page.index];
  if (
    !failure ||
    failure.version !== context.version ||
    failure.rotation !== layout.rotation ||
    failure.width !== size?.width ||
    failure.height !== size?.height ||
    failure.scale !== plan.scale
  ) {
    return false;
  }
  const a = failure.region;
  const b = plan.region;
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.minX === b.minX &&
      a.minY === b.minY &&
      a.maxX === b.maxX &&
      a.maxY === b.maxY)
  );
}

/**
 * Pixels a layer holds, or will hold once its running drawing sizes the
 * canvas it draws into: a detail drawn into the spare holds both canvases'
 * until it completes, and a replaced one until it is released.
 */
export function layerPixels({ input }: PlanContext, page: PageState, layer: Layer): number {
  const { job } = page;
  let pixels = 0;
  if (layer === "base") {
    if (job?.layer !== "base") pixels += page.basePixels;
  } else {
    const drawing = job?.layer === "detail";
    if (!drawing || job.intoSpare) pixels += page.detailPixels;
    if (!drawing || !job.intoSpare) pixels += page.sparePixels;
  }
  if (job?.layer === layer) pixels += pagePixels(input, page.index, job.scale, job.region);
  return pixels;
}

/** Pixels all of `pages`' canvases hold, their running drawings included. */
export function canvasPixels(context: PlanContext, pages: Iterable<PageState>): number {
  let total = 0;
  for (const page of pages) {
    total += layerPixels(context, page, "base") + layerPixels(context, page, "detail");
  }
  return total;
}

/**
 * Whether a detail of `pixels` would be drawn into the page's spare canvas
 * while the shown one stays: the page shows a detail, has a spare, and has
 * room for both within maxCanvasPixels beside `total`, the pixels all
 * canvases hold now.
 */
export function keepsDetail(
  { budgets }: PlanContext,
  page: PageState,
  pixels: number,
  total: number,
): boolean {
  return page.hasSpare && page.detailScale > 0 && total + pixels <= budgets.maxCanvasPixels;
}

/** Snaps `region` of page `index` drawn at `scale` to whole pixels, so it lines up with the base below. */
export function snapRegion(
  layout: Layout,
  index: number,
  scale: number,
  region: PageArea,
): { region: PageArea; pixels: DrawRegion } | null {
  const unturned = layout.sizes[index];
  if (!unturned) return null;
  const size = turnedSize(unturned, layout.rotation);
  const width = size.width * scale;
  const height = size.height * scale;
  const x = Math.floor(region.minX * width);
  const y = Math.floor(region.minY * height);
  const right = Math.min(Math.ceil(width), Math.ceil(region.maxX * width));
  const bottom = Math.min(Math.ceil(height), Math.ceil(region.maxY * height));
  return {
    pixels: { x, y, width: right - x, height: bottom - y },
    region: { minX: x / width, minY: y / height, maxX: right / width, maxY: bottom / height },
  };
}

const byDistance = (input: ViewInput, pages: Iterable<PageState>): PageState[] =>
  [...pages].sort((a, b) => Math.abs(a.index - input.focus) - Math.abs(b.index - input.focus));

/** The highest-priority drawing an idle page needs, or nothing to do. */
export function nextDrawing(
  context: PlanContext,
  pages: Iterable<PageState>,
): PlannedDrawing | undefined {
  const { input, budgets, version } = context;
  const all = [...pages];
  const idle = byDistance(input, all).filter((page) => page.job === undefined);
  const visible = (page: PageState) => isVisible(input, page.index);
  const plans = new Map<PageState, DetailPlan | null>();
  const planOf = (page: PageState) => {
    if (!plans.has(page)) plans.set(page, detailPlan(context, page.index));
    return plans.get(page) ?? null;
  };
  const wantsDetail = (page: PageState) => {
    const plan = planOf(page);
    return plan !== null && needsDetail(context, page, plan);
  };
  // A base drawn at a very different zoom still beats an empty page, so
  // refreshing it comes last.
  const staleBase = (page: PageState) => {
    const target = baseScale(context, page.index);
    return (
      page.baseScale > 0 &&
      (page.baseScale > target * 2 || page.baseScale < target / 2 || page.baseVersion !== version)
    );
  };

  // Pages outside the viewport draw only within maxCanvasPixels.
  const total = canvasPixels(context, all);
  // A base under whole-page detail would never show: under a current one,
  // or under a stale one that stays until a whole-page detail drawn into the
  // spare replaces it, as after a zoom, or a detail of part of the page
  // does, and the whole-page one becomes the base. Once scrolling settles, a page
  // outside the viewport that gets whole-page detail draws it without a
  // base first: the detail has time to arrive before the page scrolls in,
  // and drawing both doubled the work for every page that slow scrolling
  // brought in.
  const coveredByDetail = (page: PageState) => {
    if (page.detailScale === 0 || page.detailRegion !== null) return false;
    if (!wantsDetail(page)) return true;
    const plan = planOf(page);
    return (
      plan !== null &&
      (plan.region === null || demotes(context, page)) &&
      !failed(context, page, "detail", plan) &&
      keepsDetail(context, page, pagePixels(input, page.index, plan.scale, plan.region), total)
    );
  };
  // A base of an older content version shows wherever the detail does not.
  const needsBase = (page: PageState) =>
    (page.baseScale === 0 || page.baseVersion !== version) && !coveredByDetail(page);
  const detailFirst = (page: PageState) => {
    const plan = planOf(page);
    return (
      input.settled &&
      plan !== null &&
      plan.region === null &&
      !failed(context, page, "detail", plan)
    );
  };
  // See QUICK_DETAIL_BASES.
  const quickDetail = (page: PageState) => {
    if (!input.settled || page.baseScale > 0 || page.detailScale > 0) return false;
    const plan = planOf(page);
    return (
      plan !== null &&
      plan.region === null &&
      !failed(context, page, "detail", plan) &&
      pagePixels(input, page.index, plan.scale, null) <= budgets.maxBasePixels * QUICK_DETAIL_BASES
    );
  };
  const fits = (page: PageState, layer: Layer) => {
    const plan = layer === "detail" ? planOf(page) : null;
    const pixels =
      layer === "base"
        ? pagePixels(input, page.index, baseScale(context, page.index), null)
        : plan
          ? pagePixels(input, page.index, plan.scale, plan.region)
          : 0;
    return total - layerPixels(context, page, layer) + pixels <= budgets.maxCanvasPixels;
  };

  const phases: [(page: PageState) => boolean, Layer][] = [
    [(page) => visible(page) && needsBase(page) && !quickDetail(page), "base"],
    [(page) => input.settled && visible(page) && wantsDetail(page), "detail"],
    [
      (page) => !visible(page) && needsBase(page) && !detailFirst(page) && fits(page, "base"),
      "base",
    ],
    [
      (page) => input.settled && !visible(page) && wantsDetail(page) && fits(page, "detail"),
      "detail",
    ],
    [(page) => input.settled && staleBase(page) && (visible(page) || fits(page, "base")), "base"],
  ];
  for (const [matches, layer] of phases) {
    for (const page of idle) {
      if (!matches(page)) continue;
      const plan: DetailPlan | null =
        layer === "base" ? { scale: baseScale(context, page.index), region: null } : planOf(page);
      if (!plan || failed(context, page, layer, plan)) continue;
      // A page that shows a detail keeps it until the next one, drawn into
      // the spare canvas, is complete.
      const intoSpare =
        layer === "detail" &&
        keepsDetail(context, page, pagePixels(input, page.index, plan.scale, plan.region), total);
      const snapped = plan.region
        ? snapRegion(input.layout, page.index, plan.scale, plan.region)
        : null;
      return {
        index: page.index,
        layer,
        scale: plan.scale,
        plannedRegion: plan.region,
        region: snapped ? snapped.region : plan.region,
        ...(snapped ? { pixels: snapped.pixels } : {}),
        intoSpare,
      };
    }
  }
  return undefined;
}

/** What `page` shows and draws once `drawing` starts. */
export function started(page: PageState, drawing: PlannedDrawing): PageState {
  const job: RunningDrawing = {
    layer: drawing.layer,
    scale: drawing.scale,
    region: drawing.region,
    intoSpare: drawing.intoSpare,
  };
  // Every field read one by one: the renderer's pages count their pixels
  // with getters, which spreading an object leaves out.
  const state: PageState = {
    index: page.index,
    baseScale: page.baseScale,
    detailScale: page.detailScale,
    baseVersion: page.baseVersion,
    detailVersion: page.detailVersion,
    detailRegion: page.detailRegion,
    failures: page.failures,
    job,
    hasSpare: page.hasSpare,
    basePixels: page.basePixels,
    detailPixels: page.detailPixels,
    sparePixels: page.sparePixels,
  };
  if (drawing.layer === "base") return { ...state, baseScale: 0 };
  // Drawn in place, a detail has none of its pixels until it completes.
  return drawing.intoSpare ? state : { ...state, detailScale: 0, detailRegion: null };
}

/**
 * The drawings to start, at most `limit`, in order: each is planned with
 * the ones before it running, since each changes what fits.
 */
export function plan(
  context: PlanContext,
  pages: Iterable<PageState>,
  limit: number,
): PlannedDrawing[] {
  const current = new Map<number, PageState>();
  for (const page of pages) current.set(page.index, page);
  const drawings: PlannedDrawing[] = [];
  while (drawings.length < limit) {
    const drawing = nextDrawing(context, current.values());
    if (!drawing) break;
    drawings.push(drawing);
    const page = current.get(drawing.index);
    if (page) current.set(drawing.index, started(page, drawing));
  }
  return drawings;
}

/**
 * The layers that give their pixels back over maxCanvasPixels, in order:
 * pages outside the viewport, farthest first, detail before base. Visible
 * pages keep theirs. The canvases kept from pages that unmounted go before
 * any of these, so the renderer lets them go first.
 */
export function trim(
  context: PlanContext,
  pages: Iterable<PageState>,
): { index: number; layer: Layer }[] {
  const { input, budgets } = context;
  if (budgets.maxCanvasPixels === Number.POSITIVE_INFINITY) return [];
  const all = [...pages];
  let total = canvasPixels(context, all);
  if (total <= budgets.maxCanvasPixels) return [];
  const outside = all
    .filter((page) => !isVisible(input, page.index))
    .sort((a, b) => Math.abs(b.index - input.focus) - Math.abs(a.index - input.focus));
  const released: { index: number; layer: Layer }[] = [];
  for (const layer of ["detail", "base"] as const) {
    for (const page of outside) {
      if (total <= budgets.maxCanvasPixels) return released;
      const pixels = layerPixels(context, page, layer);
      if (pixels === 0) continue;
      released.push({ index: page.index, layer });
      total -= pixels;
    }
  }
  return released;
}

/**
 * What the view moving makes of a page's detail: a running detail drawing
 * at another scale, or that a page scrolling in blank during a fling would
 * wait for, is cancelled; a page with no detail planned any more, which left
 * the viewport at a zoom that draws regions, gives its detail back.
 */
export function staleDetail(
  context: PlanContext,
  page: PageState,
): { cancel: boolean; clear: boolean } {
  const { input } = context;
  const planned = detailPlan(context, page.index);
  // A page that scrolls in during a fling while its first drawing, a
  // detail, still runs gets a quick base instead.
  const blankInView =
    !input.settled &&
    page.baseScale === 0 &&
    page.detailScale === 0 &&
    isVisible(input, page.index);
  const { job } = page;
  return {
    cancel:
      job?.layer === "detail" && (!planned || !sameScale(job.scale, planned.scale) || blankInView),
    clear: !planned && page.detailScale > 0,
  };
}

/**
 * How sharp a page looks over `area`: the resolution of its pixels as a
 * share of `needed` device pixels per point, weighted by area. 1 means
 * full resolution everywhere, 0 means blank.
 */
export function pageSharpness(page: PageState | undefined, area: PageArea, needed: number): number {
  const total = areaSize(area);
  if (!page || total === 0) return 0;
  const base = Math.min(1, page.baseScale / needed);
  if (page.detailScale === 0) return base;
  const detail = Math.max(base, Math.min(1, page.detailScale / needed));
  const covered = page.detailRegion ? areaSize(intersectAreas(area, page.detailRegion)) : total;
  return (covered * detail + (total - covered) * base) / total;
}
