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

/**
 * How a like count is drawn inside its column cell.
 *
 * `plain`, `badge`, `ring` and `outline` are shape-only: they tint with the
 * colours from the colour section. The palette styles below carry their own
 * palette for the high/mid/low bands, because their look is the point.
 */
export type LikeStyle =
  | "plain"
  | "badge"
  | "ring"
  | "bookmark"
  | "morandi"
  | "academic"
  | "fresh"
  | "playful"
  | "outline"
  | "split"
  | "dot";

export const LIKE_STYLES: readonly LikeStyle[] = [
  "plain",
  "badge",
  "ring",
  "bookmark",
  "morandi",
  "academic",
  "fresh",
  "playful",
  "outline",
  "split",
  "dot",
];

/** Styles that bring their own palette for every band. */
export const PALETTE_STYLES: readonly LikeStyle[] = [
  "bookmark",
  "morandi",
  "academic",
  "fresh",
  "playful",
  "split",
  "dot",
];

/** Fixed cut-offs, or rank within the loaded items. */
export type ColorMode = "threshold" | "quantile";

/**
 * Which provider's count the Citations column shows.
 *
 * The choice is strict: the number in the column comes from this provider, or
 * the cell says it has none. A provider that is blocked or has no record for
 * an item is never quietly replaced by another one, because the counts are not
 * interchangeable - Google Scholar indexes preprints, theses and books that
 * OpenAlex does not, and the two figures for one paper can differ twofold.
 * Google Scholar is the default because its coverage is the widest; when it
 * asks for a human check the plugin waits and retries instead of showing a
 * different provider's number.
 */
export type CitationSourcePreference = CitationSource;

const CITATION_SOURCE_PREFERENCES: readonly CitationSourcePreference[] = [
  "googleScholar",
  "openAlex",
  "semanticScholar",
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
  /** Cell presentation: plain text, soft badge, glass pill or glass circle. */
  likeStyle: "badge" as LikeStyle,

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
  /** Read counts from Google Scholar. Best-effort: Google rate-limits reads. */
  /** Which provider's count is displayed. */
  citationSourcePreference: "googleScholar" as CitationSourcePreference,
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

/**
 * The like-count window.
 *
 * Out-of-range rows are always dimmed rather than hidden: the switch for that
 * choice was removed, and dimming keeps the row's own count visible, which is
 * what makes the window useful to begin with.
 */
export interface RangeFilter {
  enabled: boolean;
  min: number;
  max: number;
}

export function getRangeFilter(): RangeFilter {
  return {
    enabled: getPref("rangeFilterEnabled"),
    min: Math.max(0, Math.floor(getPref("rangeFilterMin"))),
    max: Math.max(0, Math.floor(getPref("rangeFilterMax"))),
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

/**
 * Storage values that were once valid, and the style that replaced them.
 *
 * Three styles were dropped in 1.5.0. A user who had picked one still has it
 * stored, so instead of silently resetting them to the default the value is
 * mapped onto the closest surviving look: the bare number, the pill, and the
 * navy fill respectively.
 */
const RETIRED_STYLES: Record<string, LikeStyle> = {
  minimal: "plain",
  glass: "badge",
  elegant: "academic",
};

/** Reads the display style, falling back to the default for unknown values. */
export function getLikeStyle(): LikeStyle {
  const raw = String(getPref("likeStyle"));
  if (LIKE_STYLES.includes(raw as LikeStyle)) return raw as LikeStyle;
  return RETIRED_STYLES[raw] ?? (PREF_DEFAULTS.likeStyle as LikeStyle);
}

/**
 * Providers ordered by how much of the literature they index.
 *
 * Only the settings pane and the docs need this ordering; the count itself
 * always comes from the single provider that was chosen.
 */
export const AUTHORITY_ORDER: readonly CitationSource[] = [
  "googleScholar",
  "openAlex",
  "semanticScholar",
];

/** Provider identifiers as they appear in the cache line and the tooltip. */
export type CitationSource = "googleScholar" | "openAlex" | "semanticScholar";

/**
 * Reads which provider's count should be shown.
 *
 * A value written by an older version (`auto`, from when choosing a source
 * meant "try this one first") is no longer valid and reads as the default, so
 * an upgraded install stops mixing providers without the user doing anything.
 */
export function getCitationSourcePreference(): CitationSourcePreference {
  const raw = getPref("citationSourcePreference");
  return CITATION_SOURCE_PREFERENCES.includes(raw as CitationSourcePreference)
    ? (raw as CitationSourcePreference)
    : (PREF_DEFAULTS.citationSourcePreference as CitationSourcePreference);
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
