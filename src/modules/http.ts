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
  /**
   * Minimum gap between two Google Scholar reads, on top of `intervalMs`.
   *
   * The site is the one place where the gap is part of the answer rather than
   * politeness: a rhythm no person has is what "unusual traffic" is made of.
   * Tests that need two Scholar reads inside one session set this to zero and
   * drive the pacing logic (and the queue they share) without the wait.
   */
  scholarIntervalMs?: number;
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
export function stripAppToken(agent: string): string {
  return agent.replace(/\s*Zotero\/\S+/, "").trim();
}

/**
 * The User-Agent a Google request goes out with.
 *
 * It has to be the agent this Zotero actually sends, with one thing taken
 * back out: the application's own name. Every request Zotero makes carries
 * `Zotero/<version>` unless the host is registered otherwise - it is how
 * zotero.org knows the client - and a site that decides what it may read by
 * looking at the client reads that suffix as "not a browser". Google Scholar
 * answers the same search from the same address with a results page in a
 * browser and with `429 unusual traffic` to a request whose agent ends in
 * `Zotero/9.0.6`, which is exactly the difference between the page the user
 * opens and the page the plugin was being refused.
 *
 * `Zotero.VersionHeader` is the application's own answer to this: it holds the
 * plain agent (`getPlainFirefoxUA`) and the list of hosts that must not see
 * the suffix (`registerPlainUAHost`, used for the hosts Zotero itself has to
 * pass Cloudflare's checks on). Both are used here when present, so what the
 * plugin says it sends and what goes out are the same string.
 */
export function browserUserAgent(): string {
  const major = geckoMajorVersion();
  const versionHeader = (
    Zotero as unknown as {
      VersionHeader?: {
        getPlainFirefoxUA?: () => string;
      };
    }
  ).VersionHeader;

  try {
    const plain = versionHeader?.getPlainFirefoxUA?.();
    if (plain) return stripAppToken(plain);
  } catch {
    // Fall through to the window's own agent.
  }

  try {
    const agent = Zotero.getMainWindow()?.navigator?.userAgent;
    if (agent) {
      const stripped = stripAppToken(matchGeckoVersion(agent, major));
      if (/Firefox\//.test(stripped)) return stripped;
      // `... Gecko/20100101 Zotero/9.0.6` loses its only browser token with
      // the suffix, so the engine's own name goes back where it belongs.
      return stripped.replace(
        /Gecko\/\d+/,
        (gecko) => `${gecko} Firefox/${major ?? 115}.0`,
      );
    }
  } catch {
    // Fall through to the static string below.
  }

  return matchGeckoVersion(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) " +
      "Gecko/20100101 Firefox/115.0",
    major,
  );
}

/** Hosts already registered with Zotero as needing the plain agent. */
const plainUAHosts = new Set<string>();

/**
 * Makes every request to `host` - this plugin's or the application's - go out
 * without the `Zotero/<version>` suffix.
 *
 * Zotero's own reason for having this is Cloudflare: a check that has been
 * passed stays passed only while the agent stays the same, and a check cannot
 * be passed at all with the application's name in it. Google is the same kind
 * of gatekeeper, so the Scholar hosts are registered the same way, before the
 * first request to them, and the registration is remembered for the session.
 */
export function usePlainUserAgentFor(host: string): void {
  if (plainUAHosts.has(host)) return;
  plainUAHosts.add(host);

  try {
    (
      Zotero as unknown as {
        VersionHeader?: { registerPlainUAHost?: (host: string) => void };
      }
    ).VersionHeader?.registerPlainUAHost?.(host);
    Zotero.debug(`[AlphaLikes] ${host} 的请求不再携带 Zotero 标识`);
  } catch {
    // Older builds without the hook: the agent we send is plain already.
  }
}

/**
 * The hosts a Google session's cookies live in, most specific first.
 *
 * `scholar.google.com` sets its own (`GSP`, `GOOGLE_ABUSE_EXEMPTION`), the
 * parent domain carries the rest (`NID`, `SOCS`, `_GRECAPTCHA`).
 */
/**
 * A Google domain, country versions included.
 *
 * Scholar redirects to `scholar.google.de` and the like depending on where the
 * request comes from, and those hosts carry their own share of the same
 * session cookies, so a list of `.com` hosts would leave the jar half full.
 * The suffix has to start at a dot so that lookalikes (`notgoogle.com`) stay
 * out of it.
 */
const GOOGLE_COOKIE_HOST = /(^|\.)google\.[a-z]{2,}(\.[a-z]{2,})?$/i;

export function isGoogleCookieHost(host: string): boolean {
  return GOOGLE_COOKIE_HOST.test(host);
}

/**
 * Forgets everything Google remembers about this client.
 *
 * A jar Google has marked keeps being answered with `429` however slowly the
 * reads are made and however long the waits are, while the same search in a
 * browser with a jar Google has not marked opens normally. Dropping the jar is
 * therefore the closest thing to arriving as a browser that was never here,
 * and it is the user's call, so it lives behind a menu entry rather than in a
 * retry path.
 *
 * The cookies are enumerated and matched by host rather than looked up per
 * host: `getCookiesFromHost` throws on some of the shapes Google actually
 * stores (a leading dot among them), and the point of the call is to end up
 * with nothing left, not to make exactly six well-formed queries.
 *
 * @returns how many cookies were removed
 */
export function clearGoogleCookies(): number {
  let removed = 0;

  for (const cookie of storedCookies()) {
    if (!isGoogleCookieHost(cookie.host)) continue;
    try {
      Services.cookies.remove(
        cookie.host,
        cookie.name,
        cookie.path,
        cookie.originAttributes ?? {},
      );
      removed += 1;
    } catch {
      // Already gone, or a jar that refuses this one: not worth a failure.
    }
  }

  return removed;
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

interface StoredCookie {
  host: string;
  name: string;
  value: string;
  path: string;
  originAttributes?: object;
}

/** Every cookie Zotero holds, or none if the cookie service is not reachable. */
function storedCookies(): StoredCookie[] {
  try {
    return Services.cookies.cookies as unknown as StoredCookie[];
  } catch {
    return [];
  }
}

/** Whether a cookie stored for `cookieHost` is sent to `host`. */
function appliesToHost(cookieHost: string, host: string): boolean {
  const stored = cookieHost.toLowerCase();
  const bare = host.toLowerCase().replace(/^\./, "");
  if (stored.replace(/^\./, "") === bare) return true;
  return stored.startsWith(".") && bare.endsWith(stored);
}

/** The names of the cookies Zotero holds for `host` (the diagnostic lists them). */
export function cookieNames(host: string): string[] {
  return [
    ...new Set(
      storedCookies()
        .filter((cookie) => appliesToHost(cookie.host, host))
        .map((cookie) => String(cookie.name)),
    ),
  ].sort();
}

/** Whether Google's consent cookie is in Zotero's own cookie jar. */
export function googleConsentStored(): boolean {
  return storedCookies().some(
    (cookie) =>
      appliesToHost(cookie.host, "scholar.google.com") &&
      cookie.name === GOOGLE_CONSENT_COOKIE.name &&
      cookie.value === GOOGLE_CONSENT_COOKIE.value,
  );
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
   * Asks a third-party page what it saw of this client's handshake.
   *
   * This is the one question header work cannot answer: whether the reads are
   * rejected for what they send or for who has been sending it. Zotero is
   * built on Gecko, so both of its read paths - the hidden browser navigation
   * and the plain request - already go through the same NSS stack a Firefox on
   * this machine uses; the check is here to show that, with numbers, from the
   * machine that is being refused, instead of arguing about it.
   *
   * Both paths are read even when one of them is known to be broken: the
   * comparison is the point.
   */
  async probeFingerprint(): Promise<FingerprintReading[]> {
    const readings: FingerprintReading[] = [];
    const empty = { ja3: null, ja3Hash: null, ja4: null, akamaiHash: null };
    const send = this.options.transport ?? bindTransport(Zotero.HTTP);

    try {
      const response = await send("GET", FINGERPRINT_URL, {
        timeout: this.options.timeoutMs || REQUEST_TIMEOUT_MS,
        responseType: "text",
        successCodes: false,
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": userAgentFor(hostOf(FINGERPRINT_URL)),
        },
      });
      const body =
        typeof response.response === "string"
          ? response.response
          : (response.responseText ?? "");
      readings.push({
        via: "xhr",
        ...empty,
        ...readFingerprint(body),
        error: null,
      });
    } catch (error) {
      readings.push({
        via: "xhr",
        ...empty,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!this.browserPathAvailable()) return readings;

    try {
      const loaded = await this.pageLoader()(
        FINGERPRINT_URL,
        this.options.timeoutMs || REQUEST_TIMEOUT_MS,
      );
      if (loaded.error) throw new Error(loaded.error);
      readings.push({
        via: "browser",
        ...empty,
        ...readFingerprint(loaded.html),
        error: null,
      });
    } catch (error) {
      readings.push({
        via: "browser",
        ...empty,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return readings;
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
      return Math.max(
        base,
        this.options.scholarIntervalMs ?? GOOGLE_SCHOLAR_INTERVAL_MS,
      );
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
    if (google) {
      usePlainUserAgentFor(host);
      ensureGoogleConsent();
    }

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
    usePlainUserAgentFor(host);
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

// ---------------------------------------------------------------------------
// Fingerprint self-check
// ---------------------------------------------------------------------------

/** The third-party page that echoes back what it saw of the handshake. */
export const FINGERPRINT_URL = "https://tls.peet.ws/api/all";

export interface FingerprintReading {
  /** Which read path produced it. */
  via: "browser" | "xhr";
  /** The fields worth reporting, empty when the read did not work. */
  ja3: string | null;
  ja3Hash: string | null;
  ja4: string | null;
  akamaiHash: string | null;
  /** Why there is nothing to report. */
  error: string | null;
}

/**
 * Pulls the fingerprint fields out of whatever came back.
 *
 * The site answers with JSON. Read through a request, that is the whole body; a
 * hidden browser hands back a document with the same JSON rendered inside it,
 * so the text is unwrapped first and each field is looked up on its own - a
 * report that lists four of five values is still worth more than a parse error.
 */
export function readFingerprint(body: string): Partial<FingerprintReading> {
  let text = body.trim();
  if (!text.startsWith("{")) {
    text = text
      .replace(/<[^>]*>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  interface FingerprintBody {
    tls?: { ja3?: string; ja3_hash?: string; ja4?: string };
    http2?: { akamai_fingerprint_hash?: string };
  }
  const parsed = ((): FingerprintBody | null => {
    try {
      return JSON.parse(text) as FingerprintBody;
    } catch {
      return null;
    }
  })();

  const field = (name: string) => {
    const found = new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(text);
    return found?.[1] ?? null;
  };

  return {
    ja3: parsed?.tls?.ja3 ?? field("ja3"),
    ja3Hash: parsed?.tls?.ja3_hash ?? field("ja3_hash"),
    ja4: parsed?.tls?.ja4 ?? field("ja4"),
    akamaiHash:
      parsed?.http2?.akamai_fingerprint_hash ??
      field("akamai_fingerprint_hash"),
  };
}
