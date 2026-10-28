/**
 * Safari on macOS for the Playwright scripts, through `safaridriver`
 * (WebDriver): `BROWSER=safari` gives `launchBrowser()` an object with the
 * part of Playwright's Browser, BrowserContext, Page, Locator, Mouse, and
 * Keyboard that the functional checks use, so that they run unchanged in the
 * Safari people use rather than Playwright's WebKit.
 *
 * Needs Safari's Settings, Developer, "Allow remote automation". Safari runs
 * one automation session in windows of its own: a context is a set of
 * windows (they share storage), a page is a window sized so that its
 * viewport matches, and every command waits for the one before it.
 * `deviceScaleFactor`, `hasTouch`, `isMobile`, init scripts, routes, request
 * and download events, and CDP are not available, and calling them throws.
 * Page errors and console messages are collected inside the page and
 * reported after each command, so those raised before the first command on
 * a newly loaded page are seen only when they reach `window.onerror` after
 * it.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Json = unknown;
type Listener = (value: never) => void;

const port = Number(process.env.SAFARIDRIVER_PORT ?? 4444);
const base = `http://127.0.0.1:${port}`;

async function request(method: string, path: string, body?: Json): Promise<Json> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { value: Json };
  const value = json.value as { error?: string; message?: string } | null;
  if (!response.ok || (value && typeof value === "object" && "error" in value && value.error)) {
    throw new Error(`safaridriver ${method} ${path}: ${value?.error}: ${value?.message}`);
  }
  return json.value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Brings Safari to the front: WebKit treats a window other windows cover as
 * hidden, and a hidden page neither paints nor runs animation frames.
 */
function activate(): void {
  execFileSync("osascript", ["-e", 'tell application "Safari" to activate']);
}

/** Runs WebDriver commands one at a time, each in the window it names. */
class Session {
  id = "";
  version = "";
  private queue: Promise<unknown> = Promise.resolve();
  private window = "";

  async start(): Promise<void> {
    const created = (await request("POST", "/session", {
      capabilities: { alwaysMatch: { browserName: "safari" } },
    })) as { sessionId: string; capabilities: { browserVersion: string } };
    this.id = created.sessionId;
    this.version = created.capabilities.browserVersion;
    await this.send("POST", "/timeouts", { script: 300_000, pageLoad: 120_000, implicit: 0 });
    this.window = (await this.send("GET", "/window")) as string;
  }

  send(method: string, path: string, body?: Json): Promise<Json> {
    return request(method, `/session/${this.id}${path}`, body);
  }

  /** Runs `task` after the commands before it, with `handle` the current window. */
  run<T>(handle: string | null, task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (handle && handle !== this.window) await this.switchTo(handle);
      return task();
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async switchTo(handle: string): Promise<void> {
    await this.send("POST", "/window", { handle });
    this.window = handle;
  }

  forget(handle: string): void {
    if (this.window === handle) this.window = "";
  }

  async end(): Promise<void> {
    await this.send("DELETE", "").catch(() => {});
  }
}

// The page side of `evaluate`: values cross as JSON with markers for what
// JSON drops, and handles stay in a map on the page.
const pageRuntime = `
const R = window.__pwSafari ??= (() => {
  const errors = [], logs = [], handles = new Map();
  let next = 0;
  addEventListener("error", (event) => errors.push(String(event.error?.stack ?? event.message)));
  addEventListener("unhandledrejection", (event) =>
    errors.push(String(event.reason?.stack ?? event.reason)));
  for (const type of ["log", "info", "warn", "error", "debug"]) {
    const original = console[type].bind(console);
    console[type] = (...args) => {
      try { logs.push([type === "warn" ? "warning" : type, args.map(String).join(" ")]); } catch {}
      original(...args);
    };
  }
  const encode = (value) => {
    if (value === undefined) return { u: 1 };
    if (typeof value === "number" && !Number.isFinite(value)) return { n: String(value) };
    if (typeof value === "bigint") return { n: String(value) };
    if (value === null || typeof value !== "object") return { v: value };
    if (Array.isArray(value)) return { a: value.map(encode) };
    if (value instanceof Date) return { v: value.toISOString() };
    if (value instanceof Node || value instanceof Window) return { v: {} };
    // Safari's WebDriver does not keep the order of an object's keys.
    return { o: Object.keys(value).map((key) => [key, encode(value[key])]) };
  };
  const decode = (value) => {
    if (value && typeof value === "object") {
      if ("__h" in value) return handles.get(value.__h);
      if ("__u" in value) return undefined;
      if (Array.isArray(value)) return value.map(decode);
      if ("__o" in value) return Object.fromEntries(value.__o.map(([key, item]) => [key, decode(item)]));
      return value;
    }
    return value;
  };
  const keep = (value) => { const id = ++next; handles.set(id, value); return id; };
  return { errors, logs, handles, encode, decode, keep };
})();
`;

function encodeArg(value: unknown): Json {
  if (value instanceof SafariHandle) return { __h: value.id };
  if (value === undefined) return { __u: 1 };
  if (Array.isArray(value)) return value.map(encodeArg);
  if (value && typeof value === "object") {
    return { __o: Object.entries(value).map(([key, item]) => [key, encodeArg(item)]) };
  }
  return value;
}

type Encoded = { u?: 1; n?: string; v?: unknown; a?: Encoded[]; o?: [string, Encoded][] };

function decodeResult(value: Encoded): unknown {
  if ("u" in value) return undefined;
  if ("n" in value) return Number(value.n);
  if ("a" in value) return value.a?.map(decodeResult);
  if ("o" in value) {
    return Object.fromEntries((value.o ?? []).map(([key, item]) => [key, decodeResult(item)]));
  }
  return value.v;
}

type PageFunction = string | ((...args: never[]) => unknown);

// Like Playwright, a string is an expression, called with the argument when
// it is a function.
const source = (fn: PageFunction): string =>
  typeof fn === "string"
    ? `((arg) => { const f = (${fn}); return typeof f === "function" ? f(arg) : f; })`
    : fn.toString();

/** A value kept on the page, like Playwright's JSHandle. */
class SafariHandle {
  readonly page: SafariPage;
  readonly id: number;
  constructor(page: SafariPage, id: number) {
    this.page = page;
    this.id = id;
  }
  evaluate(fn: PageFunction, arg?: unknown) {
    return this.page.evaluate(`(([h, a]) => (${source(fn)})(h, a))` as never, [this, arg] as never);
  }
  jsonValue() {
    return this.page.evaluate((h: unknown) => h, this as never);
  }
  async dispose() {
    await this.page.evaluate(
      `((id) => window.__pwSafari.handles.delete(id))` as never,
      this.id as never,
    );
  }
}

const keys: Record<string, string> = {
  Enter: "",
  Tab: "",
  Escape: "",
  Backspace: "",
  Delete: "",
  ArrowLeft: "",
  ArrowUp: "",
  ArrowRight: "",
  ArrowDown: "",
  PageUp: "",
  PageDown: "",
  Home: "",
  End: "",
  Shift: "",
  Control: "",
  Alt: "",
  Meta: "",
  ControlOrMeta: "",
  Space: " ",
};

const keyValue = (name: string): string => {
  const value = keys[name] ?? (name.length === 1 ? name : undefined);
  if (value === undefined) throw new Error(`Safari: no WebDriver key for "${name}"`);
  return value;
};

/**
 * Safari ends a drag where an action sequence ends: moves sent in a later
 * sequence do not extend the selection a press started. So from a press to
 * its release the mouse holds its actions, waits included, and sends them as
 * one sequence; any other command in between sends those held so far first,
 * which ends the drag there.
 */
class SafariMouse {
  private x = 0;
  private y = 0;
  private page: SafariPage;
  private held: Json[] | null = null;
  constructor(page: SafariPage) {
    this.page = page;
  }

  static sequence(actions: Json[]): Json[] {
    return [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions }];
  }
  private pointer(actions: Json[]) {
    if (this.held) {
      this.held.push(...actions);
      return Promise.resolve();
    }
    return this.page.perform(SafariMouse.sequence(actions));
  }
  /** The actions held since the press or the last command, if any. */
  takeHeld(): Json[] | null {
    if (!this.held?.length) return null;
    const actions = this.held;
    this.held = [];
    return SafariMouse.sequence(actions);
  }
  /** Holds a wait while the button is down; false when it is not. */
  pause(ms: number): boolean {
    if (!this.held) return false;
    this.held.push({ type: "pause", duration: Math.round(ms) });
    return true;
  }
  private at(x: number, y: number, duration = 0): Json {
    this.x = x;
    this.y = y;
    return {
      type: "pointerMove",
      origin: "viewport",
      x: Math.round(x),
      y: Math.round(y),
      duration,
    };
  }
  async move(x: number, y: number, options: { steps?: number } = {}) {
    const steps = Math.max(1, options.steps ?? 1);
    const fromX = this.x;
    const fromY = this.y;
    const moves: Json[] = [];
    for (let step = 1; step <= steps; step++) {
      moves.push(
        this.at(fromX + ((x - fromX) * step) / steps, fromY + ((y - fromY) * step) / steps, 16),
      );
    }
    await this.pointer(moves);
  }
  private button = (options: { button?: string } = {}) =>
    options.button === "right" ? 2 : options.button === "middle" ? 1 : 0;
  async down(options: { button?: string } = {}) {
    this.held = [this.at(this.x, this.y), { type: "pointerDown", button: this.button(options) }];
  }
  async up(options: { button?: string } = {}) {
    const held = this.held ?? [];
    this.held = null;
    await this.pointer([...held, { type: "pointerUp", button: this.button(options) }]);
  }
  async click(x: number, y: number, options: { button?: string; clickCount?: number } = {}) {
    const button = this.button(options);
    const presses: Json[] = [];
    for (let n = 0; n < (options.clickCount ?? 1); n++) {
      presses.push({ type: "pointerDown", button }, { type: "pointerUp", button });
    }
    await this.pointer([this.at(x, y), ...presses]);
  }
  async dblclick(x: number, y: number) {
    await this.click(x, y, { clickCount: 2 });
  }
  async wheel(deltaX: number, deltaY: number) {
    await this.page.perform([
      {
        type: "wheel",
        id: "wheel",
        actions: [
          {
            type: "scroll",
            origin: "viewport",
            x: Math.round(this.x),
            y: Math.round(this.y),
            deltaX: Math.round(deltaX),
            deltaY: Math.round(deltaY),
          },
        ],
      },
    ]);
  }
}

class SafariKeyboard {
  private page: SafariPage;
  constructor(page: SafariPage) {
    this.page = page;
  }
  private keys(actions: Json[]) {
    return this.page.perform([{ type: "key", id: "keyboard", actions }]);
  }
  async press(combo: string) {
    const parts = combo === "+" ? ["+"] : combo.split("+");
    const values = parts.map(keyValue);
    await this.keys([
      ...values.map((value) => ({ type: "keyDown", value })),
      ...values.reverse().map((value) => ({ type: "keyUp", value })),
    ]);
  }
  async down(key: string) {
    await this.keys([{ type: "keyDown", value: keyValue(key) }]);
  }
  async up(key: string) {
    await this.keys([{ type: "keyUp", value: keyValue(key) }]);
  }
  async type(text: string) {
    await this.keys(
      [...text].flatMap((value) => [
        { type: "keyDown", value },
        { type: "keyUp", value },
      ]),
    );
  }
  async insertText(text: string) {
    await this.type(text);
  }
}

type Step =
  | { css: string; hasText?: string }
  | { role: string; name?: string | RegExp; exact?: boolean }
  | { nth: number }
  | { and: Step[] };

// Finds the elements of a locator's steps on the page: CSS, or a role with an
// accessible name computed the way the checks need (aria-label,
// aria-labelledby, a label, the title, or the text).
const resolveSteps = `function resolve(steps) {
  const implicit = {
    button: 'button, input[type=button], input[type=submit], input[type=reset], summary',
    link: 'a[href]', checkbox: 'input[type=checkbox]', radio: 'input[type=radio]',
    form: 'form', region: 'section[aria-label], section[aria-labelledby]', group: 'fieldset', toolbar: '[role=toolbar]', document: '[role=document]',
    textbox: 'input:not([type]), input[type=text], input[type=search], input[type=email], input[type=password], input[type=number], textarea',
    searchbox: 'input[type=search]', combobox: 'select', listbox: 'select[multiple]',
    heading: 'h1, h2, h3, h4, h5, h6', option: 'option', img: 'img[alt]', slider: 'input[type=range]',
    spinbutton: 'input[type=number]', dialog: 'dialog', navigation: 'nav', list: 'ul, ol', listitem: 'li',
  };
  const name = (el) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    if (el.labels?.length) return [...el.labels].map((l) => l.textContent).join(' ');
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
    if (el instanceof HTMLImageElement) return el.alt;
    return el.textContent || el.getAttribute('title') || '';
  };
  const hidden = (el) => el.closest('[hidden], [aria-hidden=true]') || getComputedStyle(el).visibility === 'hidden';
  const matches = (text, wanted, exact) => {
    const clean = text.replace(/\\s+/g, ' ').trim();
    if (wanted && typeof wanted === 'object') return new RegExp(wanted.source, wanted.flags).test(clean);
    return exact ? clean === wanted : clean.toLowerCase().includes(String(wanted).toLowerCase());
  };
  let found = [document];
  for (const step of steps) {
    if ('and' in step) { const also = new Set(resolve(step.and)); found = found.filter((el) => also.has(el)); continue; }
    if ('nth' in step) { const at = step.nth < 0 ? found.length + step.nth : step.nth; found = found[at] ? [found[at]] : []; continue; }
    const within = (root) => {
      if ('css' in step) return [...root.querySelectorAll(step.css)].filter((el) => step.hasText === undefined || (el.textContent ?? '').includes(step.hasText));
      const selector = '[role="' + step.role + '"]' + (implicit[step.role] ? ', ' + implicit[step.role] : '');
      return [...root.querySelectorAll(selector)].filter((el) => {
        const role = el.getAttribute('role');
        if (role && role !== step.role) return false;
        if (hidden(el)) return false;
        return step.name === undefined || matches(name(el), step.name, step.exact);
      });
    };
    found = [...new Set(found.flatMap(within))];
  }
  return found;
}`;

class SafariLocator {
  readonly page: SafariPage;
  readonly steps: Step[];
  constructor(page: SafariPage, steps: Step[]) {
    this.page = page;
    this.steps = steps;
  }
  locator(css: string, options: { hasText?: string } = {}) {
    return new SafariLocator(this.page, [...this.steps, { css, ...options }]);
  }
  getByRole(role: string, options: { name?: string | RegExp; exact?: boolean } = {}) {
    return new SafariLocator(this.page, [...this.steps, { role, ...options }]);
  }
  first() {
    return new SafariLocator(this.page, [...this.steps, { nth: 0 }]);
  }
  last() {
    return new SafariLocator(this.page, [...this.steps, { nth: -1 }]);
  }
  nth(index: number) {
    return new SafariLocator(this.page, [...this.steps, { nth: index }]);
  }
  and(other: SafariLocator) {
    return new SafariLocator(this.page, [...this.steps, { and: other.steps }]);
  }
  private wire(steps = this.steps): Json[] {
    return steps.map((step) =>
      "and" in step
        ? { and: this.wire(step.and) }
        : "name" in step && step.name instanceof RegExp
          ? { ...step, name: { source: step.name.source, flags: step.name.flags } }
          : step,
    );
  }
  evaluateAll(fn: PageFunction, arg?: unknown) {
    return this.page.evaluate(
      `(([steps, arg]) => (${source(fn)})((${resolveSteps})(steps), arg))` as never,
      [this.wire(), arg] as never,
    );
  }
  evaluate(fn: PageFunction, arg?: unknown) {
    return this.one(`(el, arg) => (${source(fn)})(el, arg)`, arg);
  }
  /** Evaluates `fn` with the one element the locator finds, waiting for it. */
  private async one<T>(fn: string, arg?: unknown, timeout = 30_000): Promise<T> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const result = (await this.page.evaluate(
        `(async ([steps, arg]) => {
          const found = (${resolveSteps})(steps);
          if (found.length !== 1) return { count: found.length };
          return { value: await (${fn})(found[0], arg) };
        })` as never,
        [this.wire(), arg] as never,
      )) as { count?: number; value?: T };
      if (result.count === undefined) return result.value as T;
      if (result.count > 1) {
        throw new Error(`Safari: locator ${JSON.stringify(this.steps)} found ${result.count}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`Safari: locator ${JSON.stringify(this.steps)} found nothing`);
      }
      await sleep(100);
    }
  }
  count() {
    return this.page.evaluate(
      `((steps) => (${resolveSteps})(steps).length)` as never,
      this.wire() as never,
    ) as Promise<number>;
  }
  boundingBox() {
    return this.one<{ x: number; y: number; width: number; height: number } | null>(
      `(el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }`,
    );
  }
  getAttribute(name: string) {
    return this.one<string | null>("(el, name) => el.getAttribute(name)", name);
  }
  textContent() {
    return this.one<string | null>("(el) => el.textContent");
  }
  isVisible() {
    return this.page.evaluate(
      `((steps) => (${resolveSteps})(steps).some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }))` as never,
      this.wire() as never,
    ) as Promise<boolean>;
  }
  isChecked() {
    return this.one<boolean>("(el) => el.checked");
  }
  inputValue() {
    return this.one<string>("(el) => el.value");
  }
  async focus() {
    await this.one("(el) => el.focus()");
  }
  async waitFor(options: { state?: string; timeout?: number } = {}) {
    const deadline = Date.now() + (options.timeout ?? 30_000);
    const wanted = options.state ?? "visible";
    for (;;) {
      const visible = await this.isVisible();
      const count = await this.count();
      if (
        (wanted === "visible" && visible) ||
        (wanted === "attached" && count > 0) ||
        (wanted === "hidden" && !visible) ||
        (wanted === "detached" && count === 0)
      ) {
        return;
      }
      if (Date.now() > deadline) throw new Error(`Safari: locator never ${wanted}`);
      await sleep(100);
    }
  }
  /**
   * Where to click the element, like Playwright: scrolled into view if it is not, still
   * for two animation frames, and the element (or one inside it) under the
   * point.
   */
  private async center() {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const point = await this.one<{ x: number; y: number; hit: boolean }>(
        `async (el) => {
          // Scrolls only when needed, as Playwright does: a check measures
          // where the reader left the viewer.
          el.scrollIntoViewIfNeeded(true);
          const frame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 100); });
          let r = el.getBoundingClientRect();
          for (let still = 0; still < 2; ) {
            await frame();
            const next = el.getBoundingClientRect();
            still = next.x === r.x && next.y === r.y && next.width === r.width ? still + 1 : 0;
            r = next;
          }
          const x = r.x + r.width / 2;
          const y = r.y + r.height / 2;
          const top = document.elementFromPoint(x, y);
          return { x, y, hit: !!top && (el === top || el.contains(top)) };
        }`,
      );
      if (point.hit || Date.now() > deadline) return point;
      await sleep(100);
    }
  }

  async click(options: { button?: string; clickCount?: number; modifiers?: string[] } = {}) {
    const { x, y } = await this.center();
    const modifiers = options.modifiers ?? [];
    for (const key of modifiers) await this.page.keyboard.down(key);
    await this.page.mouse.click(x, y, options);
    for (const key of modifiers.reverse()) await this.page.keyboard.up(key);
  }
  async dblclick() {
    await this.click({ clickCount: 2 });
  }
  async hover() {
    const { x, y } = await this.center();
    await this.page.mouse.move(x, y);
  }
  async check() {
    if (!(await this.isChecked())) await this.click();
  }
  async uncheck() {
    if (await this.isChecked()) await this.click();
  }
  async press(key: string) {
    await this.focus();
    await this.page.keyboard.press(key);
  }
  async fill(value: string) {
    // Like Playwright: the value replaces the selected text in one input.
    await this.one(
      `(el, value) => {
        el.focus();
        el.select?.();
        if (value) document.execCommand('insertText', false, value);
        else document.execCommand('delete');
      }`,
      value,
    );
  }
  async selectOption(value: string | { label?: string; value?: string }) {
    await this.one(
      `(el, wanted) => {
        const option = [...el.options].find((o) =>
          typeof wanted === 'string' ? o.value === wanted || o.label === wanted
            : (wanted.value === undefined || o.value === wanted.value) && (wanted.label === undefined || o.label === wanted.label));
        if (!option) throw new Error('no option ' + JSON.stringify(wanted));
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      value,
    );
  }
  async scrollIntoViewIfNeeded() {
    await this.one("(el) => el.scrollIntoView({ block: 'center' })");
  }
}

interface ContextOptions {
  viewport?: { width: number; height: number } | null;
  deviceScaleFactor?: number;
  hasTouch?: boolean;
  isMobile?: boolean;
}

const unsupported = (what: string) => () => {
  throw new Error(`Safari through WebDriver has no ${what}`);
};

class SafariPage {
  readonly mouse = new SafariMouse(this);
  readonly keyboard = new SafariKeyboard(this);
  private listeners = new Map<string, Set<Listener>>();
  private viewport: { width: number; height: number } | null;
  private address = "about:blank";
  closed = false;

  private session: Session;
  readonly handle: string;
  readonly owner: SafariContext;

  constructor(
    session: Session,
    handle: string,
    owner: SafariContext,
    viewport: { width: number; height: number } | null,
  ) {
    this.session = session;
    this.handle = handle;
    this.owner = owner;
    this.viewport = viewport;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Safari: the page is closed"));
    const held = this.mouse.takeHeld();
    return this.session.run(this.handle, async () => {
      if (held) {
        activate();
        await this.session.send("POST", "/actions", { actions: held });
      }
      return task();
    });
  }

  perform(actions: Json[]) {
    return this.run(async () => {
      // Safari drops the actions of a window that is not the key window.
      activate();
      await this.session.send("POST", "/actions", { actions });
    });
  }

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
    return this;
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  removeListener(event: string, listener: Listener) {
    return this.off(event, listener);
  }
  private emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? [])
      (listener as (v: unknown) => void)(value);
    this.owner.emit(event, value);
  }

  private report(errors: string[], logs: [string, string][]) {
    for (const stack of errors) {
      const error = new Error(stack.split("\n")[0]);
      error.stack = stack;
      this.emit("pageerror", error);
    }
    for (const [type, text] of logs) {
      this.emit("console", { type: () => type, text: () => text, page: () => this });
    }
  }

  async evaluate(fn: PageFunction, arg?: unknown): Promise<unknown> {
    const script = `
      const done = arguments[arguments.length - 1];
      ${pageRuntime}
      const finish = (out) => done({ ...out, errors: R.errors.splice(0), logs: R.logs.splice(0), href: location.href, hidden: document.visibilityState === "hidden" });
      Promise.resolve()
        .then(() => (${source(fn)})(R.decode(arguments[0])))
        .then((value) => finish({ value: arguments[1] ? { v: R.keep(value) } : R.encode(value) }),
              (error) => finish({ error: String(error?.stack ?? error), message: String(error?.message ?? error) }));`;
    return this.evaluateScript(script, [encodeArg(arg), false]);
  }

  async evaluateHandle(fn: PageFunction, arg?: unknown): Promise<SafariHandle> {
    const script = `
      const done = arguments[arguments.length - 1];
      ${pageRuntime}
      const finish = (out) => done({ ...out, errors: R.errors.splice(0), logs: R.logs.splice(0), href: location.href, hidden: document.visibilityState === "hidden" });
      Promise.resolve()
        .then(() => (${source(fn)})(R.decode(arguments[0])))
        .then((value) => finish({ value: { v: R.keep(value) } }),
              (error) => finish({ error: String(error?.stack ?? error), message: String(error?.message ?? error) }));`;
    const id = (await this.evaluateScript(script, [encodeArg(arg), true])) as number;
    return new SafariHandle(this, id);
  }

  private async evaluateScript(script: string, args: Json[]): Promise<unknown> {
    const out = (await this.run(() =>
      this.session.send("POST", "/execute/async", { script, args }),
    )) as {
      value?: Encoded;
      error?: string;
      message?: string;
      errors: string[];
      logs: [string, string][];
      href: string;
      hidden: boolean;
    };
    this.address = out.href;
    if (out.hidden) activate();
    this.report(out.errors, out.logs);
    if (out.error !== undefined) {
      const error = new Error(out.message);
      error.stack = out.error;
      throw error;
    }
    return decodeResult(out.value as Encoded);
  }

  async waitForFunction(
    fn: PageFunction,
    arg?: unknown,
    options: { timeout?: number; polling?: number | "raf" } = {},
  ): Promise<SafariHandle> {
    const timeout = options.timeout ?? 30_000;
    const polling = options.polling ?? "raf";
    const deadline = Date.now() + timeout;
    // Waits on the page in slices, so that other pages' commands and page
    // errors get through between them.
    for (;;) {
      const slice = Math.min(2_000, Math.max(0, deadline - Date.now()));
      const ok = (await this.evaluate(
        `(async ([arg, slice, polling]) => {
          const test = ${source(fn)};
          const end = performance.now() + slice;
          for (;;) {
            const value = await test(arg);
            if (value) return true;
            if (performance.now() > end) return false;
            // A hidden page runs no animation frames: poll its timers then.
            await new Promise((r) => {
              if (polling === 'raf') requestAnimationFrame(() => r());
              setTimeout(r, polling === 'raf' ? 100 : polling);
            });
          }
        })` as never,
        [arg, slice, polling] as never,
      )) as boolean;
      if (ok) return this.evaluateHandle(fn, arg);
      if (Date.now() >= deadline) {
        throw new Error(
          `Safari: waitForFunction timed out after ${timeout} ms: ${source(fn).slice(0, 200)}`,
        );
      }
    }
  }

  async waitForSelector(selector: string, options: { state?: string; timeout?: number } = {}) {
    await this.locator(selector).waitFor(options);
  }

  waitForTimeout(ms: number) {
    return this.mouse.pause(ms) ? Promise.resolve() : sleep(ms);
  }

  async goto(url: string) {
    await this.run(() => this.session.send("POST", "/url", { url }));
    this.address = url;
    // Starts collecting errors and console messages as soon as it loads.
    await this.evaluate(() => 0);
    return null;
  }

  async reload() {
    await this.run(() => this.session.send("POST", "/refresh", {}));
    await this.evaluate(() => 0);
    return null;
  }

  url() {
    return this.address;
  }

  title() {
    return this.evaluate(() => document.title) as Promise<string>;
  }

  viewportSize() {
    return this.viewport;
  }

  async setViewportSize(size: { width: number; height: number }) {
    this.viewport = size;
    await this.run(async () => {
      // The window's frame differs from its viewport by Safari's toolbars.
      let width = size.width;
      let height = size.height;
      for (let attempt = 0; attempt < 4; attempt++) {
        await this.session.send("POST", "/window/rect", { width, height, x: 0, y: 0 });
        const inner = (await this.session.send("POST", "/execute/sync", {
          script: "return [innerWidth, innerHeight]",
          args: [],
        })) as [number, number];
        if (inner[0] === size.width && inner[1] === size.height) return;
        width += size.width - inner[0];
        height += size.height - inner[1];
      }
      throw new Error(`Safari: cannot size the viewport to ${size.width}x${size.height}`);
    });
  }

  async bringToFront() {
    await this.run(async () => {});
  }

  async screenshot(
    options: { path?: string; clip?: { x: number; y: number; width: number; height: number } } = {},
  ) {
    const data = (await this.run(() => this.session.send("GET", "/screenshot"))) as string;
    let bytes = Buffer.from(data, "base64");
    const { clip } = options;
    if (clip) {
      // The screenshot has the display's pixels; sips crops it to the clip's.
      const ratio = (await this.evaluate(() => devicePixelRatio)) as number;
      const file = join(tmpdir(), `parapdf-safari-${process.pid}-${Date.now()}.png`);
      writeFileSync(file, bytes);
      const px = (value: number) => String(Math.max(1, Math.round(value * ratio)));
      execFileSync(
        "sips",
        [
          "--cropToHeightWidth",
          px(clip.height),
          px(clip.width),
          "--cropOffset",
          px(clip.y),
          px(clip.x),
          file,
        ],
        { stdio: "ignore" },
      );
      bytes = readFileSync(file);
      rmSync(file);
    }
    if (options.path) writeFileSync(options.path, bytes);
    return bytes;
  }

  locator(css: string, options: { hasText?: string } = {}) {
    return new SafariLocator(this, [{ css, ...options }]);
  }
  getByRole(role: string, options: { name?: string | RegExp; exact?: boolean } = {}) {
    return new SafariLocator(this, [{ role, ...options }]);
  }

  context() {
    return this.owner;
  }

  isClosed() {
    return this.closed;
  }

  async close() {
    if (this.closed) return;
    const browser = this.owner.browser();
    if (browser.lastWindow()) {
      // Closing Safari's last window would end the session: keep it blank.
      await this.goto("about:blank");
      browser.spareWindow(this.handle);
    } else {
      await this.run(async () => {
        await this.session.send("DELETE", "/window");
        this.session.forget(this.handle);
      });
    }
    browser.windows--;
    this.closed = true;
    this.owner.removePage(this);
    this.emit("close", this);
  }

  route = unsupported("request routing");
  unroute = unsupported("request routing");
  waitForRequest = unsupported("request events");
  waitForResponse = unsupported("response events");
  waitForEvent = unsupported("page events");
  addInitScript = unsupported("init scripts");
}

class SafariContext {
  private open = new Set<SafariPage>();
  private listeners = new Map<string, Set<Listener>>();

  private session: Session;
  private owner: SafariBrowser;
  private options: ContextOptions;

  constructor(session: Session, owner: SafariBrowser, options: ContextOptions) {
    this.session = session;
    this.owner = owner;
    this.options = options;
    if (options.hasTouch || options.isMobile) {
      throw new Error("Safari on macOS through WebDriver has no touch input");
    }
  }

  async newPage(): Promise<SafariPage> {
    const handle = await this.owner.takeWindow();
    const page = new SafariPage(
      this.session,
      handle,
      this,
      this.options.viewport === undefined ? { width: 1280, height: 720 } : this.options.viewport,
    );
    this.open.add(page);
    const viewport = page.viewportSize();
    if (viewport) await page.setViewportSize(viewport);
    await page.goto("about:blank");
    const ratio = (await page.evaluate(() => devicePixelRatio)) as number;
    const wanted = this.options.deviceScaleFactor;
    if (wanted !== undefined && wanted !== ratio) {
      throw new Error(`Safari: the display's devicePixelRatio is ${ratio}, not ${wanted}`);
    }
    return page;
  }

  pages() {
    return [...this.open];
  }
  removePage(page: SafariPage) {
    this.open.delete(page);
  }
  browser() {
    return this.owner;
  }
  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
    return this;
  }
  emit(event: string, value: unknown) {
    const mapped = event === "pageerror" ? "weberror" : event;
    for (const listener of this.listeners.get(mapped) ?? []) {
      (listener as (v: unknown) => void)(
        mapped === "weberror" ? { error: () => value, page: () => null } : value,
      );
    }
  }
  async close() {
    for (const page of [...this.open]) await page.close();
    this.owner.removeContext(this);
  }
  async grantPermissions() {}
  async clearCookies() {}
  addInitScript = unsupported("init scripts");
  route = unsupported("request routing");
  newCDPSession = unsupported("CDP");
  waitForEvent = unsupported("context events");
}

export class SafariBrowser {
  private open = new Set<SafariContext>();
  private spare: string | null = null;
  private listeners = new Map<string, Set<Listener>>();

  private session: Session;
  private driver: ChildProcess;
  private constructor(session: Session, driver: ChildProcess) {
    this.session = session;
    this.driver = driver;
  }

  static async launch(): Promise<SafariBrowser> {
    const driver = spawn("safaridriver", ["-p", String(port)], { stdio: "ignore" });
    const session = new Session();
    for (let attempt = 0; ; attempt++) {
      try {
        await session.start();
        break;
      } catch (error) {
        if (attempt > 30 || String(error).includes("remote automation")) {
          driver.kill();
          throw error;
        }
        await sleep(200);
      }
    }
    activate();
    const browser = new SafariBrowser(session, driver);
    browser.spare = (await session.run(null, () => session.send("GET", "/window"))) as string;
    return browser;
  }

  windows = 0;

  lastWindow() {
    return this.windows === 1 && this.spare === null;
  }
  spareWindow(handle: string) {
    this.spare = handle;
  }

  /** A window kept from a closed page, or a new one. */
  async takeWindow(): Promise<string> {
    this.windows++;
    if (this.spare) {
      const handle = this.spare;
      this.spare = null;
      return handle;
    }
    const created = (await this.session.run(null, async () => {
      // A new window needs a current one, which a closed page may have been.
      const [open] = (await this.session.send("GET", "/window/handles")) as string[];
      if (open) await this.session.switchTo(open);
      return this.session.send("POST", "/window/new", { type: "window" });
    })) as { handle: string };
    return created.handle;
  }

  version() {
    return this.session.version;
  }
  browserType() {
    return { name: () => "webkit" };
  }
  async newContext(options: ContextOptions = {}) {
    const context = new SafariContext(this.session, this, options);
    this.open.add(context);
    return context;
  }
  async newPage(options: ContextOptions = {}) {
    return (await this.newContext(options)).newPage();
  }
  contexts() {
    return [...this.open];
  }
  removeContext(context: SafariContext) {
    this.open.delete(context);
  }
  isConnected() {
    return true;
  }
  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
    return this;
  }
  async close() {
    await this.session.end();
    this.driver.kill();
    for (const listener of this.listeners.get("disconnected") ?? []) (listener as () => void)();
  }
}
