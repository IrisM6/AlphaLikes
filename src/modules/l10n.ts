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
  "menu-open-scholar": "Open the Google Scholar verification page",

  "cell-loading": "Loading from alphaXiv…",
  "cell-unavailable": "No alphaXiv likes found for this item",
  "cell-filtered": "Hidden by the like-count filter",
  "cell-trend": "{delta} likes since the previous snapshot (currently {likes})",
  "cell-high-impact": "In the top 10% of its field and year",
  "cell-citations-unavailable": "No citation count found for this item",
  "cell-unavailable-reason": "The read failed: {reason} It retries later.",
  "cell-citations-unavailable-reason":
    "The read failed: {reason} It retries later.",
  "failure-http-403": "the site refused the request (HTTP 403).",
  "failure-http-429": "the site is rate limiting (HTTP 429).",
  "failure-http-4xx": "the request was refused (HTTP 4xx).",
  "failure-http-5xx": "the site answered with a server error (HTTP 5xx).",
  "failure-network":
    "the request never reached the site (network, DNS, proxy or timeout).",
  "failure-empty": "the site answered with an empty response.",
  "failure-no-count": "the page arrived but the number was not in it.",
  "cell-cleared":
    "This plugin's records were cleared from this item. Refresh the likes or the citations to read them again.",
  "cell-scholar-rate-limited":
    "Google Scholar is rate limiting this network address (HTTP 429); retrying automatically in about {minutes} minutes. The limit applies to the address, not to this plugin.",
  "cell-scholar-blocked":
    "Google Scholar asked for a human check; retrying automatically in about {minutes} minutes. Right-click → Open the Google Scholar verification page to clear it yourself.",
  "cell-quantile-high": "High for the items in view",
  "cell-quantile-low": "Low for the items in view",
  "cell-quantile-mid": "Mid-range for the items in view",
  "cell-quantile-title":
    "{label} — high from {high} likes, low up to {low} (ranked against {sample} items)",
  "cell-split-prefix": "likes",
  "cell-split-prefix-citations": "cited",
  "cell-citation-source": "Source: {source}",

  // --- Refresh summaries ---------------------------------------------------
  "notify-refresh-likes-title": "AlphaLikes · likes",
  "notify-refresh-citations-title": "AlphaLikes · citations",
  "refresh-likes-updated": "Re-read {updated} like count(s)",
  "refresh-citations-updated": "Re-read {updated} citation count(s)",
  "refresh-failed": "{failed} could not be read (the previous value is kept)",
  "refresh-skipped": "{skipped} have no DOI or arXiv ID to look up",
  "refresh-nothing": "Nothing to refresh.",
  "refresh-joining": "; ",

  // --- Batch actions -------------------------------------------------------

  "progress-error": "AlphaLikes: the update failed: {message}",

  // --- Google Scholar's human check ---------------------------------------
  // --- Clearing this plugin's own records ----------------------------------
  "menu-clear": "Clear this plugin's Extra records",
  "notify-clear-title": "AlphaLikes · clear",
  "clear-done":
    "Removed this plugin's records from {count} item(s); everything else in Extra is untouched. These items stay unwritten until a refresh.",
  "clear-none":
    "No AlphaLikes records to remove; everything else in Extra is untouched. These items stay unwritten until a refresh.",

  "notify-scholar-title": "AlphaLikes · Google Scholar",
  "notify-scholar-rate-limited":
    "Google Scholar is rate limiting this network address, so citation counts cannot be read yet. It tries again automatically in about {minutes} minutes; the limit applies to the address, so the same search in this machine's browser is limited too, and waiting is usually what clears it.",
  "notify-scholar-blocked":
    "Google Scholar asked for a human check, so citation counts are paused. It will retry automatically in about {minutes} minutes; the context menu can open the check now.",

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
    "[AlphaLikes] Fluent strings were not available; using the built-in text",
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
    Zotero.debug(`[AlphaLikes] Could not load locale strings: ${error}`);
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
