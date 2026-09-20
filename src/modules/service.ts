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
import { ERROR_RETRY_DELAY_MS, RESOLUTION_RETRY_DELAY_MS } from "./constants";
import { PacedRequester } from "./http";
import {
  CELL_LOADING,
  CELL_PENDING,
  CELL_UNAVAILABLE,
  fromSortableValue,
  parseLikesFromDocument,
  toSortableValue,
} from "./likes";
import {
  getPref,
  getRangeFilter,
  getRequestPrefs,
  getResolverPrefs,
  isWithinRange,
  observePrefs,
} from "./prefs";
import {
  findArxivCandidates,
  normalizeDoi,
  type ArxivCandidate,
  type PaperMetadata,
  type ResolverDeps,
} from "./resolver";
import { normalizeText } from "./similarity";

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

interface ResolutionCacheEntry {
  candidates: ArxivCandidate[];
  createdAt: number;
  expiresAt: number;
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

function refreshItemTrees(): void {
  for (const win of Zotero.getMainWindows()) {
    try {
      const itemsView = win.ZoteroPane?.itemsView;
      if (itemsView) itemsView.tree?.invalidate();
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

    const filter = getRangeFilter();
    const filteredOut = likes !== null && !isWithinRange(likes, filter);

    // In `hide` mode the value is blanked before it reaches the data provider,
    // which also keeps out-of-range rows out of the sortable ordering.
    const value = filteredOut && filter.mode === "hide" ? "" : raw;

    return { value, text, likes, filteredOut };
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
      await this.writeExtra(item, (extra) => upsertLikesCache(extra, likes));
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
  }

  /** Removes every line AlphaLikes wrote into `Extra`. */
  async clearItems(items: Zotero.Item[]): Promise<void> {
    for (const item of items.filter(Boolean)) {
      await this.writeExtra(item, stripAlphaLikesData);
      this.itemStates.delete(item.id);
      this.pendingByItem.delete(item.id);
      this.staleRefreshing.delete(item.id);
    }
    refreshItemTrees();
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

    // Colouring, filtering and thresholds only change the presentation, so a
    // repaint is enough. Resolution switches also reset cached state.
    if (
      name === "autoResolveNonArxiv" ||
      name === "confirmPercent" ||
      name === "autoAcceptPercent"
    ) {
      this.itemStates.clear();
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
    this.staleRefreshing.clear();

    this.stopObservingPrefs?.();
    this.stopObservingPrefs = null;
  }
}
