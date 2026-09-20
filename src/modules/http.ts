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

export interface RequesterOptions {
  timeoutMs: number;
  intervalMs: number;
}

interface PacingState {
  lastStartedAt: number;
}

const USER_AGENT = `${pkg.config.addonName}/${pkg.version}`;

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

  async requestText(
    url: string,
    accept = "application/json, text/plain, */*",
  ): Promise<string> {
    const host = hostOf(url);

    return this.enqueue(host, async () => {
      const response = await Zotero.HTTP.request("GET", url, {
        timeout: this.options.timeoutMs || REQUEST_TIMEOUT_MS,
        responseType: "text",
        successCodes: false,
        headers: {
          Accept: accept,
          "User-Agent": USER_AGENT,
        },
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} from ${host}`);
      }

      const body =
        typeof response.response === "string"
          ? response.response
          : response.responseText;

      if (!body) throw new Error(`Empty response from ${host}`);
      return body;
    });
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
