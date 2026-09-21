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
  "menu-find-arxiv": "Find arXiv ID…",
  "menu-refresh": "Refresh alphaXiv Likes",
  "menu-clear": "Clear AlphaLikes data",
  "menu-refresh-citations": "Refresh citation counts",
  "menu-pick-scholar": "Choose the Google Scholar record…",
  "menu-open-scholar": "Open the Google Scholar verification page",

  "cell-loading": "Loading from alphaXiv…",
  "cell-unavailable": "No alphaXiv likes found for this item",
  "cell-pending":
    "A possible arXiv match was found — right-click to confirm it",
  "cell-filtered": "Hidden by the like-count filter",
  "cell-trend": "{delta} likes since the previous snapshot (currently {likes})",
  "cell-high-impact": "In the top 10% of its field and year",
  "cell-citations-unavailable": "No citation count found for this item",
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
  "scholar-picked":
    "The chosen Google Scholar record is now the source of this item's citation count.",
  "scholar-cleared":
    "The chosen Google Scholar record was forgotten; the item's own title is used again.",

  // --- Batch actions -------------------------------------------------------
  "menu-batch-find": "Find arXiv IDs for all selected",

  "batch-finding": "AlphaLikes is looking up {count} items…",
  "batch-done":
    "Done. {applied} matched automatically, {pending} need confirmation, {notFound} had no match, {alreadyKnown} already had an ID.",
  "batch-none-to-do": "Every selected item already has an arXiv ID.",

  "progress-error": "AlphaLikes: the update failed: {message}",

  // --- Google Scholar's human check ---------------------------------------
  "notify-scholar-title": "AlphaLikes · Google Scholar",
  "notify-scholar-blocked":
    "Google Scholar asked for a human check, so citation counts are paused. It will retry automatically in about {minutes} minutes; the context menu can open the check now.",

  "error-no-selection": "Select at least one item first.",
  "error-single-selection": "This action works on a single item only.",

  "picker-title": "Find arXiv ID",
  "picker-heading": "Candidate matches",
  "picker-subheading":
    "AlphaLikes searched the enabled scholarly APIs. Pick the correct arXiv record, or enter an ID manually.",
  "picker-current": "Current match",
  "picker-none":
    "No candidate reached the confidence threshold. Try searching again or enter an ID manually.",
  "picker-no-candidates":
    "Nothing was found for this item yet — use Search again, or type an ID below.",
  "picker-manual-label": "Enter an arXiv ID or URL",
  "picker-manual-placeholder": "2301.12345 or https://arxiv.org/abs/2301.12345",
  "picker-apply": "Apply",
  "picker-cancel": "Cancel",
  "picker-search": "Search again",
  "picker-clear": "Remove AlphaLikes data",
  "picker-searching": "Searching…",
  "picker-search-failed": "The search failed.",
  "picker-invalid": "That does not look like an arXiv ID.",
  "picker-item": "Item",
  "picker-confidence-high": "High confidence",
  "picker-confidence-medium": "Needs your confirmation",
  "picker-confidence-low": "Low confidence",

  // --- Google Scholar record picker ----------------------------------------
  "scholar-picker-title": "Choose the Google Scholar record",
  "scholar-picker-heading": "Results for the paper's title",
  "scholar-picker-subheading":
    "Pick the record whose citation count should be shown for this item. The choice is remembered, so later refreshes use it.",
  "scholar-picker-pinned": "Currently used: {title}",
  "scholar-picker-empty": "This search returned no results.",
  "scholar-picker-blocked":
    "Google answered with a human check instead of results. Open the search in your browser, clear the check, then press Search again.",
  "scholar-picker-error": "The search failed: {message}",
  "scholar-picker-search": "Search again",
  "scholar-picker-searching": "Searching Google Scholar…",
  "scholar-picker-open": "Open the search in the browser",
  "scholar-picker-apply": "Use this record's citation count",
  "scholar-picker-clear": "Forget the chosen record",
  "scholar-picker-cancel": "Cancel",
  "scholar-picker-count": "Cited by {count}",
  "scholar-picker-count-unknown": "No citation count shown",
  "scholar-picker-nomatch": "(no title)",
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

/**
 * Every string the picker dialog needs, handed over as plain data because the
 * dialog runs outside the bundled plugin scope.
 */
/** Strings for the Google Scholar record picker dialog. */
export function scholarPickerStrings(): Record<string, string> {
  return {
    title: t("scholar-picker-title"),
    heading: t("scholar-picker-heading"),
    subheading: t("scholar-picker-subheading"),
    pinned: t("scholar-picker-pinned"),
    empty: t("scholar-picker-empty"),
    blocked: t("scholar-picker-blocked"),
    error: t("scholar-picker-error"),
    search: t("scholar-picker-search"),
    searching: t("scholar-picker-searching"),
    open: t("scholar-picker-open"),
    apply: t("scholar-picker-apply"),
    clear: t("scholar-picker-clear"),
    cancel: t("scholar-picker-cancel"),
    count: t("scholar-picker-count"),
    countUnknown: t("scholar-picker-count-unknown"),
    noTitle: t("scholar-picker-nomatch"),
  };
}

export function pickerStrings(): Record<string, string> {
  return {
    title: t("picker-title"),
    heading: t("picker-heading"),
    subheading: t("picker-subheading"),
    current: t("picker-current"),
    none: t("picker-none"),
    noCandidates: t("picker-no-candidates"),
    manualLabel: t("picker-manual-label"),
    manualPlaceholder: t("picker-manual-placeholder"),
    apply: t("picker-apply"),
    cancel: t("picker-cancel"),
    search: t("picker-search"),
    clear: t("picker-clear"),
    searching: t("picker-searching"),
    invalid: t("picker-invalid"),
    searchFailed: t("picker-search-failed"),
    item: t("picker-item"),
    confidenceHigh: t("picker-confidence-high"),
    confidenceMedium: t("picker-confidence-medium"),
    confidenceLow: t("picker-confidence-low"),
  };
}
