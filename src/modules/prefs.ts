/**
 * Typed access to the `extensions.zotero.alphalikes.*` preference branch.
 *
 * Every reader falls back to a built-in default so the plugin keeps working
 * when a preference was never written (fresh install, manual branch reset, or
 * a value outside the allowed range).
 */

import { config } from "../../package.json";

/**
 * Full branch name, e.g. `extensions.zotero.alphalikes`.
 *
 * Readers and writers always use the full name together with `global = true`.
 * Passing the short name instead relies on `Zotero.Prefs` re-adding the
 * `extensions.zotero.` prefix, which is easy to get subtly wrong.
 */
export const PREF_BRANCH = config.prefsPrefix;

export type RangeFilterMode = "hide" | "dim";

/** How a like count is drawn inside its column cell. */
export type LikeStyle = "plain" | "badge" | "glass" | "ring";

const LIKE_STYLES: readonly LikeStyle[] = ["plain", "badge", "glass", "ring"];

/** Fixed cut-offs, or rank within the loaded items. */
export type ColorMode = "threshold" | "quantile";

/** Ordering applied when exporting selected items. */
export type ExportSort = "likes" | "citations" | "title" | "none";

const EXPORT_SORTS: readonly ExportSort[] = [
  "likes",
  "citations",
  "title",
  "none",
];

export const PREF_DEFAULTS = {
  /** Look up arXiv IDs for items that have none. */
  autoResolveNonArxiv: true,
  /**
   * Candidates at or above this confidence are adopted without asking.
   * Stored as a percentage because Gecko preferences cannot hold 0.9.
   */
  autoAcceptPercent: 90,
  /** Candidates below this confidence are discarded. */
  confirmPercent: 70,
  /** How many results to request per title search. */
  titleSearchResults: 5,
  useSemanticScholar: true,
  useOpenAlex: true,
  useCrossref: true,
  useUnpaywall: false,
  useArxivTitleSearch: true,
  /** Contact address for the OpenAlex/Unpaywall polite pools. */
  contactEmail: "",
  /** Minimum delay between two requests to the same host. */
  requestIntervalMs: 1500,
  requestTimeoutMs: 15_000,
  /** `0` disables automatic re-fetching of cached like counts. */
  cacheTtlDays: 0,
  colorEnabled: true,
  highLikesThreshold: 100,
  lowLikesThreshold: 10,
  highLikesColor: "#1a7f37",
  lowLikesColor: "#9aa0a6",
  /** Empty string keeps Zotero's theme colour. */
  midLikesColor: "",
  pendingColor: "#b45309",
  rangeFilterEnabled: false,
  /** `0` means "no lower bound" / "no upper bound". */
  rangeFilterMin: 0,
  rangeFilterMax: 0,
  /** `hide` blanks out-of-range cells, `dim` only greys them. */
  rangeFilterMode: "hide" as RangeFilterMode,
  /** Cell presentation: plain text, soft badge, glass pill or glass circle. */
  likeStyle: "glass" as LikeStyle,

  // --- Trend ---------------------------------------------------------------
  /** Append the day-over-day change to the like count, e.g. `2979 ↑12`. */
  showTrend: true,
  /** A rise of at least this many likes in a day counts as "hot". */
  trendHotDelta: 10,
  /** Daily snapshots kept in `Extra` before the oldest are dropped. */
  historyDays: 7,

  // --- Colour mode ---------------------------------------------------------
  /** `threshold` uses the fixed cut-offs below; `quantile` colours by rank. */
  colorMode: "threshold" as ColorMode,
  /** Percentile at or below which a count is "low" in quantile mode. */
  quantileLowPercent: 40,
  /** Percentile at or above which a count is "high" in quantile mode. */
  quantileHighPercent: 80,

  // --- Citations -----------------------------------------------------------
  /** Register the Citations column and look counts up. */
  citationsEnabled: true,
  /** Re-read citation counts after this many days (`0` disables). */
  citationCacheTtlDays: 7,

  // --- Notes ---------------------------------------------------------------
  noteIncludeCitations: true,
  noteIncludeTrend: true,
  noteIncludeArxivLink: true,

  // --- Export --------------------------------------------------------------
  exportSort: "likes" as ExportSort,
} as const;

export type PrefName = keyof typeof PREF_DEFAULTS;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads a preference, coercing it to the type of its default.
 */
export function getPref<K extends PrefName>(
  name: K,
): (typeof PREF_DEFAULTS)[K] {
  const fallback = PREF_DEFAULTS[name];
  let raw: boolean | string | number | undefined;

  try {
    raw = Zotero.Prefs.get(`${PREF_BRANCH}.${name}`, true);
  } catch {
    raw = undefined;
  }

  if (raw === undefined || raw === null) return fallback;

  if (typeof fallback === "boolean") {
    return Boolean(raw) as (typeof PREF_DEFAULTS)[K];
  }
  if (typeof fallback === "number") {
    const parsed =
      typeof raw === "number" ? raw : Number.parseFloat(String(raw));
    return (
      Number.isFinite(parsed) ? parsed : fallback
    ) as (typeof PREF_DEFAULTS)[K];
  }
  return String(raw) as (typeof PREF_DEFAULTS)[K];
}

export function setPref<K extends PrefName>(name: K, value: unknown): void {
  try {
    Zotero.Prefs.set(
      `${PREF_BRANCH}.${name}`,
      value as boolean | string | number,
      true,
    );
  } catch (error) {
    Zotero.debug(`[AlphaLikes] Could not write preference ${name}: ${error}`);
  }
}

export interface Thresholds {
  autoAccept: number;
  confirm: number;
}

/** Confidence thresholds, normalised so `confirm <= autoAccept`. */
export function getThresholds(): Thresholds {
  const autoAccept = clamp(getPref("autoAcceptPercent") / 100, 0.5, 1);
  const confirm = clamp(getPref("confirmPercent") / 100, 0, autoAccept);
  return { autoAccept, confirm };
}

export interface RangeFilter {
  enabled: boolean;
  min: number;
  max: number;
  mode: RangeFilterMode;
}

export function getRangeFilter(): RangeFilter {
  return {
    enabled: getPref("rangeFilterEnabled"),
    min: Math.max(0, Math.floor(getPref("rangeFilterMin"))),
    max: Math.max(0, Math.floor(getPref("rangeFilterMax"))),
    mode: getPref("rangeFilterMode") === "dim" ? "dim" : "hide",
  };
}

/** Whether a like count passes the configured `[min, max]` window. */
export function isWithinRange(likes: number, filter: RangeFilter): boolean {
  if (!filter.enabled) return true;
  if (likeCountBelowMin(likes, filter)) return false;
  return !(filter.max > 0 && likes > filter.max);
}

function likeCountBelowMin(likes: number, filter: RangeFilter): boolean {
  return filter.min > 0 && likes < filter.min;
}

export interface ColorScheme {
  enabled: boolean;
  /** Whether cut-offs are fixed numbers or percentiles of the visible set. */
  mode: ColorMode;
  quantileLowPercent: number;
  quantileHighPercent: number;
  high: string;
  low: string;
  mid: string;
  pending: string;
  highThreshold: number;
  lowThreshold: number;
}

/** Reads the display style, falling back to the default for unknown values. */
export function getLikeStyle(): LikeStyle {
  const raw = getPref("likeStyle");
  return LIKE_STYLES.includes(raw as LikeStyle)
    ? (raw as LikeStyle)
    : (PREF_DEFAULTS.likeStyle as LikeStyle);
}

/** Reads the export ordering, falling back to the default for junk values. */
export function getExportSort(): ExportSort {
  const raw = getPref("exportSort");
  return EXPORT_SORTS.includes(raw as ExportSort)
    ? (raw as ExportSort)
    : (PREF_DEFAULTS.exportSort as ExportSort);
}

export interface TrendPrefs {
  enabled: boolean;
  /** Day-over-day rise that marks a paper as hot. */
  hotDelta: number;
  /** Snapshots kept in `Extra`. */
  historyDays: number;
}

export function getTrendPrefs(): TrendPrefs {
  return {
    enabled: getPref("showTrend"),
    hotDelta: Math.max(0, Math.floor(getPref("trendHotDelta"))),
    historyDays: clamp(Math.floor(getPref("historyDays")), 2, 30),
  };
}

/**
 * Colour configuration. The high threshold is kept above the low threshold so
 * a swapped pair cannot invert the colouring.
 */
export function getColorScheme(): ColorScheme {
  const highThreshold = Math.max(0, Math.floor(getPref("highLikesThreshold")));
  const lowThreshold = Math.min(
    highThreshold,
    Math.max(0, Math.floor(getPref("lowLikesThreshold"))),
  );

  return {
    enabled: getPref("colorEnabled"),
    mode: getPref("colorMode") === "quantile" ? "quantile" : "threshold",
    quantileLowPercent: clamp(getPref("quantileLowPercent"), 0, 99),
    quantileHighPercent: clamp(getPref("quantileHighPercent"), 1, 100),
    high: getPref("highLikesColor").trim(),
    low: getPref("lowLikesColor").trim(),
    mid: getPref("midLikesColor").trim(),
    pending: getPref("pendingColor").trim(),
    highThreshold,
    lowThreshold,
  };
}

export interface CitationPrefs {
  enabled: boolean;
  cacheTtlDays: number;
}

export function getCitationPrefs(): CitationPrefs {
  return {
    enabled: getPref("citationsEnabled"),
    cacheTtlDays: Math.max(0, Math.floor(getPref("citationCacheTtlDays"))),
  };
}

export type ColorBucket = "high" | "low" | "mid";

export function colorBucket(likes: number, scheme: ColorScheme): ColorBucket {
  if (likes >= scheme.highThreshold) return "high";
  if (likes <= scheme.lowThreshold) return "low";
  return "mid";
}

export function getResolverPrefs() {
  return {
    useSemanticScholar: getPref("useSemanticScholar"),
    useOpenAlex: getPref("useOpenAlex"),
    useCrossref: getPref("useCrossref"),
    useUnpaywall: getPref("useUnpaywall"),
    useArxivTitleSearch: getPref("useArxivTitleSearch"),
    titleSearchResults: clamp(Math.floor(getPref("titleSearchResults")), 1, 20),
    contactEmail: getPref("contactEmail").trim(),
    ...getThresholds(),
  };
}

export function getRequestPrefs() {
  return {
    timeoutMs: clamp(getPref("requestTimeoutMs"), 1_000, 60_000),
    intervalMs: clamp(getPref("requestIntervalMs"), 0, 30_000),
    cacheTtlDays: Math.max(0, getPref("cacheTtlDays")),
  };
}

/**
 * Calls `handler` whenever any AlphaLikes preference changes.
 *
 * Zotero keys observers by the exact full preference name, so each key has to
 * be registered individually.
 *
 * @returns a function that removes every registered observer.
 */
export function observePrefs(handler: (name: string) => void): () => void {
  const symbols: symbol[] = [];

  for (const name of Object.keys(PREF_DEFAULTS) as PrefName[]) {
    const fullName = `${PREF_BRANCH}.${name}`;
    try {
      symbols.push(
        Zotero.Prefs.registerObserver(
          fullName,
          () => {
            try {
              handler(name);
            } catch (error) {
              Zotero.debug(`[AlphaLikes] Preference observer failed: ${error}`);
            }
          },
          true,
        ),
      );
    } catch {
      // Observers are a convenience; rendering still works without them.
    }
  }

  return () => {
    for (const symbol of symbols) {
      try {
        Zotero.Prefs.unregisterObserver(symbol);
      } catch {
        // Already gone.
      }
    }
  };
}
