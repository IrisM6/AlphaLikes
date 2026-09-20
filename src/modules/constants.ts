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

/** How long a failed lookup is remembered before it is retried. */
export const ERROR_RETRY_DELAY_MS = 5 * 60_000;

/** How long a failed arXiv-ID resolution is remembered. */
export const RESOLUTION_RETRY_DELAY_MS = 10 * 60_000;
