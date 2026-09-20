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
  "menu-find-arxiv": "Find arXiv ID…",
  "menu-refresh": "Refresh alphaXiv Likes",
  "menu-clear": "Clear AlphaLikes data",

  "cell-loading": "Loading from alphaXiv…",
  "cell-unavailable": "No alphaXiv likes found for this item",
  "cell-pending":
    "A possible arXiv match was found — right-click to confirm it",
  "cell-filtered": "Hidden by the like-count filter",

  "progress-error": "AlphaLikes: the update failed: {message}",

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
} as const;

export type MessageId = keyof typeof MESSAGES;

let cache: Record<string, string> | null = null;

/**
 * Reads every message from Fluent once. Safe to call before any window exists:
 * failures leave the English fallbacks in place.
 */
export async function loadStrings(): Promise<void> {
  try {
    const l10n = Zotero.getMainWindow()?.document?.l10n;
    if (!l10n?.formatValues) return;

    const ids = Object.keys(MESSAGES) as MessageId[];
    const values = await l10n.formatValues(
      ids.map((id) => `${config.addonRef}-${id}`),
    );

    const next: Record<string, string> = {};
    ids.forEach((id, index) => {
      const value = values[index];
      next[id] = typeof value === "string" && value ? value : MESSAGES[id];
    });
    cache = next;
  } catch (error) {
    Zotero.debug(`[AlphaLikes] Could not load locale strings: ${error}`);
  }
}

export function t(id: MessageId, args?: Record<string, unknown>): string {
  let text = cache?.[id] ?? MESSAGES[id];
  if (!args) return text;

  for (const [key, value] of Object.entries(args)) {
    text = text.replaceAll(`{${key}}`, String(value));
  }
  return text;
}

/**
 * Every string the picker dialog needs, handed over as plain data because the
 * dialog runs outside the bundled plugin scope.
 */
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
