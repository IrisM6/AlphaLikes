/**
 * Shared numeric limits. Kept in a tiny module so both the network layer and
 * the pure parsing helpers can import them without pulling in Zotero APIs.
 */

export const REQUEST_TIMEOUT_MS = 15_000;

/** Default minimum delay between two requests to the same host. */
export const MIN_REQUEST_INTERVAL_MS = 1_500;

/**
 * arXiv's API terms ask for at most one request every three seconds.
 * @see https://info.arxiv.org/help/api/tou.html
 */
export const ARXIV_API_INTERVAL_MS = 3_000;

/**
 * Google Scholar has no API and answers automated reads with a captcha once
 * they look too dense, so its calls are spaced further apart than the rest.
 *
 * A person reading a handful of papers in a browser takes far longer than this
 * between one search and the next; five seconds is a rhythm no one has. The
 * wait is what keeps a library of fifty items from looking like a crawl.
 */
export const GOOGLE_SCHOLAR_INTERVAL_MS = 15_000;

/**
 * Google Scholar's front page.
 *
 * Two things use it: the "verification page" the context menu opens, and the
 * request the plugin makes once per session before its first search - a
 * browser arrives at a search page by way of the site, and a cold jar is what
 * makes Google answer "unusual traffic".
 */
export const GOOGLE_SCHOLAR_HOME = "https://scholar.google.com/";

/** How long a failed lookup is remembered before it is retried. */
export const ERROR_RETRY_DELAY_MS = 5 * 60_000;

/** How long a failed arXiv-ID resolution is remembered. */
export const RESOLUTION_RETRY_DELAY_MS = 10 * 60_000;
