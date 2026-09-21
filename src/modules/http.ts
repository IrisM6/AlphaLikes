/**
 * HTTP access with global serialisation and per-host pacing.
 *
 * arXiv asks for at least three seconds between API calls and Google Scholar
 * blocks reads that come too fast, while the other providers are happy with the
 * configured interval, so the delay is chosen per host rather than globally.
 */

import pkg from "../../package.json";
import {
  ARXIV_API_INTERVAL_MS,
  GOOGLE_SCHOLAR_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
} from "./constants";

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
) => Promise<{ status: number; response?: string; responseText?: string }>;

export interface RequesterOptions {
  timeoutMs: number;
  intervalMs: number;
  /** Defaults to `Zotero.HTTP.request`. */
  transport?: HttpTransport;
}

interface PacingState {
  lastStartedAt: number;
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
export function userAgentFor(host: string): string {
  if (!isGoogleHost(host)) return USER_AGENT;

  try {
    const agent = Zotero.getMainWindow()?.navigator?.userAgent;
    if (agent && /Firefox\//.test(agent)) return agent;
  } catch {
    // Fall through to the static string below.
  }

  return (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) " +
    "Gecko/20100101 Firefox/115.0"
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export class PacedRequester {
  private tail: Promise<unknown> = Promise.resolve();
  private pacing = new Map<string, PacingState>();
  private disposed = false;
  private options: RequesterOptions;

  constructor(options: RequesterOptions) {
    this.options = options;
  }

  setOptions(options: RequesterOptions): void {
    this.options = options;
  }

  dispose(): void {
    this.disposed = true;
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
    const run = this.tail.then(async () => {
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
    this.tail = run.then(
      () => undefined,
      () => undefined,
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
  ): Promise<{ status: number; body: string }> {
    const host = hostOf(url);
    const google = isGoogleHost(host);
    if (google) ensureGoogleConsent();

    return this.enqueue(host, async () => {
      const headers: Record<string, string> = {
        Accept: accept,
        "User-Agent": userAgentFor(host),
      };
      if (google) headers["Accept-Language"] = "en-US,en;q=0.9";

      const send = this.options.transport ?? Zotero.HTTP.request;
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

      return { status: Number(response.status) || 0, body: body ?? "" };
    });
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

    const Parser = getDOMParserConstructor();
    return new Parser().parseFromString(body, "text/html");
  }
}
