/**
 * Reading a page the way a browser does.
 *
 * `Zotero.HTTP.request` is an XMLHttpRequest: it carries no `Sec-Fetch-*`
 * headers, no `Referer`, no navigation flags, and no scripts run. A site that
 * decides who may read it by looking at such things answers that request with
 * a refusal, while the very same URL opens normally in a browser on the very
 * same machine.
 *
 * Google Scholar is exactly that site. Its `429`/`403` answers are a statement
 * about the *client*, not about the address: the front page of the same host
 * answers the same jar with `200` in the same session. So the Scholar read has
 * a second path - a real navigation in a hidden browser, JavaScript and all -
 * and falls back to the request when that is not possible.
 *
 * The hidden browser is Zotero's own, used by translators: `HiddenBrowser.mjs`
 * on Zotero 8 and up, `HiddenBrowser.jsm` on Zotero 7. It shares the
 * application's cookie jar with `Zotero.HTTP`, so the consent cookie and
 * anything Google set are already in hand.
 */

/** What one page load answered. */
export interface PageLoadResult {
  /** The HTTP status, or `null` when the load never produced a response. */
  status: number | null;
  /** The document's HTML, exactly as `documentHTML` reports it. */
  html: string;
  /** Why the load produced nothing, when it did not. */
  error: string | null;
}

/**
 * Loads one URL as a real navigation.
 *
 * Injected in tests, like the request transport: the decision "which path
 * produced this answer" is what has to be tested, not Gecko's loader.
 */
export type PageLoader = (
  url: string,
  timeoutMs: number,
) => Promise<PageLoadResult>;

interface HiddenBrowserInstance {
  load(
    url: string,
    options?: { requireSuccessfulStatus?: boolean },
  ): Promise<boolean>;
  getPageData(props: string[]): Promise<{
    channelInfo?: { responseStatus?: number | null } | null;
    documentHTML?: string | null;
  }>;
  destroy?: () => void;
}

type HiddenBrowserConstructor = new (
  options?: Record<string, unknown>,
) => HiddenBrowserInstance;

interface ChromeUtilsLike {
  importESModule?: (url: string) => unknown;
  import?: (url: string) => unknown;
}

/**
 * Where the hidden browser lives, newest first.
 *
 * Zotero 7 still ships the legacy `.jsm`; Zotero 8 replaced it with an ES
 * module of the same name and the same API, so the only difference is how the
 * module is imported.
 */
/**
 * A phrase from the placeholder document a hidden frame starts out with.
 *
 * It is what is left when a navigation never happened, so it must not be
 * mistaken for an answer.
 */
const BLANK_DOCUMENT_MARKER =
  "This Source Code Form is subject to the terms of the Mozilla Public";

const HIDDEN_BROWSER_MODULES = [
  "chrome://zotero/content/HiddenBrowser.mjs",
  "chrome://zotero/content/HiddenBrowser.jsm",
];

let resolved:
  | { constructor: HiddenBrowserConstructor | null; error: string | null }
  | undefined;

function chromeUtils(): ChromeUtilsLike | null {
  const global = globalThis as unknown as { ChromeUtils?: ChromeUtilsLike };
  if (global.ChromeUtils) return global.ChromeUtils;
  try {
    return typeof ChromeUtils === "object"
      ? (ChromeUtils as ChromeUtilsLike)
      : null;
  } catch {
    return null;
  }
}

function importModule(url: string): unknown {
  const utils = chromeUtils();
  if (!utils) throw new Error("ChromeUtils 不可用");

  if (url.endsWith(".mjs")) {
    if (typeof utils.importESModule !== "function") {
      throw new Error("这个 Zotero 版本没有 ChromeUtils.importESModule");
    }
    return utils.importESModule(url);
  }
  if (typeof utils.import === "function") return utils.import(url);
  throw new Error("这个 Zotero 版本没有 ChromeUtils.import");
}

/**
 * The hidden browser's constructor, or the reason there is none.
 *
 * Resolved once: the failure is not going to fix itself mid-session, and
 * retrying the import on every paper would only slow the read down.
 */
export function hiddenBrowserClass(): {
  constructor: HiddenBrowserConstructor | null;
  error: string | null;
} {
  if (resolved) return resolved;

  const errors: string[] = [];
  for (const url of HIDDEN_BROWSER_MODULES) {
    try {
      const module = importModule(url) as { HiddenBrowser?: unknown };
      const candidate = module?.HiddenBrowser;
      if (typeof candidate === "function") {
        resolved = {
          constructor: candidate as HiddenBrowserConstructor,
          error: null,
        };
        return resolved;
      }
      errors.push(`${url} 里没有 HiddenBrowser`);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : error}`);
    }
  }

  resolved = { constructor: null, error: errors.join("；") };
  return resolved;
}

/** Runs `promise`, giving up (with `null`) once the time is up. */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        // A little past the request timeout: the loader has its own five
        // second ceiling on "the page never loaded at all", and cutting in
        // before that would report a failure that was merely slow.
        timer = setTimeout(() => resolve(null), timeoutMs + 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** What the loader does with a page it has loaded. */
export interface PageLoaderOptions {
  /**
   * How long to leave the page alone, scrolling it, before reading it.
   *
   * A page that is opened and read in the same instant is not how a person
   * reads a search result: they arrive, look down the page, and only then take
   * the number. The wait is also what gives the site's own scripts time to
   * finish filling the result list in. A function is re-read per load.
   */
  dwellMs?: number | (() => number);
}

/**
 * Scrolls the loaded page and waits, the way someone looking for a number in a
 * result list would.
 *
 * The scrolling is best-effort: which object holds the browsing context is a
 * Zotero-internal detail, and a read that cannot reach it should wait and
 * continue rather than fail.
 */
export async function scrollAndSettle(
  browser: HiddenBrowserInstance,
  dwellMs: number,
): Promise<void> {
  if (dwellMs <= 0) return;

  try {
    const holder = browser as unknown as {
      browser?: {
        contentWindow?: { scrollBy?: (x: number, y: number) => void };
      };
      contentWindow?: { scrollBy?: (x: number, y: number) => void };
    };
    const win = holder.browser?.contentWindow ?? holder.contentWindow;
    if (win?.scrollBy) {
      const step = Math.max(200, Math.round(dwellMs / 3));
      win.scrollBy(0, step);
      await Zotero.Promise.delay(Math.round(dwellMs / 3));
      win.scrollBy(0, step);
    }
  } catch {
    // No window to scroll: the wait below is still worth having.
  }

  await Zotero.Promise.delay(Math.max(0, dwellMs - Math.round(dwellMs / 3)));
}

/** The production loader: one hidden browser per page, destroyed afterwards. */
export function createPageLoader(options: PageLoaderOptions = {}): PageLoader {
  return async (url, timeoutMs) => {
    const { constructor, error } = hiddenBrowserClass();
    if (!constructor) {
      return { status: null, html: "", error: error ?? "没有可用的浏览器组件" };
    }

    let browser: HiddenBrowserInstance | null = null;
    try {
      // Scripts on: the point of this path is to look like the browser that
      // the site is willing to answer, and a browser runs them.
      browser = new constructor({ allowJavaScript: true });
      // Zotero 8 and up resolve `load()` to `true`; Zotero 7 resolves to
      // `undefined` even after a page that loaded fine. The document below is
      // therefore what decides whether the navigation happened.
      const loaded = await withTimeout(
        browser.load(url, { requireSuccessfulStatus: false }),
        timeoutMs,
      );
      if (loaded === null) {
        return { status: null, html: "", error: "打开页面超时" };
      }

      // Zotero resolves `load()` when the location changes, which can be a
      // moment before the page-data actor reports the response it got, so the
      // status is asked for again. It is worth having - the report prints it -
      // but it is not what the read depends on.
      const dwellMs = Math.max(
        0,
        typeof options.dwellMs === "function"
          ? options.dwellMs()
          : (options.dwellMs ?? 0),
      );
      await scrollAndSettle(browser, dwellMs);

      let status: number | null = null;
      let html = "";
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const data = await browser.getPageData(["channelInfo", "documentHTML"]);
        status = data?.channelInfo?.responseStatus ?? null;
        html = typeof data?.documentHTML === "string" ? data.documentHTML : "";
        if (status !== null && status !== 0) break;
        await Zotero.Promise.delay(150);
      }
      // A `file:` or `data:` URL has no HTTP status; reporting `0` would look
      // like a response that arrived broken.
      if (status !== null && status <= 0) status = null;

      // What a hidden frame shows when nothing was loaded: an error page
      // arrives with a status and an error message, but a navigation that
      // never happened leaves this placeholder behind, and handing it back as
      // the page would make an empty document look like an answer.
      if (!html.trim() || html.includes(BLANK_DOCUMENT_MARKER)) {
        return { status, html: "", error: "页面没有加载完成" };
      }

      return { status, html, error: null };
    } catch (error) {
      return {
        status: null,
        html: "",
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      try {
        browser?.destroy?.();
      } catch {
        // A browser that refuses to be destroyed is Zotero's problem, not the
        // read's: the document it already handed over stays valid.
      }
    }
  };
}
