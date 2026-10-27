/**
 * Browser selection shared by every Playwright script in the repository: the
 * engine benchmark and the prototype's scroll benchmark and functional checks,
 * plus the power check and the turn-taking the measuring scripts use before
 * and during a run.
 *
 * Environment: BROWSER (chromium, webkit, or firefox; default chromium),
 * HEADED=1 to show the window, ALLOW_BATTERY=1 to measure without AC power,
 * ALLOW_PARALLEL=1 to measure beside other Playwright browsers, MAX_LOAD to
 * also wait for the one-minute load average, IGNORE_PIDS to ignore the
 * browsers of the listed processes, DIAGNOSTICS to keep what the browser
 * showed and said (see `captureFailure`).
 */
import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { loadavg, platform, tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { type Browser, chromium, firefox, type Page, webkit } from "playwright";

export const browserNames = ["chromium", "webkit", "firefox"] as const;
export type BrowserName = (typeof browserNames)[number];

export const browserLabels: Record<BrowserName, string> = {
  chromium: "Chromium",
  webkit: "WebKit",
  firefox: "Firefox",
};

export function browserFromEnv(): BrowserName {
  const name = process.env.BROWSER ?? "chromium";
  const known = browserNames.find((candidate) => candidate === name);
  if (!known) throw new Error(`BROWSER must be one of ${browserNames.join(", ")}, not "${name}"`);
  return known;
}

export interface PowerState {
  source: "ac" | "battery" | "unknown";
  lowPowerMode: boolean | null;
}

/** The power source and Low Power Mode on macOS; "unknown" elsewhere. */
export function powerState(): PowerState {
  if (platform() !== "darwin") return { source: "unknown", lowPowerMode: null };
  try {
    const battery = execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" });
    const settings = execFileSync("pmset", ["-g"], { encoding: "utf8" });
    const mode = /lowpowermode\s+(\d)/.exec(settings)?.[1];
    return {
      source: battery.includes("'AC Power'")
        ? "ac"
        : battery.includes("'Battery Power'")
          ? "battery"
          : "unknown",
      lowPowerMode: mode === undefined ? null : mode === "1",
    };
  } catch {
    return { source: "unknown", lowPowerMode: null };
  }
}

/**
 * Throws unless the machine runs on AC power without Low Power Mode, which
 * slows every engine and drops WebKit's animation frames to 30 Hz. Measuring
 * scripts call it before the run and between jobs, so a run that loses power
 * stops instead of writing results that cannot be compared.
 */
export function assertMeasurementPower(): PowerState {
  const state = powerState();
  if (process.env.ALLOW_BATTERY || (state.source !== "battery" && !state.lowPowerMode)) {
    return state;
  }
  throw new Error(
    `Not measuring on ${state.source === "battery" ? "battery power" : "Low Power Mode"}: results would not be comparable. Connect AC power, or set ALLOW_BATTERY=1 to measure anyway.`,
  );
}

/**
 * Playwright's Firefox drops a context's deviceScaleFactor when a page first
 * navigates into a cross-origin-isolated process (COOP and COEP), so the page
 * renders at devicePixelRatio 1. Visiting a cross-origin-isolated `url` once
 * and applying the viewport again restores the scale factor for every later
 * navigation of that page. Other browsers need nothing.
 */
export async function restoreScaleFactor(page: Page, url: string): Promise<void> {
  if (page.context().browser()?.browserType().name() !== "firefox") return;
  await page.goto(url);
  const viewport = page.viewportSize();
  if (viewport) await page.setViewportSize(viewport);
}

export interface LaunchOptions {
  /** Runs after every launch, including the relaunch after `measureInTurn` waited. */
  warmUp?: (browser: Browser) => Promise<void>;
}

export interface LaunchedBrowser {
  name: BrowserName;
  /** "Chromium 156.0.8078.4", "WebKit 27.2", or "Firefox 157.0". */
  label: string;
  headless: boolean;
  /**
   * The open browser. `measureInTurn` closes it while it waits and launches
   * another, so read it for each job.
   */
  readonly browser: Browser;
  close(): Promise<void>;
}

/** How `measureInTurn` closes a launched browser while it waits and reopens it. */
const turns = new WeakMap<LaunchedBrowser, { pause(): Promise<void>; resume(): Promise<void> }>();

export async function launchBrowser(
  name: BrowserName = browserFromEnv(),
  options: LaunchOptions = {},
): Promise<LaunchedBrowser> {
  const headless = !process.env.HEADED;
  const open = async () => {
    const opened = await openBrowser(name, headless);
    await options.warmUp?.(opened);
    return opened;
  };
  let current: Browser | null = await open();
  const close = async () => {
    const closing = current;
    current = null;
    await closing?.close();
  };
  const launched: LaunchedBrowser = {
    name,
    label: `${browserLabels[name]} ${current.version()}`,
    headless,
    get browser() {
      if (!current) throw new Error(`${browserLabels[name]} is closed`);
      return current;
    },
    async close() {
      // A check that threw leaves its pages open where it stopped.
      if (current) await captureFailure("open at close", current);
      await Promise.all(pendingCaptures);
      await close();
    },
  };
  turns.set(launched, {
    pause: close,
    resume: async () => {
      current ??= await open();
    },
  });
  return launched;
}

async function openBrowser(name: BrowserName, headless: boolean): Promise<Browser> {
  let browser: Browser;
  if (name === "chromium") {
    // Headless Chromium falls back to SwiftShader unless ANGLE is pointed at the
    // real GPU; without this, GPU-backed canvases are meaningless.
    const gpuArgs =
      platform() === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : ["--enable-gpu"];
    browser = await chromium.launch({ headless, args: ["--ignore-gpu-blocklist", ...gpuArgs] });
  } else if (name === "firefox") {
    // Headless Firefox follows the display's refresh rate (120 Hz on ProMotion
    // Macs); pin it to the 60 Hz that headless Chromium and WebKit use so frame
    // intervals and "visible" times stay comparable.
    const firefoxUserPrefs = { "layout.frame_rate": 60 };
    if (platform() === "darwin") {
      // Firefox reads its profile list from ~/Library/Application Support even
      // when Playwright passes a profile, and macOS may refuse that folder to
      // processes started by another app ("Could not find profile folder").
      // A separate home also keeps the user's own Firefox data untouched. It
      // is reused rather than deleted: macOS marks the Library and Downloads
      // folders it creates there "deny delete", and each launch still gets a
      // fresh profile from Playwright.
      const home = join(tmpdir(), "parapdf-firefox-home");
      mkdirSync(home, { recursive: true });
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      browser = await firefox.launch({
        headless,
        firefoxUserPrefs,
        env: { ...env, CFFIXED_USER_HOME: home },
      });
    } else {
      browser = await firefox.launch({ headless, firefoxUserPrefs });
    }
  } else {
    browser = await webkit.launch({ headless });
  }
  if (diagnostics) recordDiagnostics(browser, diagnostics);
  return browser;
}

// DIAGNOSTICS=<folder> keeps what CI uploads when a check fails: the console
// messages, page errors, and failed requests of every page in <script>.log,
// and screenshots of the open pages when a check fails (`captureFailure`) and
// of those a check that threw left open when its browser closes.

const diagnostics = process.env.DIAGNOSTICS;
const scriptName = basename(process.argv[1] ?? "script", extname(process.argv[1] ?? ""));
const diagnosed = new Set<Browser>();
const pendingCaptures: Promise<unknown>[] = [];
let captures = 0;

function recordDiagnostics(browser: Browser, folder: string): void {
  mkdirSync(folder, { recursive: true });
  diagnosed.add(browser);
  browser.on("disconnected", () => diagnosed.delete(browser));
  const logFile = join(folder, `${scriptName}.log`);
  const log = (page: Page | null, line: string) => {
    const url = page ? new URL(page.url()) : null;
    const where = url ? `${url.pathname}${url.search} ` : "";
    appendFileSync(
      logFile,
      `${new Date().toISOString()} ${browser.browserType().name()} ${where}${line}\n`,
    );
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    context.on("console", (message) => log(message.page(), `${message.type()}: ${message.text()}`));
    context.on("weberror", (error) => log(error.page(), `page error: ${error.error().stack}`));
    context.on("requestfailed", (request) => {
      // Service workers' requests have no frame.
      let page: Page | null = null;
      try {
        page = request.frame().page();
      } catch {}
      log(page, `failed ${request.url()}: ${request.failure()?.errorText}`);
    });
    return context;
  };
}

/**
 * With DIAGNOSTICS set, screenshots every open page, or those of `browser`,
 * as <script>-<n>-<check>-<page>.jpg. A check's failure need not wait for
 * it: the launched browser finishes the screenshots before it closes.
 */
export async function captureFailure(check: string, browser?: Browser): Promise<void> {
  if (!diagnostics) return;
  const n = ++captures;
  const slug = check
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const pages = [...(browser ? [browser] : diagnosed)].flatMap((open) =>
    open.contexts().flatMap((context) => context.pages()),
  );
  const shots = Promise.all(
    pages.map((page, index) =>
      page
        .screenshot({
          path: join(diagnostics, `${scriptName}-${n}-${slug}-${index + 1}.jpg`),
          type: "jpeg",
          scale: "css",
          timeout: 5_000,
        })
        .catch(() => {}),
    ),
  );
  pendingCaptures.push(shots);
  await shots;
}

// Other sessions run Playwright benchmarks on the same machine, and a job
// measured beside another browser competes for its cores and GPU. Measuring
// scripts therefore take turns: a job starts once no other Playwright browser
// is open and runs again if one opened while it ran.

interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

// Full command lines (-ww), which on a busy machine exceed execFile's default buffer.
const PS_ARGS = ["-ww", "-axo", "pid=,ppid=,command="];
const PS_OPTIONS = { encoding: "utf8", maxBuffer: 64 * 2 ** 20 } as const;
const execFileAsync = promisify(execFile);

const ignoredRoots = (process.env.IGNORE_PIDS ?? "").split(",").filter(Boolean).map(Number);

/**
 * Playwright browsers and test runners that other processes started, from a
 * `ps` listing. Browser main processes are children of the script that
 * launched them, so ancestry tells this script's own apart. Their child
 * processes (Chromium's `--type=`, Firefox's `plugin-container`) and WebKit's
 * helpers, which belong to launchd, are skipped; so are the descendants of
 * IGNORE_PIDS, such as a stuck runner's idle browser.
 */
function othersIn(listing: string): string[] {
  const rows: ProcessRow[] = listing.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }]
      : [];
  });
  const parent = new Map(rows.map((row) => [row.pid, row.ppid]));
  const roots = new Set([process.pid, ...ignoredRoots]);
  const ours = (pid: number) => {
    for (let at = pid, depth = 0; at > 1 && depth < 50; at = parent.get(at) ?? 0, depth++) {
      if (roots.has(at)) return true;
    }
    return false;
  };
  const browserMain = (command: string) =>
    (/ms-playwright\/chromium/.test(command) && !command.includes("--type=")) ||
    (/ms-playwright\/firefox/.test(command) &&
      !command.includes("plugin-container") &&
      !command.includes("-contentproc")) ||
    (/ms-playwright\/webkit/.test(command) && !command.includes("com.apple.WebKit."));
  const runner = (command: string) => /@playwright\/test|playwright(-core)?\/cli\.js/.test(command);
  return rows
    .filter((row) => (browserMain(row.command) || runner(row.command)) && !ours(row.pid))
    .map((row) => `${row.pid} ${row.command.slice(0, 140)}`);
}

/** Other Playwright browsers and test runners open on this machine. */
export function otherBrowsers(): string[] {
  return othersIn(execFileSync("ps", PS_ARGS, PS_OPTIONS));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a measurement would compete with right now, or null. */
function busyReason(): string | null {
  const others = otherBrowsers();
  if (others.length > 0) return `other Playwright browsers are open:\n  ${others.join("\n  ")}`;
  const maxLoad = Number(process.env.MAX_LOAD ?? Number.POSITIVE_INFINITY);
  const [load = 0] = loadavg();
  return load > maxLoad
    ? `the load average is ${load.toFixed(1)}, above MAX_LOAD ${maxLoad}`
    : null;
}

/** How often this process waited its turn and repeated a job, for reports. */
export const turnTaking = { waits: 0, waitedMs: 0, repeatedJobs: 0 };

/** One sentence on `turnTaking`, for reports. */
export function turnTakingSummary(): string {
  if (process.env.ALLOW_PARALLEL)
    return "measured beside other Playwright browsers (ALLOW_PARALLEL)";
  const { waits, waitedMs, repeatedJobs } = turnTaking;
  const times = waits === 1 ? "once" : `${waits} times`;
  const jobs = repeatedJobs === 1 ? "1 job" : `${repeatedJobs} jobs`;
  return `waited ${times} (${(waitedMs / 60_000).toFixed(0)} min in all) for other Playwright browsers${process.env.MAX_LOAD ? ` or a load average above ${process.env.MAX_LOAD}` : ""} and repeated ${jobs} that another browser overlapped`;
}

/**
 * Waits until no other Playwright browser is open and, when MAX_LOAD is set,
 * the one-minute load average is at most MAX_LOAD. Says what it waits for
 * once a minute and gives up after two hours.
 */
async function waitForQuietMachine(): Promise<void> {
  const start = Date.now();
  let reported = "";
  for (;;) {
    const reason = busyReason();
    if (!reason) {
      // Scripts waiting for one another see the machine go quiet together; a
      // random pause lets one start first while the others see its browser.
      await sleep(5_000 + Math.random() * 15_000);
      if (!busyReason()) break;
      continue;
    }
    if (Date.now() - start > 2 * 60 * 60_000) throw new Error(`Gave up after two hours: ${reason}`);
    const minute = `${reason.split(":")[0]} ${Math.floor((Date.now() - start) / 60_000)}`;
    if (minute !== reported) {
      reported = minute;
      console.log(`Waiting: ${reason}`);
    }
    await sleep(15_000);
  }
  turnTaking.waits++;
  turnTaking.waitedMs += Date.now() - start;
}

/**
 * Notes whether another Playwright browser opens while a job runs, checking
 * every 3 seconds without blocking the script's own event loop.
 */
function watchForOthers(): { stop(): Promise<boolean> } {
  let seen = false;
  let sampling: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    sampling = sampling
      .then(async () => {
        if (!seen)
          seen = othersIn((await execFileAsync("ps", PS_ARGS, PS_OPTIONS)).stdout).length > 0;
      })
      .catch(() => {});
  }, 3000);
  return {
    async stop() {
      clearInterval(timer);
      await sampling;
      return seen || otherBrowsers().length > 0;
    },
  };
}

/**
 * Runs one measured job in turn with other Playwright scripts on the machine.
 * While another Playwright browser is open (or the load average is above
 * MAX_LOAD, when set) it waits, with its own browser closed so that two
 * waiting scripts never wait for each other's, and relaunches it afterwards.
 * A job another browser overlapped runs again, up to ten times in all. Like
 * `assertMeasurementPower`, it stops the run when AC power is lost.
 * ALLOW_PARALLEL=1 measures without taking turns.
 */
export async function measureInTurn<T>(
  launched: LaunchedBrowser,
  job: (browser: Browser) => Promise<T>,
): Promise<T> {
  const turn = turns.get(launched);
  for (let attempt = 1; ; attempt++) {
    if (!process.env.ALLOW_PARALLEL && busyReason()) {
      await turn?.pause();
      await waitForQuietMachine();
    }
    await turn?.resume();
    assertMeasurementPower();
    if (process.env.ALLOW_PARALLEL) return job(launched.browser);
    const watch = watchForOthers();
    let result: T;
    try {
      result = await job(launched.browser);
    } catch (error) {
      await watch.stop();
      throw error;
    }
    if (!(await watch.stop())) return result;
    if (attempt >= 10) {
      throw new Error(
        "Other Playwright browsers kept overlapping the jobs; set ALLOW_PARALLEL=1 to measure anyway.",
      );
    }
    turnTaking.repeatedJobs++;
    console.log("Another Playwright browser opened during the job; running it again.");
  }
}
