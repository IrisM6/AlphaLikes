/**
 * Public surface of the AlphaLikes core.
 *
 * The implementation lives in focused modules; this barrel keeps the original
 * import path (and the existing test suite) working.
 */

export {
  ARXIV_ID_KEY,
  CACHE_KEY,
  UPDATED_KEY,
  buildAlphaXivURL,
  buildArxivAbsURL,
  extractArxivID,
  extractArxivIDFromDOI,
  extractIDFromLooseText,
  normalizeArxivID,
  readCachedLikes,
  readLikesUpdatedAt,
  readResolvedArxivID,
  stripAlphaLikesData,
  upsertCachedLikes,
  upsertLikesCache,
  upsertResolvedArxivID,
} from "./arxiv-id";

export {
  CELL_LOADING,
  CELL_PENDING,
  CELL_UNAVAILABLE,
  fromSortableValue,
  isStatusValue,
  parseLikesFromDocument,
  parseLikesText,
  toSortableValue,
} from "./likes";

export {
  ARXIV_API_INTERVAL_MS,
  ERROR_RETRY_DELAY_MS,
  MIN_REQUEST_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  RESOLUTION_RETRY_DELAY_MS,
} from "./constants";

export {
  COLUMN_KEY,
  COLUMN_LABEL,
  getService,
  registerAlphaXivLikesColumn,
  renderLikeCell,
  shutdownAlphaXivLikesColumn,
} from "./column";

export {
  AlphaLikesService,
  AlphaLikesService as AlphaXivLikesService,
} from "./service";

export {
  authorsMatch,
  jaccardSimilarity,
  levenshteinDistance,
  normalizeText,
  scoreCandidate,
  surnameOf,
  titleSimilarity,
  yearsMatch,
} from "./similarity";

export {
  arxivIDFromOpenAlexWork,
  buildArxivSearchURL,
  candidateFromCrossref,
  candidateFromOpenAlexWork,
  candidateFromSemanticScholar,
  classify,
  crossrefMetadata,
  findArxivCandidates,
  parseArxivAtom,
  rankCandidates,
  selectBest,
  type ArxivCandidate,
  type CandidateSource,
  type Confidence,
  type PaperMetadata,
  type RawCandidate,
  type ResolverDeps,
  type ResolverPrefs,
} from "./resolver";

export {
  PREF_DEFAULTS,
  colorBucket,
  getColorScheme,
  getPref,
  getRangeFilter,
  getThresholds,
  isWithinRange,
  observePrefs,
  setPref,
  type ColorScheme,
  type RangeFilter,
} from "./prefs";

export { registerItemMenu, unregisterItemMenu } from "./menu";
