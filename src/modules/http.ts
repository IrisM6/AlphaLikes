/**
 * HTTP access with per-host serialisation and per-host pacing.
 *
 * arXiv asks for at least three seconds between API calls and Google Scholar
 * blocks reads that come too fast, while the other providers are happy with the
 * configured interval, so the delay is chosen per host rather than globally.
 *
 * The queue is per host for the same reason. A single queue made every read
 * wait for whatever was in front of it, and a Google read is the slowest thing
 * this plugin does: a page load, a five second spacing, retries, and a
 * refusal that books a wait. The like counts - one request to alphaXiv, a site
 * that answers in a moment - were stuck behind all of it, so the column sat on
 * its loading marker while an unrelated citation lookup finished. The two are
 * independent reads of two different sites and now queue independently; within
 * one host nothing changes, which is where the pacing has to hold.
 */

import pkg from "../../package.json";
import { CITATION_REJECTED_STATUSES } from "./citations";
import {
  ARXIV_API_INTERVAL_MS,
  GOOGLE_SCHOLAR_HOME,
  GOOGLE_SCHOLAR_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
} from "./constants";
import { createPageLoader, type PageLoader, type PageLoadResult } from "./page";

/**
 * How a request is actually sent.
 *
 * `Zotero.HTTP.request` in production; tests inject their own so the shape of
 * a request (headers, cookies, the status that comes back) can be asserted
 * without a network - which matters most for Google Scholar, whose answer
 * depends on the address the request comes from.
 */
export type HttpTransport = (
  method: string,
  url: string,
  options: Record<string, unknown>,
) => Promise<{
  status: number;
  // `XMLHttpRequest.responseText` is `string | null`, and a real transport is
  // whatever Zotero hands back, so the shape matches that rather than a tidier
  // one of our own.
  response?: string | null;
  responseText?: string | null;
}>;

export interface RequesterOptions {
  timeoutMs: number;
  intervalMs: number;
  /** Defaults to `Zotero.HTTP.request`, bound to its owner. */
  transport?: HttpTransport;
  /** Defaults to Zotero's hidden browser; injected in tests. */
  pageLoader?: PageLoader;
}

/**
 * Binds a transport so that the receiver survives being passed around.
 *
 * `Zotero.HTTP.request` is a method of `Zotero.HTTP`, not a free function:
 * inside it, `this` carries `_requestInternal`, the exception constructors and
 * `isWriteMethod`. Passing the bare reference to a variable and calling it left
 * `this` undefined, so *every* request threw before any network traffic - the
 * likes and the Scholar reads broke in the same release - and the tests did not
 * see it, because they inject a transport and never touch the default one.
 */
export function bindTransport(host: { request: HttpTransport }): HttpTransport {
  return (method, url, options) => host.request(method, url, options);
}

interface PacingState {
  lastStartedAt: number;
}

/** How a Scholar page was fetched. */
export type ScholarPath = "browser" | "xhr";

/** One attempt at a Scholar search, in the form the report needs. */
export interface ScholarAttempt {
  via: ScholarPath;
  status: number | null;
  error: string | null;
  bytes: number;
  bodyHead: string;
  /**
   * Whether this attempt delivered a page that can be judged.
   *
   * Not the same as "2xx": a page that arrived is an answer whatever the
   * actor reports, and Google's refusals arrive as pages too - what they say
   * is decided by their content, not by the number.
   */
  usable: boolean;
}

export interface ScholarPage {
  /** The status to judge the read by; `0` when neither path got an answer. */
  status: number;
  /** The page body of the path that worked, or `""`. */
  body: string;
  /** Which path produced `body`, or `null` when both failed. */
  via: ScholarPath | null;
  attempts: ScholarAttempt[];
}

/** How much of a response body the report quotes. */
const BODY_HEAD_LIMIT = 160;

/** The opening characters of a response body, whitespace collapsed. */
export function trimBodyHead(body: string): string {
  const clean = (body || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > BODY_HEAD_LIMIT
    ? `${clean.slice(0, BODY_HEAD_LIMIT)}…`
    : clean;
}

/** What the session's opening request to Google answered. */
export interface WarmupResult {
  status: number | null;
  error: string | null;
}

const USER_AGENT = `${pkg.config.addonName}/${pkg.version}`;

/** Hosts that answer a non-browser agent with a block or a consent page. */
export function isGoogleHost(host: string): boolean {
  return /(^|\.)google\.(com|de|fr|co\.uk|es|it|nl|at|ch|jp|cn|com\.hk|com\.tw|com\.br|ca|com\.au)$/i.test(
    host,
  );
}

/**
 * The User-Agent a request goes out with.
 *
 * The APIs get an honest `AlphaLikes/<version>` token, because that is what
 * arXiv and OpenAlex ask for and it lets them throttle by client rather than
 * by address. Google is different: Scholar answers an unfamiliar agent with
 * the "your computer or network may be sending automated queries" page even
 * when the same request from a browser on the same machine is fine, so those
 * requests carry the very same User-Agent Zotero itself sends when it renders
 * a page.
 */
/**
 * The Gecko version this Zotero is built on, e.g. `140`.
 *
 * Zotero 7 runs Gecko 115, Zotero 9 runs 140. An agent string that names an
 * engine the client is not running is itself a signal - Firefox 115 does not
 * send `Sec-Fetch-*` headers, so claiming to be it while talking like a modern
 * browser is worse than saying nothing - so the version is taken from the
 * application rather than written down here.
 */
export function geckoMajorVersion(): number | null {
  try {
    const version = String(
      (Services as unknown as { appinfo?: { platformVersion?: string } })
        ?.appinfo?.platformVersion ?? "",
    );
    const major = Number.parseInt(version.split(".")[0], 10);
    return Number.isFinite(major) && major >= 100 ? major : null;
  } catch {
    return null;
  }
}

/** Rewrites a Firefox User-Agent to the engine version in use. */
export function matchGeckoVersion(agent: string, major: number | null): string {
  if (!major || major < 100) return agent;
  return agent
    .replace(/rv:\d+\.\d+/i, `rv:${major}.0`)
    .replace(/Firefox\/\d+\.\d+/i, `Firefox/${major}.0`);
}

/**
 * The User-Agent a Google request goes out with.
 *
 * Zotero's own window reports the real agent of the running engine, which is
 * also what the user's own browser-less sessions look like; the version is
 * forced to the engine actually in use so the string cannot contradict the
 * headers around it.
 */
export function browserUserAgent(): string {
  const major = geckoMajorVersion();

  try {
    const agent = Zotero.getMainWindow()?.navigator?.userAgent;
    if (agent && /Firefox\//.test(agent))
      return matchGeckoVersion(agent, major);
  } catch {
    // Fall through to the static string below.
  }

  return matchGeckoVersion(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) " +
      "Gecko/20100101 Firefox/115.0",
    major,
  );
}

export function userAgentFor(host: string): string {
  if (!isGoogleHost(host)) return USER_AGENT;
  return browserUserAgent();
}

/**
 * The headers a Firefox navigation sends.
 *
 * A request carrying only `Accept` and `User-Agent` is not what a browser
 * sends; Google's abuse checks look at the difference. `Sec-Fetch-Site` is
 * `none` for the first navigation of a session and `same-origin` for a search
 * that follows the site's own front page, with the matching `Referer`.
 */
export function browserHeaders(
  userAgent: string,
  accept: string,
  options: { language?: string; referer?: string; site?: string } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": userAgent,
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": options.site ?? "same-origin",
    "Sec-Fetch-User": "?1",
  };
  if (options.language) headers["Accept-Language"] = options.language;
  if (options.referer) headers.Referer = options.referer;
  return headers;
}

/** The names of the cookies Zotero holds for `host` (the diagnostic lists them). */
export function cookieNames(host: string): string[] {
  try {
    const jar = Services.cookies.getCookiesFromHost(
      host,
      {},
    ) as unknown as Array<{ name: string }>;

    return [...new Set(jar.map((cookie) => String(cookie.name)))].sort();
  } catch {
    return [];
  }
}

/** Whether Google's consent cookie is in Zotero's own cookie jar. */
export function googleConsentStored(): boolean {
  try {
    const jar = Services.cookies.getCookiesFromHost(
      "scholar.google.com",
      {},
    ) as unknown as Array<{ name: string; value: string }>;

    return jar.some(
      (cookie) =>
        cookie.name === GOOGLE_CONSENT_COOKIE.name &&
        cookie.value === GOOGLE_CONSENT_COOKIE.value,
    );
  } catch {
    return false;
  }
}

/**
 * The consent cookie that stops Google's EU interstitial.
 *
 * `SOCS=CAI` is what a browser stores when the visitor dismisses the dialog;
 * it is not tied to an account, and Scholar will not serve results inside the
 * EU without it.
 */
const GOOGLE_CONSENT_COOKIE = { name: "SOCS", value: "CAI" } as const;
let googleConsentSet = false;

/**
 * Puts Google's consent cookie in Zotero's own cookie jar.
 *
 * Without it, a request from inside the EU (and from anywhere without a saved
 * choice) is answered with "Before you continue to Google", which carries no
 * results at all. The cookie is set through the cookie service because an XHR
 * silently drops a `Cookie` request header.
 */
export function ensureGoogleConsent(): boolean {
  if (googleConsentSet) return true;

  try {
    const cookies = Services?.cookies;
    if (!cookies) return false;

    const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
    // The typing of `add()` follows the raw IDL, whose last two arguments are
    // plain jsval objects; the same-site constant is not part of the typings.
    const add = (
      cookies as unknown as {
        add(
          host: string,
          path: string,
          name: string,
          value: string,
          secure: boolean,
          httpOnly: boolean,
          session: boolean,
          expiry: number,
          originAttributes: unknown,
          sameSite: number,
          schemeMap: unknown,
        ): void;
      }
    ).add.bind(cookies);

    for (const host of [".google.com", "scholar.google.com"]) {
      // 2 is the nsICookie same-site value `lax`, which is what a browser
      // stores for a preference cookie of this kind.
      add(
        host,
        "/",
        GOOGLE_CONSENT_COOKIE.name,
        GOOGLE_CONSENT_COOKIE.value,
        true,
        false,
        false,
        expiry,
        {},
        2,
        {},
      );
    }
    googleConsentSet = true;
    return true;
  } catch {
    // A jar that refuses the cookie is not fatal: the request still goes out,
    // and a consent page is then reported as such.
    return false;
  }
}

function getDOMParserConstructor(): typeof DOMParser {
  const mainWindow = Zotero.getMainWindow();
  const constructor =
    mainWindow?.DOMParser ??
    (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;

  if (!constructor) throw new Error("DOMParser is unavailable");
  return constructor;
}

/** Parses HTML text the same way `requestHTML` does. */
export function parseHTMLBody(body: string): Document {
  const Parser = getDOMParserConstructor();
  return new Parser().parseFromString(body, "text/html");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export class PacedRequester {
  /** One chain per host: reads of different sites never wait for each other. */
  private tails = new Map<string, Promise<unknown>>();
  private pacing = new Map<string, PacingState>();
  private warmed = false;
  private warmup: WarmupResult | null = null;
  private disposed = false;
  private options: RequesterOptions;
  /** Zotero's own loader, created on first use. */
  private createdLoader: PageLoader | null = null;
  /** Which path worked last: the browser first, then whichever answers. */
  private pathPreference: ScholarPath = "browser";
  private scholarAttempts: ScholarAttempt[] | null = null;

  constructor(options: RequesterOptions) {
    this.options = options;
  }

  setOptions(options: RequesterOptions): void {
    this.options = options;
  }

  /**
   * Routes every read through `transport`, or restores Zotero's own with
   * `null`.
   *
   * A seam for the test suite - which must not touch the live alphaXiv and
   * Google Scholar while it runs - and for looking at a read without changing
   * anything else.
   */
  setTransport(transport: HttpTransport | null): void {
    this.options = { ...this.options, transport: transport ?? undefined };
  }

  /**
   * Whether a page may be opened in Zotero's hidden browser.
   *
   * An injected transport means the caller wants to decide what the network
   * answers, so the browser - which is not part of that transport - stays out
   * of it. A caller that also injects a loader says so on purpose.
   */
  private browserPathAvailable(): boolean {
    return Boolean(this.options.pageLoader) || !this.options.transport;
  }

  dispose(): void {
    this.disposed = true;
  }

  /**
   * What Google answered the session's opening request, for the diagnostic.
   *
   * `null` until a Google request has been made in this session.
   */
  sessionWarmup(): WarmupResult | null {
    return this.warmup;
  }

  /** The last Scholar read's attempts, for the diagnostic. */
  lastScholarAttempts(): ScholarAttempt[] | null {
    return this.scholarAttempts;
  }

  /** Which path the next Scholar read starts with. */
  scholarReadPath(): ScholarPath {
    return this.pathPreference;
  }

  /**
   * Opens Scholar's front page once per session, before the first search.
   *
   * A browser reaches a search page by way of the site: it arrives with the
   * site's cookies already in hand. Zotero's requests share the application's
   * own cookie jar (`Zotero.HTTP` uses the Firefox jar unless asked not to),
   * so the cookies Google sets here are kept and sent with the searches that
   * follow - including in later sessions, because that jar is on disk.
   *
   * This is one extra request per session, and it is what a person does. Going
   * straight to a search URL with an empty jar is what a crawler does, and
   * Google answers that with "unusual traffic" often enough to be worth it.
   */
  private async warmUpScholar(
    send: HttpTransport,
    userAgent: string,
  ): Promise<void> {
    this.warmed = true;
    try {
      const opened = await send("GET", GOOGLE_SCHOLAR_HOME, {
        timeout: this.options.timeoutMs || REQUEST_TIMEOUT_MS,
        responseType: "text",
        successCodes: false,
        // The session's first navigation: nothing referred it, so the header
        // says so and no `Referer` is invented.
        headers: browserHeaders(userAgent, "text/html,application/xhtml+xml", {
          language: "en-US,en;q=0.9",
          site: "none",
        }),
      });
      this.warmup = { status: Number(opened.status) || 0, error: null };
    } catch (error) {
      this.warmup = {
        status: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private intervalFor(host: string): number {
    const base = this.options.intervalMs;
    if (/(^|\.)arxiv\.org$/i.test(host)) {
      return Math.max(base, ARXIV_API_INTERVAL_MS);
    }
    if (/(^|\.)scholar\.google\.com$/i.test(host)) {
      return Math.max(base, GOOGLE_SCHOLAR_INTERVAL_MS);
    }
    return base;
  }

  /**
   * Runs `task` once every previously queued task has finished and the host's
   * minimum interval has elapsed.
   */
  private enqueue<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(host) ?? Promise.resolve();
    const run = previous.then(async () => {
      if (this.disposed)
        throw new Error("AlphaLikes request queue has stopped");

      const state = this.pacing.get(host) ?? { lastStartedAt: 0 };
      const wait = Math.max(
        0,
        this.intervalFor(host) - (Date.now() - state.lastStartedAt),
      );
      if (wait) await Zotero.Promise.delay(wait);

      state.lastStartedAt = Date.now();
      this.pacing.set(host, state);

      return task();
    });

    // Keep the chain alive even when a task rejects.
    this.tails.set(
      host,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );

    return run;
  }

  /**
   * Fetches a page and hands back its status as well as its body.
   *
   * A non-2xx answer is not thrown away here, because the caller has to be
   * able to tell "Google rate-limited us" (a 403 or a 429) from "the page
   * simply had nothing", and those two produce very different messages.
   */
  async requestPage(
    url: string,
    accept = "application/json, text/plain, */*",
  ): Promise<{ status: number; body: string; userAgent: string }> {
    const host = hostOf(url);
    const google = isGoogleHost(host);
    if (google) ensureGoogleConsent();

    return this.enqueue(host, async () => {
      const userAgent = userAgentFor(host);
      // Google is answered as a browser would be answered - the same headers,
      // in the same arrangement, with the site's own front page as the
      // referrer. Every other host gets the honest, minimal request.
      const headers: Record<string, string> = google
        ? browserHeaders(userAgent, accept, {
            language: "en-US,en;q=0.9",
            referer: GOOGLE_SCHOLAR_HOME,
          })
        : { Accept: accept, "User-Agent": userAgent };

      const send = this.options.transport ?? bindTransport(Zotero.HTTP);
      if (google && !this.warmed) await this.warmUpScholar(send, userAgent);

      const response = await send("GET", url, {
        timeout: this.options.timeoutMs || REQUEST_TIMEOUT_MS,
        responseType: "text",
        successCodes: false,
        headers,
      });

      const body =
        typeof response.response === "string"
          ? response.response
          : response.responseText;

      return {
        status: Number(response.status) || 0,
        body: body ?? "",
        userAgent,
      };
    });
  }

  /**
   * Reads a Google Scholar search page, by whichever path answers.
   *
   * Scholar refuses requests that are not what a browser sends - the same
   * search, from the same address, with the same cookies, opens in a browser
   * while an XMLHttpRequest is answered with `429`. So the page is first loaded
   * the way a browser loads it (a hidden browser: a real navigation, scripts
   * and all) and, if that is unavailable or does not answer, fetched as before.
   *
   * Whichever path works is remembered and tried first from then on, so a
   * session settles on one path instead of paying for two requests per paper.
   * `compare` forces both, for the diagnostic: that is the only way to tell
   * "this address is blocked" from "this client is blocked".
   */
  async requestScholarPage(
    url: string,
    options: { compare?: boolean } = {},
  ): Promise<ScholarPage> {
    const host = hostOf(url);
    ensureGoogleConsent();

    return this.enqueue(host, async () => {
      const compare = options.compare === true;
      const userAgent = browserUserAgent();
      const headers = browserHeaders(
        userAgent,
        "text/html,application/xhtml+xml",
        {
          language: "en-US,en;q=0.9",
          referer: GOOGLE_SCHOLAR_HOME,
        },
      );

      const send = this.options.transport ?? bindTransport(Zotero.HTTP);
      if (!this.warmed) await this.warmUpScholar(send, userAgent);

      const order: ScholarPath[] = !this.browserPathAvailable()
        ? ["xhr"]
        : compare
          ? ["browser", "xhr"]
          : this.pathPreference === "xhr"
            ? ["xhr", "browser"]
            : ["browser", "xhr"];

      const attempts: ScholarAttempt[] = [];
      let winner: { via: ScholarPath; status: number; body: string } | null =
        null;

      for (const via of order) {
        const attempt =
          via === "browser"
            ? await this.loadScholarInBrowser(url)
            : await this.loadScholarAsRequest(send, url, headers);
        attempts.push(attempt.record);

        if (attempt.body !== null && !winner) {
          winner = {
            via,
            // A page that arrived is an answer even when the loader could not
            // report which status it arrived with; the content decides what it
            // means, and a reported refusal (429, 403) is kept as it is so the
            // block logic can tell one kind of refusal from the other.
            status: attempt.record.status ?? 200,
            body: attempt.body,
          };
        }
        if (winner && !compare) break;
      }

      this.scholarAttempts = attempts;

      if (winner) {
        if (this.pathPreference !== winner.via) {
          this.pathPreference = winner.via;
          Zotero.debug(
            `[AlphaLikes] Google Scholar 读取改用${
              winner.via === "browser" ? "浏览器页面加载" : "直接请求"
            }方式`,
          );
        }
        return { ...winner, attempts };
      }

      return {
        status: failureStatus(attempts),
        body: "",
        via: null,
        attempts,
      };
    });
  }

  /** The loader in use: the injected one, else Zotero's hidden browser. */
  private pageLoader(): PageLoader {
    if (this.options.pageLoader) return this.options.pageLoader;
    if (!this.createdLoader) this.createdLoader = createPageLoader();
    return this.createdLoader;
  }

  /** One Scholar page, loaded as a real navigation in a hidden browser. */
  private async loadScholarInBrowser(url: string): Promise<{
    record: ScholarAttempt;
    body: string | null;
  }> {
    const timeoutMs = this.options.timeoutMs || REQUEST_TIMEOUT_MS;

    let loaded: PageLoadResult;
    try {
      loaded = await this.pageLoader()(url, timeoutMs);
    } catch (error) {
      loaded = {
        status: null,
        html: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const body = loaded.html || "";
    // Zotero's page-data actor does not always hold on to the response status
    // by the time the document can be read; a document that arrived is still
    // the site's answer, and `isGoogleInterstitial` reads the refusal from it.
    const usable = loaded.error === null && body.length > 0;
    const record: ScholarAttempt = {
      via: "browser",
      status: loaded.status,
      error: loaded.error,
      bytes: body.length,
      bodyHead: trimBodyHead(body),
      usable,
    };

    return { record, body: usable ? body : null };
  }

  /** One Scholar page, fetched as a plain request. */
  private async loadScholarAsRequest(
    send: HttpTransport,
    url: string,
    headers: Record<string, string>,
  ): Promise<{ record: ScholarAttempt; body: string | null }> {
    try {
      const response = await send("GET", url, {
        timeout: this.options.timeoutMs || REQUEST_TIMEOUT_MS,
        responseType: "text",
        successCodes: false,
        headers,
      });

      const raw =
        typeof response.response === "string"
          ? response.response
          : response.responseText;
      const body = raw ?? "";
      const status = Number(response.status) || 0;
      // Same rule as the browser path: an answer is an answer. A refusal often
      // carries a page too, and its status is what books the wait.
      const usable = body.length > 0;
      const record: ScholarAttempt = {
        via: "xhr",
        status,
        error: null,
        bytes: body.length,
        bodyHead: trimBodyHead(body),
        usable,
      };

      return { record, body: usable ? body : null };
    } catch (error) {
      return {
        record: {
          via: "xhr",
          status: null,
          error: error instanceof Error ? error.message : String(error),
          bytes: 0,
          bodyHead: "",
          usable: false,
        },
        body: null,
      };
    }
  }

  async requestText(
    url: string,
    accept = "application/json, text/plain, */*",
  ): Promise<string> {
    const host = hostOf(url);
    const { status, body } = await this.requestPage(url, accept);

    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status} from ${host}`);
    }
    if (!body) throw new Error(`Empty response from ${host}`);
    return body;
  }

  async requestJSON(url: string): Promise<unknown> {
    const body = await this.requestText(url);
    try {
      return JSON.parse(body);
    } catch {
      const host = hostOf(url);
      throw new Error(`Invalid JSON from ${host}`);
    }
  }

  async requestXML(url: string): Promise<Document> {
    const body = await this.requestText(
      url,
      "application/atom+xml, application/xml, text/xml",
    );

    const Parser = getDOMParserConstructor();
    const doc = new Parser().parseFromString(body, "application/xml");

    if (doc.getElementsByTagName("parsererror").length) {
      throw new Error(`Invalid XML from ${hostOf(url)}`);
    }
    return doc;
  }

  /** Raw HTML document, used for the alphaXiv page scrape. */
  async requestHTML(url: string): Promise<Document> {
    const body = await this.requestText(url, "text/html,application/xhtml+xml");
    return parseHTMLBody(body);
  }
}

/**
 * The status a Scholar read is judged by when neither path got a page.
 *
 * A refusal is the answer that matters - it says the site decided not to serve
 * this client, which is what the caller turns into a wait - so it wins over a
 * transport error, and over a peer path that simply timed out.
 */
function failureStatus(attempts: ScholarAttempt[]): number {
  const answered = attempts.filter(
    (attempt): attempt is ScholarAttempt & { status: number } =>
      typeof attempt.status === "number" && attempt.status > 0,
  );
  const refusal = answered.find((attempt) =>
    CITATION_REJECTED_STATUSES.has(attempt.status),
  );
  if (refusal) return refusal.status;
  return answered.length ? answered[0].status : 0;
}
