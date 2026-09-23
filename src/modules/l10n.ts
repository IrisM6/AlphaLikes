/**
 * Localised user-facing strings.
 *
 * Messages live in `addon/locale/<locale>/addon.ftl` and are prefixed with the
 * add-on reference at build time (`alphalikes-<id>`). They are read once at
 * startup into a synchronous cache; the English text compiled into this module
 * is used whenever Fluent is unavailable, so the UI never shows a raw message
 * id.
 */

import { config } from "../../package.json";

export const MESSAGES = {
  "column-label": "alphaXiv Likes",
  "column-citations-label": "Citations",
  "menu-refresh": "Refresh alphaXiv Likes",
  "menu-refresh-citations": "Refresh citation counts",
  "menu-open-scholar": "Open the search page in Google Scholar in your browser",
  "notify-open-scholar":
    "Opened the search page in your browser. That is the browser's own session and does not affect what the plugin reads.",
  "menu-reset-google": "Reset the Google session (clear cookies and retry)",

  "cell-loading": "Reading…",
  "cell-citations-loading": "Reading the citation count…",
  "cell-citations-loading-from": "Reading the citation count ({sources})…",
  "cell-unavailable": "No like count found",
  "cell-filtered": "Hidden by the like-count filter",
  "cell-trend": "{delta} since the previous snapshot (now {likes})",
  "cell-high-impact": "Top 10% of its field and year",
  "cell-citations-unavailable": "No citation count found",
  "cell-unavailable-reason": "Read failed: {reason} · {retry}",
  "cell-citations-unavailable-reason": "Read failed: {reason} · {retry}",
  "failure-http-403": "the site refused the request (HTTP 403)",
  "failure-http-429": "the request was rate limited (HTTP 429)",
  "failure-http-4xx": "the request was refused (HTTP 4xx)",
  "failure-http-5xx": "the site answered with a server error (HTTP 5xx)",
  "failure-network":
    "the request never reached the site (network, DNS, proxy or timeout)",
  "failure-empty": "the site answered with an empty response",
  "failure-no-count": "the page arrived without that number",
  "failure-not-selected":
    "Google Scholar is not read for unselected items; select it or refresh from the context menu",
  "cell-retry-in": "retrying automatically in about {minutes} minutes",
  "cell-burst-pause":
    "this burst is finished; reading resumes in about {minutes} minutes",
  "cell-cleared":
    "Records cleared; refresh from the context menu to read them again",
  "cell-scholar-rate-limited":
    "Google Scholar is rate limiting this address (HTTP 429); retrying in about {minutes} minutes",
  "cell-scholar-blocked":
    "Google Scholar is asking for a human check; retrying in about {minutes} minutes",
  "cell-quantile-high": "High for the items in view",
  "cell-quantile-low": "Low for the items in view",
  "cell-quantile-mid": "Mid-range for the items in view",
  "cell-quantile-title":
    "{label}: high from {high} likes, low up to {low} (ranked against {sample} items)",
  "cell-split-prefix": "likes",
  "cell-split-prefix-citations": "cited",
  "cell-citation-source": "Source: {source}",

  // --- Refresh summaries ---------------------------------------------------
  "notify-refresh-likes-title": "AlphaPulse · likes",
  "notify-refresh-citations-title": "AlphaPulse · citations",
  "refresh-likes-updated": "Re-read {updated} like count(s)",
  "refresh-citations-updated": "Re-read {updated} citation count(s)",
  "refresh-failed": "{failed} could not be read (the old value is kept)",
  "refresh-failed-retry":
    "{failed} could not be read (the old value is kept; retrying automatically in about {minutes} minutes)",
  "refresh-skipped": "{skipped} have no DOI / arXiv ID",
  "refresh-nothing": "Nothing to refresh.",
  "refresh-joining": "; ",

  // --- Batch actions -------------------------------------------------------

  "progress-error": "AlphaPulse could not finish this update: {message}",

  // --- Google Scholar's human check ---------------------------------------
  // --- Clearing this plugin's own records ----------------------------------
  "menu-clear": "Remove the Extra records this plugin wrote",
  "menu-open-alphaxiv": "Open the alphaXiv page",
  "notify-alphaxiv-title": "AlphaPulse · alphaXiv",
  "notify-open-alphaxiv": "The paper's alphaXiv page is open in your browser.",
  "error-no-arxiv-id":
    "None of the selected items has an arXiv ID, so there is no alphaXiv page to open.",
  "notify-clear-title": "AlphaPulse · clear",
  "clear-done":
    "Cleared the plugin's records from {count} item(s); everything else in Extra is untouched, and nothing is written again until the next refresh.",
  "clear-none":
    "There was nothing of the plugin's to clear; nothing is written again until the next refresh.",

  "notify-scholar-title": "AlphaPulse · Google Scholar",
  "notify-scholar-rate-limited":
    "Google Scholar is rate limiting (HTTP 429); retrying automatically in about {minutes} minutes.",
  "notify-scholar-blocked":
    "Google Scholar is asking for a human check; retrying automatically in about {minutes} minutes.",
  "notify-scholar-paused":
    "Google Scholar has refused several rounds; automatic retrying has stopped. Refresh by hand when the network is quiet, or reset the Google session.",
  "reset-google-done":
    "Cleared {cookies} Google cookie(s); re-reading the citation counts now.",

  "error-no-selection": "Select at least one item first.",
  "error-single-selection": "This action works on a single item only.",
} as const;

export type MessageId = keyof typeof MESSAGES;

let cache: Record<string, string> | null = null;

/**
 * Reads every message from Fluent once. Safe to call before any window exists:
 * failures leave the English fallbacks in place.
 */
/**
 * How many times `loadStrings` waits for a late Fluent file.
 *
 * The file is linked into the main window at startup and its resource loads
 * asynchronously, so the first read can still miss. Retrying briefly is what
 * keeps the UI from falling back to English for a whole session.
 */
const LOAD_ATTEMPTS = 6;
const LOAD_RETRY_DELAY_MS = 150;

export async function loadStrings(): Promise<void> {
  for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt += 1) {
    const resolved = await tryLoadStrings();
    if (resolved) return;
    await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_DELAY_MS));
  }

  Zotero.debug(
    "[AlphaPulse] Fluent strings were not available; using the built-in text",
  );
}

/** Reads every message once. Returns whether Fluent answered for all of them. */
async function tryLoadStrings(): Promise<boolean> {
  try {
    const l10n = Zotero.getMainWindow()?.document?.l10n;
    if (!l10n?.formatValues) return false;

    const ids = Object.keys(MESSAGES) as MessageId[];
    const values = await l10n.formatValues(
      ids.map((id) => `${config.addonRef}-${id}`),
    );

    const next: Record<string, string> = {};
    let complete = true;

    ids.forEach((id, index) => {
      const value = values[index];
      const prefixed = `${config.addonRef}-${id}`;

      // Fluent answers with the message id when the resource was never linked
      // into this window. Showing that would be worse than the built-in text,
      // so it counts as missing too.
      const usable = typeof value === "string" && value && value !== prefixed;
      if (!usable) complete = false;

      next[id] = usable ? (value as string) : MESSAGES[id];
    });

    cache = next;
    return complete;
  } catch (error) {
    Zotero.debug(`[AlphaPulse] Could not load locale strings: ${error}`);
    return false;
  }
}

export function t(id: MessageId, args?: Record<string, unknown>): string {
  let text = cache?.[id] ?? MESSAGES[id];
  if (!args) return text;

  // The build prefixes Fluent variables along with the message ids, and Fluent
  // renders them padded with spaces (`{ alphalikes-delta }`), so the braces are
  // normalised before the placeholders are filled in.
  text = text.split("{ ").join("{").split(" }").join("}");

  for (const [key, value] of Object.entries(args)) {
    text = text
      .split(`{${key}}`)
      .join(String(value))
      .split(`{${config.addonRef}-${key}}`)
      .join(String(value));
  }

  return text;
}
