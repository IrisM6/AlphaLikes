/**
 * The stateful core of AlphaLikes.
 *
 * `getCellData()` is a synchronous API because Zotero's item-tree data
 * provider is synchronous: it returns a cached value or a loading marker
 * immediately, and the asynchronous work (resolving an arXiv ID, then reading
 * the like count) invalidates the tree when it finishes.
 */

import {
  ARXIV_ID_KEY,
  buildAlphaXivURL,
  extractArxivID,
  readCachedLikes,
  readLikesUpdatedAt,
  stripAlphaLikesData,
  upsertLikesCache,
  upsertResolvedArxivID,
} from "./arxiv-id";
import {
  citationCountsFromSemanticScholar,
  googleScholarCitationCount,
  googleScholarCitationSearchURL,
  googleScholarResultBlocks,
  googleScholarResultTitle,
  isHighImpact,
  openAlexCitationSearchURL,
  openAlexCitationURL,
  openAlexSearchResults,
  openAlexWorkInfo,
  primaryCitationCount,
  primaryCitationSource,
  readCitations,
  readCitationsUpdatedAt,
  semanticScholarCitationURL,
  upsertCitations,
  type CitationCounts,
} from "./citations";
import {
  CITATION_AUTHORITY_ORDER,
  CITATION_SOURCE_LABELS,
  type CitationSourceKey,
} from "./citations";
import { ERROR_RETRY_DELAY_MS, RESOLUTION_RETRY_DELAY_MS } from "./constants";
import {
  latestTrend,
  readLikesHistory,
  recordLikesSnapshot,
  trendOverDays,
  type LikesSnapshot,
  type TrendDelta,
} from "./history";
import { PacedRequester } from "./http";
import {
  CELL_LOADING,
  CELL_PENDING,
  CELL_UNAVAILABLE,
  fromSortableValue,
  parseLikesFromDocument,
  toSortableValue,
  withValueDecorations,
} from "./likes";
import {
  getCitationPrefs,
  getCitationSourcePreference,
  getColorScheme,
  getPref,
  getRangeFilter,
  getRequestPrefs,
  getResolverPrefs,
  getTrendPrefs,
  isWithinRange,
  observePrefs,
} from "./prefs";
import { quantileThresholds } from "./quantile";
import {
  findArxivCandidates,
  normalizeDoi,
  type ArxivCandidate,
  type PaperMetadata,
  type ResolverDeps,
} from "./resolver";
import { normalizeText, titleSimilarity, yearDistance } from "./similarity";

/** Item types that can plausibly have an arXiv preprint. */
const RESOLVABLE_ITEM_TYPES = new Set([
  "bookSection",
  "conferencePaper",
  "journalArticle",
  "manuscript",
  "preprint",
  "report",
  "thesis",
]);

/** Shorter titles are too ambiguous to search for automatically. */
const MIN_TITLE_LENGTH = 20;

const RESOLUTION_CACHE_TTL_SUCCESS_MS = 24 * 60 * 60_000;
const RESOLUTION_CACHE_TTL_MISS_MS = 10 * 60_000;

type ItemState =
  | { kind: "loading" }
  | { kind: "pending" }
  | { kind: "success"; arxivID: string; likes: number }
  | { kind: "failed"; retryAfter: number };

type CitationState =
  | { kind: "loading" }
  | { kind: "success"; counts: CitationCounts }
  | { kind: "failed"; retryAfter: number };

interface ResolutionCacheEntry {
  candidates: ArxivCandidate[];
  createdAt: number;
  expiresAt: number;
}

/**
 * How long computed percentile cut-offs are reused. Quoting the population
 * keeps the data provider from rescanning on every rendered cell, while still
 * tracking a scrolling list closely enough to feel live.
 */
const QUANTILE_REFRESH_MS = 2_000;

/** Title similarity an OpenAlex search hit must reach to be trusted. */
const CITATION_TITLE_MATCH_MIN = 0.85;

/** Bounds on the population sample, so a huge library stays responsive. */
const MIN_QUANTILE_VALUES = 5;

export interface CitationCellPlan {
  value: string;
  text: string;
  count: number | null;
  highImpact: boolean;
  /** Display name of the provider whose count is shown, for the tooltip. */
  source: string | null;
}

export interface EffectiveThresholds {
  high: number;
  low: number;
  /** Which rule produced them, for the cell's tooltip. */
  source: "threshold" | "quantile";
  sampleSize: number;
}

export interface BatchResolutionResult {
  /** Items handed to the batch action. */
  total: number;
  /** Items that already carried an arXiv ID. */
  alreadyKnown: number;
  /** Items whose match cleared the auto-accept threshold. */
  applied: number;
  /** Items with a candidate waiting for manual confirmation. */
  pending: number;
  /** Items for which nothing plausible was found. */
  notFound: number;
}

export interface ItemTrend {
  /** Day-over-day change, when two snapshots exist. */
  latest: TrendDelta | null;
  /** Change over the configured window, when history reaches back that far. */
  window: TrendDelta | null;
  history: LikesSnapshot[];
  /** A day-over-day rise at or above the configured threshold. */
  hot: boolean;
}

/**
 * Provider precedence for the displayed count.
 *
 * `auto` is the built-in authority order; an explicit choice is tried first and
 * the rest of the order follows, so naming a provider never costs the fallback.
 */
function citationOrder(): CitationSourceKey[] {
  const preference = getCitationSourcePreference();
  if (preference === "auto") return [...CITATION_AUTHORITY_ORDER];

  const rest = CITATION_AUTHORITY_ORDER.filter((key) => key !== preference);
  return [preference, ...rest];
}

function isSameYearOrAdjacent(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return true;
  const distance = yearDistance(a, b);
  return distance === null || distance <= 1;
}

export interface CellRenderPlan {
  /** Raw value handed to Zotero's sortable data provider. */
  value: string;
  /** Display text after sort-key decoding. */
  text: string;
  /** Like count when the cell holds a number. */
  likes: number | null;
  /** Whether the like-count range filter excludes this cell. */
  filteredOut: boolean;
  /** Snapshot deltas, or `null` when the trend display is switched off. */
  trend: ItemTrend | null;
}

function safeGetField(item: Zotero.Item, field: string): string {
  try {
    return String(item.getField(field) || "");
  } catch {
    return "";
  }
}

function yearFromDate(date: string): number | null {
  const match = (date || "").match(/(\d{4})/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return year >= 1900 && year <= 2100 ? year : null;
}

/**
 * `getCreators()` returns given/last names, or the whole name in `lastName`
 * for single-field creators such as consortiums.
 */
function rawCreatorName(creator: unknown): string {
  const value = creator as {
    creatorType?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    fieldMode?: number;
  };

  if (value.creatorType && value.creatorType !== "author") return "";
  if (value.name) return String(value.name).trim();
  if (value.fieldMode === 1) return String(value.lastName || "").trim();
  return `${value.firstName || ""} ${value.lastName || ""}`.trim();
}

/**
 * The part of an item tree this module touches, as it exists across the Zotero
 * versions we support. `invalidateRowCache` is only a method on newer builds,
 * and the cache itself is internal in all of them, so both spellings are
 * optional here.
 */
export interface ItemTreeView {
  invalidateRowCache?: (invalidateAll?: boolean) => void;
  _rowCache?: unknown;
  tree?: { invalidate?: () => void };
}

/**
 * Makes the next paint of an item tree rebuild its cell values from scratch.
 *
 * Redrawing alone is not enough: a cell's value is memoised per row, so a
 * preference that only changes how an existing value is drawn (the trend
 * arrow, colours, styles) keeps showing the value the data provider produced
 * *before* the change until the row cache is dropped. Zotero does the same two
 * steps for its own display-only preferences - clear the cache, then redraw.
 */
export function dropRowCache(itemsView: ItemTreeView | null | undefined): void {
  if (!itemsView) return;

  if (typeof itemsView.invalidateRowCache === "function") {
    itemsView.invalidateRowCache(true);
  } else if (itemsView._rowCache) {
    itemsView._rowCache = {};
  }
  itemsView.tree?.invalidate?.();
}

/**
 * Repaints every item tree that is showing our columns.
 */
function refreshItemTrees(): void {
  for (const win of Zotero.getMainWindows()) {
    try {
      dropRowCache(win.ZoteroPane?.itemsView as ItemTreeView | undefined);
    } catch {
      // A window can disappear while an asynchronous request is completing.
    }
  }
}

export class AlphaLikesService {
  private requester: PacedRequester;
  private itemStates = new Map<number, ItemState>();
  private pendingByItem = new Map<number, ArxivCandidate[]>();
  private resolutionCache = new Map<string, ResolutionCacheEntry>();
  private inFlightLikes = new Map<string, Promise<number | null>>();
  private inFlightResolution = new Map<string, Promise<ArxivCandidate[]>>();
  private staleRefreshing = new Set<number>();
  private stopObservingPrefs: (() => void) | null = null;
  private disposed = false;

  private citationStates = new Map<number, CitationState>();
  private inFlightCitations = new Map<string, Promise<CitationCounts | null>>();

  /**
   * Latest like count seen for each item the column has rendered. This is the
   * population the percentile colouring ranks against, so "top 20%" means the
   * top 20% of the counts the user has actually loaded.
   */
  private observedLikes = new Map<number, number>();
  private quantileCache: {
    thresholds: EffectiveThresholds | null;
    computedAt: number;
  } | null = null;

  constructor() {
    const { timeoutMs, intervalMs } = getRequestPrefs();
    this.requester = new PacedRequester({ timeoutMs, intervalMs });
    this.stopObservingPrefs = observePrefs((name) => this.onPrefChanged(name));
  }

  // -------------------------------------------------------------------------
  // Cell rendering
  // -------------------------------------------------------------------------

  /**
   * Synchronous entry point used by the column's data provider.
   */
  getCellData(item: Zotero.Item): string {
    return this.planCell(item).value;
  }

  /**
   * Same computation as `getCellData`, plus the metadata the cell renderer
   * needs for colouring. Kept separate so the colouring rules stay testable
   * and the data provider stays a one-liner.
   */
  planCell(item: Zotero.Item): CellRenderPlan {
    const raw = this.computeCellValue(item);
    const text = fromSortableValue(raw);
    const likes = /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;

    // Feed the percentile population, including counts the range filter hides.
    if (likes !== null) this.observedLikes.set(item.id, likes);

    const filter = getRangeFilter();
    const filteredOut = likes !== null && !isWithinRange(likes, filter);

    // Out-of-range rows keep their count and get dimmed by the renderer: the
    // value itself is never blanked, so sorting still sees the real figure.
    const value = raw;

    const trend =
      likes !== null && getTrendPrefs().enabled ? this.readTrend(item) : null;

    return {
      // The renderer only receives the data string, so the delta travels with
      // it. Decorations follow the zero-padded sort key, which keeps sorting
      // numeric.
      value: withValueDecorations(
        value,
        trend?.latest ? [trend.latest.delta] : [],
      ),
      text,
      likes,
      filteredOut,
      trend,
    };
  }

  /**
   * Cut-offs used for colouring.
   *
   * In `quantile` mode these are percentiles of the loaded like counts; when
   * the sample is too small, or every loaded item has the same count, the
   * fixed thresholds are used so the column never collapses to one colour.
   */
  getEffectiveThresholds(): EffectiveThresholds {
    const scheme = getColorScheme();
    const fallback: EffectiveThresholds = {
      high: scheme.highThreshold,
      low: scheme.lowThreshold,
      source: "threshold",
      sampleSize: this.observedLikes.size,
    };

    if (scheme.mode !== "quantile") return fallback;

    const now = Date.now();
    if (
      this.quantileCache &&
      now - this.quantileCache.computedAt < QUANTILE_REFRESH_MS
    ) {
      return this.quantileCache.thresholds ?? fallback;
    }

    const values = [...this.observedLikes.values()];
    const derived =
      values.length >= MIN_QUANTILE_VALUES
        ? quantileThresholds(
            values,
            scheme.quantileLowPercent,
            scheme.quantileHighPercent,
          )
        : null;

    const thresholds: EffectiveThresholds | null = derived
      ? {
          high: derived.high,
          low: derived.low,
          source: "quantile",
          sampleSize: derived.sampleSize,
        }
      : null;

    this.quantileCache = { thresholds, computedAt: now };
    return thresholds ?? fallback;
  }

  /** Snapshot history and derived deltas for one item. */
  readTrend(item: Zotero.Item): ItemTrend {
    const prefs = getTrendPrefs();
    const history = readLikesHistory(safeGetField(item, "extra"));
    const latest = latestTrend(history);
    const window = trendOverDays(history, prefs.historyDays);

    return {
      latest,
      window,
      history,
      hot:
        latest !== null && latest.delta >= prefs.hotDelta && prefs.hotDelta > 0,
    };
  }

  // -------------------------------------------------------------------------
  // Citations
  // -------------------------------------------------------------------------

  /**
   * Synchronous entry point for the Citations column, mirroring `getCellData`.
   */
  getCitationCellData(item: Zotero.Item): string {
    return this.planCitationCell(item).value;
  }

  planCitationCell(item: Zotero.Item): CitationCellPlan {
    const prefs = getCitationPrefs();
    if (!prefs.enabled)
      return {
        value: "",
        text: "",
        count: null,
        highImpact: false,
        source: null,
      };

    const extra = safeGetField(item, "extra");
    const cached = readCitations(extra);

    if (cached) {
      this.citationStates.delete(item.id);
      if (this.isCitationCacheStale(extra, prefs.cacheTtlDays)) {
        this.scheduleCitationRefresh(item);
      }
      return this.citationPlanFrom(cached);
    }

    const state = this.citationStates.get(item.id);
    if (state) {
      if (state.kind === "success") return this.citationPlanFrom(state.counts);
      if (state.kind === "loading") {
        return {
          value: CELL_LOADING,
          text: CELL_LOADING,
          count: null,
          highImpact: false,
          source: null,
        };
      }
      if (state.retryAfter > Date.now()) {
        return {
          value: "",
          text: "",
          count: null,
          highImpact: false,
          source: null,
        };
      }
    }

    if (!this.disposed && this.hasCitationKey(item)) {
      this.citationStates.set(item.id, { kind: "loading" });
      void this.populateCitations(item);
      return {
        value: CELL_LOADING,
        text: CELL_LOADING,
        count: null,
        highImpact: false,
        source: null,
      };
    }

    return {
      value: "",
      text: "",
      count: null,
      highImpact: false,
      source: null,
    };
  }

  private citationPlanFrom(counts: CitationCounts): CitationCellPlan {
    const order = citationOrder();
    const count = primaryCitationCount(counts, order);
    if (count === null) {
      return {
        value: "",
        text: "",
        count: null,
        highImpact: false,
        source: null,
      };
    }

    const primary = primaryCitationSource(counts, order);
    const highImpact = isHighImpact(counts);

    return {
      // `1` asks the renderer for the high-impact marker; the provider key that
      // follows becomes the tooltip's "source" line.
      value: withValueDecorations(toSortableValue(count), [
        ...(highImpact ? [1] : []),
        ...(primary ? [primary] : []),
      ]),
      text: String(count),
      count,
      highImpact,
      source: primary ? CITATION_SOURCE_LABELS[primary] : null,
    };
  }

  /** Whether we hold an identifier precise enough to look citations up. */
  private hasCitationKey(item: Zotero.Item): boolean {
    if (safeGetField(item, "DOI").trim()) return true;
    return this.getItemArxivID(item) !== null;
  }

  private isCitationCacheStale(extra: string, ttlDays: number): boolean {
    if (!ttlDays) return false;

    const updatedAt = readCitationsUpdatedAt(extra);
    if (!updatedAt) return true;
    return Date.now() - updatedAt.getTime() > ttlDays * 86_400_000;
  }

  private scheduleCitationRefresh(item: Zotero.Item): void {
    if (this.disposed) return;
    if (this.citationStates.get(item.id)?.kind === "loading") return;

    this.citationStates.set(item.id, { kind: "loading" });
    void this.populateCitations(item).catch(() => undefined);
  }

  private async populateCitations(item: Zotero.Item): Promise<void> {
    const arxivID = this.getItemArxivID(item);

    try {
      const counts = await this.fetchCitations(item, arxivID);
      if (this.disposed) return;

      if (counts === null) {
        this.citationStates.set(item.id, {
          kind: "failed",
          retryAfter: Date.now() + ERROR_RETRY_DELAY_MS,
        });
        return;
      }

      this.citationStates.set(item.id, { kind: "success", counts });
      await this.writeExtra(item, (extra) => upsertCitations(extra, counts));
    } catch (error) {
      if (!this.disposed) {
        this.citationStates.set(item.id, {
          kind: "failed",
          retryAfter: Date.now() + ERROR_RETRY_DELAY_MS,
        });
        this.debug(`citation lookup failed for item ${item.id}: ${error}`);
      }
    } finally {
      if (!this.disposed) refreshItemTrees();
    }
  }

  /**
   * Merges whatever the enabled providers can tell us.
   *
   * Semantic Scholar is asked by DOI or arXiv ID and is skipped silently when
   * it rate-limits. OpenAlex answers precisely for a DOI; without one it is
   * searched by title, and a hit is only trusted when its title matches and
   * its year is within a year of ours, because OpenAlex carries duplicate and
   * mis-attributed records that a naive "first result" would accept.
   */
  private fetchCitations(
    item: Zotero.Item,
    arxivID: string | null,
  ): Promise<CitationCounts | null> {
    const paper = this.readPaperMetadata(item);
    const key = `${paper.doi || ""}|${arxivID || ""}|${normalizeText(paper.title)}`;

    const existing = this.inFlightCitations.get(key);
    if (existing) return existing;

    const request = this.collectCitations(paper, arxivID).finally(() =>
      this.inFlightCitations.delete(key),
    );

    this.inFlightCitations.set(key, request);
    return request;
  }

  private async collectCitations(
    paper: PaperMetadata,
    arxivID: string | null,
  ): Promise<CitationCounts | null> {
    const prefs = getResolverPrefs();
    const citationPrefs = getCitationPrefs();
    let merged: CitationCounts = {};
    let answered = false;

    if (citationPrefs.useGoogleScholar) {
      const scholar = await this.collectGoogleScholarCitation(paper);
      if (scholar !== null) {
        merged = { ...merged, googleScholar: scholar };
        answered = true;
      }
    }

    if (prefs.useSemanticScholar) {
      const url = semanticScholarCitationURL({
        doi: paper.doi,
        arxivID: arxivID ?? undefined,
      });
      if (url) {
        const payload = await this.safeJSON("Semantic Scholar citations", url);
        const counts = citationCountsFromSemanticScholar(payload);
        if (counts) {
          merged = { ...merged, ...counts };
          answered = true;
        }
      }
    }

    if (prefs.useOpenAlex) {
      const openAlex = await this.collectOpenAlexCitations(paper, prefs);
      if (openAlex) {
        merged = { ...merged, ...openAlex };
        answered = true;
      }
    }

    return answered ? merged : null;
  }

  /**
   * Reads Google Scholar's "Cited by" count.
   *
   * Scholar has no API, so the public results page is fetched and the first
   * result whose title resembles the item's is used. A block page (consent
   * interstitial, captcha, rate limit) is reported as a miss and logged rather
   * than retried: hammering Scholar is the fastest way to stay blocked, and the
   * other providers still answer, so the column keeps a number either way.
   *
   * This is the one request the plugin makes that reads an interface meant for
   * browsing rather than an API, which is why it can be switched off on its own
   * in the settings.
   */
  private async collectGoogleScholarCitation(
    paper: PaperMetadata,
  ): Promise<number | null> {
    if (!paper.title || paper.title.length < 10) return null;

    const html = await this.safeText(
      "Google Scholar citations",
      googleScholarCitationSearchURL(paper.title),
      "text/html,application/xhtml+xml",
    );
    if (!html) return null;

    const verdict = googleScholarCitationCount(html);
    if (verdict === -1) {
      this.debug(
        "Google Scholar answered with a block or consent page; skipping it",
      );
      return null;
    }
    if (verdict === null) return null;

    // The count belongs to the first result, so the title has to agree before
    // it is attributed to this item.
    const titles = googleScholarResultBlocks(html)
      .map((block) => googleScholarResultTitle(block))
      .filter(Boolean);
    if (!titles.length) return verdict;

    const similarity = Math.max(
      ...titles.map((title) => titleSimilarity(paper.title, title)),
    );
    return similarity >= CITATION_TITLE_MATCH_MIN ? verdict : null;
  }

  private async collectOpenAlexCitations(
    paper: PaperMetadata,
    prefs: { contactEmail: string; titleSearchResults: number },
  ): Promise<CitationCounts | null> {
    const byDoi = openAlexCitationURL({
      doi: paper.doi,
      contactEmail: prefs.contactEmail,
    });

    if (byDoi) {
      const payload = await this.safeJSON("OpenAlex citations", byDoi);
      const info = openAlexWorkInfo(payload);
      if (info) return info.counts;
    }

    // No DOI, or the DOI is not indexed: fall back to a verified title search.
    if (!paper.title || paper.title.length < 10) return null;

    const payload = await this.safeJSON(
      "OpenAlex citation search",
      openAlexCitationSearchURL(paper.title, {
        perPage: Math.min(5, Math.max(2, prefs.titleSearchResults)),
        contactEmail: prefs.contactEmail,
      }),
    );

    for (const info of openAlexSearchResults(payload)) {
      if (titleSimilarity(paper.title, info.title) < CITATION_TITLE_MATCH_MIN) {
        continue;
      }
      if (!isSameYearOrAdjacent(paper.year, info.year)) continue;
      return info.counts;
    }

    return null;
  }

  /** Fetches a page as text, logging failures instead of aborting the merge. */
  private async safeText(
    label: string,
    url: string,
    accept?: string,
  ): Promise<string | null> {
    try {
      return accept
        ? await this.requester.requestText(url, accept)
        : await this.requester.requestText(url);
    } catch (error) {
      this.debug(`${label} failed: ${error}`);
      return null;
    }
  }

  /** Runs a request, logging failures instead of letting them abort the merge. */
  private async safeJSON(label: string, url: string): Promise<unknown> {
    try {
      return await this.requester.requestJSON(url);
    } catch (error) {
      this.debug(`${label} failed: ${error}`);
      return null;
    }
  }

  /**
   * Re-reads citations, ignoring the cached value and any failure cooldown.
   */
  async refreshCitations(items: Zotero.Item[]): Promise<void> {
    for (const item of items.filter(Boolean)) {
      this.citationStates.delete(item.id);
    }
    refreshItemTrees();

    for (const item of items.filter(Boolean)) {
      if (this.disposed) return;
      if (!this.hasCitationKey(item)) continue;
      await this.populateCitations(item);
    }
  }

  private computeCellValue(item: Zotero.Item): string {
    const arxivID = this.getItemArxivID(item);
    if (arxivID) return this.cellForKnownID(item, arxivID);

    if (!getPref("autoResolveNonArxiv")) return "";
    if (!this.canResolve(item)) return "";

    return this.cellForUnknownID(item);
  }

  private cellForKnownID(item: Zotero.Item, arxivID: string): string {
    const extra = safeGetField(item, "extra");
    const cached = readCachedLikes(extra);

    if (cached !== null) {
      if (this.isCacheStale(extra)) this.scheduleStaleRefresh(item, arxivID);
      this.itemStates.delete(item.id);
      return toSortableValue(cached);
    }

    const state = this.itemStates.get(item.id);
    if (state) {
      if (state.kind === "success" && state.arxivID === arxivID) {
        return toSortableValue(state.likes);
      }
      if (state.kind === "loading") return CELL_LOADING;
      if (state.kind === "pending") return CELL_PENDING;
      if (state.kind === "failed" && state.retryAfter > Date.now()) {
        return CELL_UNAVAILABLE;
      }
      // A failed lookup whose cooldown elapsed falls through and is retried.
    }

    if (!this.disposed) {
      this.itemStates.set(item.id, { kind: "loading" });
      void this.populateLikes(item, arxivID);
    }
    return CELL_LOADING;
  }

  private cellForUnknownID(item: Zotero.Item): string {
    const state = this.itemStates.get(item.id);

    if (state) {
      if (state.kind === "pending") return CELL_PENDING;
      if (state.kind === "success") return toSortableValue(state.likes);
      if (state.kind === "loading") return CELL_LOADING;
      if (state.retryAfter > Date.now()) return CELL_UNAVAILABLE;
    }

    if (!this.disposed) {
      this.itemStates.set(item.id, { kind: "loading" });
      void this.resolveItem(item);
    }
    return CELL_LOADING;
  }

  private canResolve(item: Zotero.Item): boolean {
    try {
      if (typeof item.isRegularItem === "function" && !item.isRegularItem()) {
        return false;
      }
    } catch {
      return false;
    }

    if (!RESOLVABLE_ITEM_TYPES.has(item.itemType)) return false;
    if (safeGetField(item, "title").trim().length < MIN_TITLE_LENGTH) {
      return false;
    }

    // Require at least one corroborating signal beyond the title so that
    // unrelated items never trigger network traffic.
    return Boolean(
      safeGetField(item, "DOI").trim() || safeGetField(item, "date").trim(),
    );
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  getItemArxivID(item: Zotero.Item): string | null {
    return extractArxivID(
      safeGetField(item, "url"),
      safeGetField(item, "extra"),
      safeGetField(item, "DOI"),
    );
  }

  readPaperMetadata(item: Zotero.Item): PaperMetadata {
    return {
      title: safeGetField(item, "title").trim(),
      doi: normalizeDoi(safeGetField(item, "DOI")),
      authors: this.readAuthors(item),
      year: yearFromDate(safeGetField(item, "date")),
      extra: safeGetField(item, "extra"),
    };
  }

  private readAuthors(item: Zotero.Item): string[] {
    try {
      if (typeof item.getCreators !== "function") return [];

      return (item.getCreators() || [])
        .map((creator) => rawCreatorName(creator))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private resolutionKey(paper: PaperMetadata): string {
    if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
    return `title:${normalizeText(paper.title)}`;
  }

  // -------------------------------------------------------------------------
  // Likes
  // -------------------------------------------------------------------------

  private isCacheStale(extra: string): boolean {
    const { cacheTtlDays } = getRequestPrefs();
    if (!cacheTtlDays) return false;

    const updatedAt = readLikesUpdatedAt(extra);
    if (!updatedAt) return true;
    return Date.now() - updatedAt.getTime() > cacheTtlDays * 86_400_000;
  }

  /**
   * Re-fetches an expired value in the background while the stale number stays
   * visible, so enabling the TTL never blanks the column.
   */
  private scheduleStaleRefresh(item: Zotero.Item, arxivID: string): void {
    if (this.disposed || this.staleRefreshing.has(item.id)) return;
    this.staleRefreshing.add(item.id);

    void this.populateLikes(item, arxivID, { force: true }).finally(() => {
      this.staleRefreshing.delete(item.id);
    });
  }

  private async populateLikes(
    item: Zotero.Item,
    arxivID: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    try {
      const likes = await this.fetchLikes(arxivID);
      if (this.disposed) return;

      // The item may have been edited while waiting in the paced queue.
      if (this.getItemArxivID(item) !== arxivID) {
        this.itemStates.delete(item.id);
        return;
      }

      if (likes === null) {
        this.itemStates.set(item.id, {
          kind: "failed",
          retryAfter: Date.now() + ERROR_RETRY_DELAY_MS,
        });
        return;
      }

      this.itemStates.set(item.id, { kind: "success", arxivID, likes });
      this.observedLikes.set(item.id, likes);

      const { historyDays } = getTrendPrefs();
      await this.writeExtra(item, (extra) =>
        // The snapshot is what makes `2979 ↑12` possible on a later run.
        recordLikesSnapshot(
          upsertLikesCache(extra, likes),
          likes,
          new Date(),
          historyDays,
        ),
      );
    } catch (error) {
      if (!this.disposed) {
        this.itemStates.set(item.id, {
          kind: "failed",
          retryAfter: Date.now() + ERROR_RETRY_DELAY_MS,
        });
        this.debug(`failed to fetch likes for ${arxivID}: ${error}`);
      }
    } finally {
      if (!this.disposed) refreshItemTrees();
      if (options.force) this.staleRefreshing.delete(item.id);
    }
  }

  /**
   * Concurrent requests for the same paper share one network round trip; an
   * explicit refresh therefore reuses an in-flight fetch rather than racing it.
   */
  private fetchLikes(arxivID: string): Promise<number | null> {
    const existing = this.inFlightLikes.get(arxivID);
    if (existing) return existing;

    const request = this.requester
      .requestHTML(buildAlphaXivURL(arxivID))
      .then((doc) => parseLikesFromDocument(doc))
      .finally(() => this.inFlightLikes.delete(arxivID));

    this.inFlightLikes.set(arxivID, request);
    return request;
  }

  // -------------------------------------------------------------------------
  // arXiv ID resolution
  // -------------------------------------------------------------------------

  private resolverDeps(): ResolverDeps {
    return {
      requestJSON: (url: string) => this.requester.requestJSON(url),
      requestXML: (url: string) => this.requester.requestXML(url),
      prefs: getResolverPrefs(),
      debug: (message: string) => this.debug(message),
    };
  }

  private async getCandidatesForPaper(
    paper: PaperMetadata,
    force: boolean,
  ): Promise<ArxivCandidate[]> {
    const key = this.resolutionKey(paper);

    if (!force) {
      const cached = this.resolutionCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.candidates;
    }

    const inFlight = this.inFlightResolution.get(key);
    if (inFlight) return inFlight;

    const request = findArxivCandidates(paper, this.resolverDeps())
      .then((candidates) => {
        const ttl = candidates.length
          ? RESOLUTION_CACHE_TTL_SUCCESS_MS
          : RESOLUTION_CACHE_TTL_MISS_MS;
        this.resolutionCache.set(key, {
          candidates,
          createdAt: Date.now(),
          expiresAt: Date.now() + ttl,
        });
        return candidates;
      })
      .finally(() => this.inFlightResolution.delete(key));

    this.inFlightResolution.set(key, request);
    return request;
  }

  /** Runs the resolver for arbitrary metadata (used by the picker dialog). */
  async searchArxiv(paper: PaperMetadata): Promise<ArxivCandidate[]> {
    return this.getCandidatesForPaper(paper, true);
  }

  private async resolveItem(
    item: Zotero.Item,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const paper = this.readPaperMetadata(item);

    try {
      const candidates = await this.getCandidatesForPaper(
        paper,
        options.force ?? false,
      );
      if (this.disposed) return;

      // Another window may have resolved the item in the meantime.
      if (this.getItemArxivID(item)) return;

      this.pendingByItem.set(item.id, candidates);
      const best = candidates[0];

      if (best?.confidence === "high") {
        await this.applyArxivID(item, best.arxivID);
        return;
      }

      if (best?.confidence === "medium") {
        this.itemStates.set(item.id, { kind: "pending" });
        return;
      }

      this.itemStates.set(item.id, {
        kind: "failed",
        retryAfter: Date.now() + RESOLUTION_RETRY_DELAY_MS,
      });
    } catch (error) {
      this.debug(`arXiv lookup failed for item ${item.id}: ${error}`);
      this.itemStates.set(item.id, {
        kind: "failed",
        retryAfter: Date.now() + ERROR_RETRY_DELAY_MS,
      });
    } finally {
      if (!this.disposed) refreshItemTrees();
    }
  }

  /** Candidates kept in memory for the manual confirmation dialog. */
  getPendingCandidates(item: Zotero.Item): ArxivCandidate[] {
    return this.pendingByItem.get(item.id) ?? [];
  }

  // -------------------------------------------------------------------------
  // Public actions (context menu)
  // -------------------------------------------------------------------------

  /** Stores a confirmed arXiv ID and immediately fetches its like count. */
  async applyArxivID(item: Zotero.Item, arxivID: string): Promise<void> {
    await this.writeExtra(item, (extra) =>
      upsertResolvedArxivID(extra, arxivID),
    );

    this.itemStates.delete(item.id);
    this.pendingByItem.delete(item.id);
    refreshItemTrees();

    await this.populateLikes(item, arxivID, { force: true });
  }

  /**
   * Re-reads like counts, ignoring the cached value and any failure cooldown.
   * Items without an arXiv ID get another resolution attempt.
   */
  async refreshItems(items: Zotero.Item[]): Promise<void> {
    const targets = items.filter(Boolean);
    if (!targets.length) return;

    for (const item of targets) {
      this.itemStates.delete(item.id);
      this.pendingByItem.delete(item.id);
      this.staleRefreshing.delete(item.id);

      if (!this.getItemArxivID(item)) {
        this.resolutionCache.delete(
          this.resolutionKey(this.readPaperMetadata(item)),
        );
      }
    }
    refreshItemTrees();

    for (const item of targets) {
      if (this.disposed) return;

      const arxivID = this.getItemArxivID(item);
      if (arxivID) {
        await this.populateLikes(item, arxivID, { force: true });
      } else {
        await this.resolveItem(item, { force: true });
      }
    }

    // Citation counts move far more slowly than likes, but a manual refresh is
    // an explicit "re-read everything", so they are included.
    if (getCitationPrefs().enabled) await this.refreshCitations(targets);
  }

  /**
   * Removes every line AlphaLikes wrote into `Extra`, including the like
   * history and the citation cache.
   */
  async clearItems(items: Zotero.Item[]): Promise<void> {
    for (const item of items.filter(Boolean)) {
      await this.writeExtra(item, stripAlphaLikesData);
      this.itemStates.delete(item.id);
      this.pendingByItem.delete(item.id);
      this.staleRefreshing.delete(item.id);
      this.citationStates.delete(item.id);
      this.observedLikes.delete(item.id);
    }
    this.quantileCache = null;
    refreshItemTrees();
  }

  // -------------------------------------------------------------------------
  // Batch actions
  // -------------------------------------------------------------------------

  /**
   * Resolves arXiv IDs for every item that lacks one.
   *
   * Items whose best candidate clears the auto-accept threshold are adopted
   * silently; the rest are left pending for the manual picker, and the counts
   * are returned so the menu can report what happened.
   */
  async batchFindArxiv(items: Zotero.Item[]): Promise<BatchResolutionResult> {
    const result: BatchResolutionResult = {
      total: 0,
      alreadyKnown: 0,
      applied: 0,
      pending: 0,
      notFound: 0,
    };

    const targets = items.filter(Boolean);
    result.total = targets.length;

    for (const item of targets) {
      if (this.disposed) break;

      if (this.getItemArxivID(item)) {
        result.alreadyKnown += 1;
        continue;
      }

      await this.resolveItem(item, { force: true });
      if (this.getItemArxivID(item)) result.applied += 1;
    }

    // What is left is either waiting for the user to confirm a candidate or
    // had no candidate worth offering at all.
    result.pending = targets.filter(
      (item) =>
        !this.getItemArxivID(item) && this.pendingByItem.get(item.id)?.length,
    ).length;
    result.notFound =
      result.total - result.alreadyKnown - result.applied - result.pending;

    return result;
  }

  private async writeExtra(
    item: Zotero.Item,
    update: (extra: string) => string,
  ): Promise<void> {
    const current = safeGetField(item, "extra");
    const next = update(current);
    if (next === current) return;

    try {
      item.setField("extra", next);
      await item.saveTx();
    } catch (error) {
      // A read-only (or group) library still benefits from the in-memory value.
      this.debug(
        `could not update ${ARXIV_ID_KEY} for item ${item.id}: ${error}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private onPrefChanged(name: string): void {
    if (this.disposed) return;

    if (name === "requestTimeoutMs" || name === "requestIntervalMs") {
      const { timeoutMs, intervalMs } = getRequestPrefs();
      this.requester.setOptions({ timeoutMs, intervalMs });
    }

    // Colour mode and the percentile cut-offs are derived, so the memo has to
    // go or the column would keep the previous ranking.
    if (
      name === "colorMode" ||
      name === "quantileLowPercent" ||
      name === "quantileHighPercent" ||
      name === "historyDays"
    ) {
      this.quantileCache = null;
    }

    // Colouring, filtering and thresholds only change the presentation, so a
    // repaint is enough. Resolution switches also reset cached state.
    if (
      name === "autoResolveNonArxiv" ||
      name === "confirmPercent" ||
      name === "autoAcceptPercent"
    ) {
      this.itemStates.clear();
    }

    // Turning citation lookups on has to start from a clean slate, and turning
    // them off should stop the pending work from repainting.
    if (name === "citationsEnabled" || name === "citationCacheTtlDays") {
      this.citationStates.clear();
      this.inFlightCitations.clear();
    }

    refreshItemTrees();
  }

  private debug(message: string): void {
    Zotero.debug(`[AlphaLikes] ${message}`);
  }

  dispose(): void {
    this.disposed = true;
    this.requester.dispose();
    this.itemStates.clear();
    this.pendingByItem.clear();
    this.resolutionCache.clear();
    this.inFlightLikes.clear();
    this.inFlightResolution.clear();
    this.inFlightCitations.clear();
    this.staleRefreshing.clear();
    this.citationStates.clear();
    this.observedLikes.clear();
    this.quantileCache = null;

    this.stopObservingPrefs?.();
    this.stopObservingPrefs = null;
  }
}
