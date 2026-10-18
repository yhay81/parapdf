/**
 * Browser selection shared by every Playwright script in the repository: the
 * engine benchmark and the prototype's scroll benchmark and functional checks,
 * plus the power check the measuring scripts run before and during a run.
 *
 * Environment: BROWSER (chromium, webkit, or firefox; default chromium),
 * HEADED=1 to show the window, ALLOW_BATTERY=1 to measure without AC power.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
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

export interface LaunchedBrowser {
  name: BrowserName;
  /** "Chromium 156.0.8078.4", "WebKit 27.2", or "Firefox 157.0". */
  label: string;
  headless: boolean;
  browser: Browser;
  close(): Promise<void>;
}

export async function launchBrowser(
  name: BrowserName = browserFromEnv(),
): Promise<LaunchedBrowser> {
  const headless = !process.env.HEADED;
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
  return {
    name,
    label: `${browserLabels[name]} ${browser.version()}`,
    headless,
    browser,
    close: () => browser.close(),
  };
}
