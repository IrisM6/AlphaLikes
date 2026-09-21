/**
 * Citation counts from Semantic Scholar and OpenAlex, cached in `Extra`:
 *
 *   alphaxiv_citations: gs=8012,oa=1300,s2=1234,infl=56,top10=1,top1=0
 *   alphaxiv_citations_updated: 2026-09-20T10:00:00.000Z
 *
 * One compact line keeps `Extra` readable next to the like-count lines. The
 * parsing and formatting half of this module is pure.
 */

export const CITATIONS_KEY = "alphaxiv_citations";
export const CITATIONS_UPDATED_KEY = "alphaxiv_citations_updated";
/**
 * The Scholar result the user picked for this item, by its exact title.
 *
 * Google Scholar has no identifier for a result that survives a title search,
 * so the chosen result is remembered by the title it carried. Later lookups
 * search for that title instead of the item's own, which is what keeps the
 * choice from being undone by the next refresh.
 */
export const SCHOLAR_TITLE_KEY = "alphaxiv_scholar_title";

const CITATIONS_LINE_RE = new RegExp(
  String.raw`^\s*${CITATIONS_KEY}\s*:\s*([^\r\n]*)$`,
  "im",
);
/** Matches the counts line as a whole, for the "clear data" action. */
export const CITATIONS_ANY_LINE_RE = new RegExp(
  String.raw`^\s*${CITATIONS_KEY}\s*:[^\r\n]*$`,
  "im",
);
const UPDATED_LINE_RE = new RegExp(
  String.raw`^${CITATIONS_UPDATED_KEY}\s*:[^\r\n]*$`,
  "im",
);
/** Matches the citations timestamp line as a whole. */
export const CITATIONS_UPDATED_LINE_RE = new RegExp(
  String.raw`^\s*${CITATIONS_UPDATED_KEY}\s*:[^\r\n]*$`,
  "im",
);
const UPDATED_VALUE_RE = new RegExp(
  String.raw`^\s*${CITATIONS_UPDATED_KEY}\s*:\s*(\S+)\s*$`,
  "im",
);

export interface CitationCounts {
  /** Google Scholar's "Cited by" count, read from the public results page. */
  googleScholar?: number;
  /** OpenAlex `cited_by_count`. */
  openAlex?: number;
  /** Semantic Scholar `citationCount`. */
  semanticScholar?: number;
  /** Semantic Scholar `influentialCitationCount`. */
  influential?: number;
  /** OpenAlex `citation_normalized_percentile.is_in_top_10_percent`. */
  top10Percent?: boolean;
  /** OpenAlex `citation_normalized_percentile.is_in_top_1_percent`. */
  top1Percent?: boolean;
}

function readCount(
  fields: Map<string, string>,
  key: string,
): number | undefined {
  const raw = fields.get(key);
  if (raw === undefined) return undefined;

  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readFlag(
  fields: Map<string, string>,
  key: string,
): boolean | undefined {
  const raw = fields.get(key);
  if (raw === undefined) return undefined;
  return raw === "1" || raw.toLowerCase() === "true";
}

/** Parses the counts line. Returns `null` when nothing usable is present. */
export function parseCitationsLine(raw: string): CitationCounts | null {
  const match = CITATIONS_LINE_RE.exec(raw || "");
  if (!match) return null;

  const fields = new Map<string, string>();
  for (const chunk of match[1].split(",")) {
    const entry = chunk.trim();
    if (!entry) continue;

    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    fields.set(
      entry.slice(0, separator).trim().toLowerCase(),
      entry.slice(separator + 1).trim(),
    );
  }

  const counts: CitationCounts = {
    googleScholar: readCount(fields, "gs"),
    openAlex: readCount(fields, "oa"),
    semanticScholar: readCount(fields, "s2"),
    influential: readCount(fields, "infl"),
    top10Percent: readFlag(fields, "top10"),
    top1Percent: readFlag(fields, "top1"),
  };

  return hasAnyCount(counts) || counts.top10Percent || counts.top1Percent
    ? counts
    : null;
}

function hasAnyCount(counts: CitationCounts): boolean {
  return (
    counts.googleScholar !== undefined ||
    counts.openAlex !== undefined ||
    counts.semanticScholar !== undefined
  );
}

export function readCitations(extra: string): CitationCounts | null {
  return parseCitationsLine(extra);
}

export function readCitationsUpdatedAt(extra: string): Date | null {
  const match = (extra || "").match(UPDATED_VALUE_RE);
  if (!match) return null;

  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function serializeCitations(counts: CitationCounts): string {
  const parts: string[] = [];
  if (counts.googleScholar !== undefined) {
    parts.push(`gs=${counts.googleScholar}`);
  }
  if (counts.openAlex !== undefined) parts.push(`oa=${counts.openAlex}`);
  if (counts.semanticScholar !== undefined) {
    parts.push(`s2=${counts.semanticScholar}`);
  }
  if (counts.influential !== undefined)
    parts.push(`infl=${counts.influential}`);
  if (counts.top10Percent !== undefined) {
    parts.push(`top10=${counts.top10Percent ? 1 : 0}`);
  }
  if (counts.top1Percent !== undefined) {
    parts.push(`top1=${counts.top1Percent ? 1 : 0}`);
  }
  return parts.join(",");
}

/**
 * Writes the counts, keeping any provider value the new read did not return so
 * a transient provider failure does not erase a previously known number.
 */
export function upsertCitations(
  extra: string,
  counts: CitationCounts,
  updatedAt: Date = new Date(),
): string {
  const previous = parseCitationsLine(extra) ?? {};
  const merged: CitationCounts = {
    googleScholar: counts.googleScholar ?? previous.googleScholar,
    openAlex: counts.openAlex ?? previous.openAlex,
    semanticScholar: counts.semanticScholar ?? previous.semanticScholar,
    influential: counts.influential ?? previous.influential,
    top10Percent: counts.top10Percent ?? previous.top10Percent,
    top1Percent: counts.top1Percent ?? previous.top1Percent,
  };

  const line = `${CITATIONS_KEY}: ${serializeCitations(merged)}`;
  let next = (extra || "").replace(/[\r\n]+$/, "");
  if (CITATIONS_ANY_LINE_RE.test(next)) {
    next = next.replace(CITATIONS_ANY_LINE_RE, line);
  } else {
    next = next ? `${next}\n${line}` : line;
  }

  const updatedLine = `${CITATIONS_UPDATED_KEY}: ${updatedAt.toISOString()}`;
  if (UPDATED_LINE_RE.test(next)) {
    next = next.replace(UPDATED_LINE_RE, updatedLine);
  } else {
    next = `${next}\n${updatedLine}`;
  }

  return next;
}

/** Removes both citation lines, leaving the rest of `Extra` intact. */
/** The Scholar title pinned for this item, or `null`. */
export function readScholarTitle(extra: string): string | null {
  const match = (extra || "").match(
    new RegExp(String.raw`^\s*${SCHOLAR_TITLE_KEY}\s*:\s*(.+?)\s*$`, "im"),
  );
  const value = match ? match[1].trim() : "";
  return value || null;
}

/** Stores (or clears, with an empty value) the pinned Scholar result title. */
export function upsertScholarTitle(extra: string, title: string): string {
  const withoutLine = stripScholarTitle(extra);
  const value = (title || "").trim();
  if (!value) return withoutLine;

  const line = `${SCHOLAR_TITLE_KEY}: ${value}`;
  const base = withoutLine.replace(/[\r\n]+$/, "");
  return base ? `${base}\n${line}` : line;
}

/** Removes the pinned Scholar title line. */
export function stripScholarTitle(extra: string): string {
  return (extra || "")
    .split(/\r?\n/)
    .filter(
      (line) =>
        !new RegExp(String.raw`^\s*${SCHOLAR_TITLE_KEY}\s*:`, "i").test(line),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\r\n]+|[\r\n]+$/g, "");
}

/** Matches the pinned Scholar title line as a whole, for "clear data". */
export const SCHOLAR_TITLE_ANY_LINE_RE = new RegExp(
  String.raw`^\s*${SCHOLAR_TITLE_KEY}\s*:[^\r\n]*$`,
  "im",
);

export function stripCitations(extra: string): string {
  return (extra || "")
    .split(/\r?\n/)
    .filter(
      (line) =>
        !CITATIONS_ANY_LINE_RE.test(line) && !UPDATED_LINE_RE.test(line),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\r\n]+|[\r\n]+$/g, "");
}

/** The providers whose counts can be displayed. */
export type CitationSourceKey =
  "googleScholar" | "openAlex" | "semanticScholar";

/** Default precedence: broadest index first, narrowest last. */
export const CITATION_AUTHORITY_ORDER: readonly CitationSourceKey[] = [
  "googleScholar",
  "openAlex",
  "semanticScholar",
];

/**
 * The number shown in the column.
 *
 * `order` decides which provider wins when several answered. The default walks
 * from the broadest index to the narrowest, so a count Google Scholar has and
 * OpenAlex does not is still shown, and a provider that was blocked or
 * rate-limited simply loses its turn instead of blanking the column.
 */
/**
 * Decoration on a citation cell whose provider is blocked and retrying.
 *
 * The renderer turns this into an explanation rather than a bare "N/A", so a
 * blocked Google Scholar does not look like a paper with no citations.
 */
export const CITATIONS_BLOCKED_MARKER = "scholarBlocked";

/** The site whose human check blocks the count. */
export const GOOGLE_SCHOLAR_HOME = "https://scholar.google.com/";

/**
 * How long to leave Google Scholar alone after it asks for a human check.
 *
 * The first retry is soon enough that a transient rate limit resolves on its
 * own, and every further block in the same episode doubles the wait: a user
 * who never clears the check costs one request every couple of hours instead
 * of a steady stream the plugin would be blocked for anyway.
 */
export function scholarRetryDelayMs(
  attempt: number,
  baseMs = 10 * 60_000,
  capMs = 2 * 60 * 60_000,
): number {
  const steps = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(baseMs * 2 ** Math.min(steps, 8), capMs);
}

/**
 * The providers whose counts may be shown, normalised.
 *
 * A single provider is strict: its number, or an empty cell. Several providers
 * all get read, and the largest of their counts is shown - the choice of set
 * is the user's, so the biggest figure in it is the one they asked for. The
 * order is canonical, which fixes ties in favour of the more inclusive index.
 */
export function citationProviderOrder(
  preference: CitationSourceKey | readonly CitationSourceKey[],
): CitationSourceKey[] {
  const requested = Array.isArray(preference) ? preference : [preference];
  const wanted = new Set(requested);

  const ordered = CITATION_AUTHORITY_ORDER.filter((key) => wanted.has(key));
  return ordered.length ? ordered : [...CITATION_AUTHORITY_ORDER];
}

/**
 * The count the column shows, and where it came from.
 *
 * With one provider this is that provider's number or nothing at all; with
 * several it is the largest count among the ones that answered. `null` when no
 * chosen provider has a value - which the caller renders as "unknown", never
 * as someone else's number.
 */
export function primaryCitation(
  counts: CitationCounts | null,
  order: readonly CitationSourceKey[],
): { count: number; source: CitationSourceKey } | null {
  if (!counts) return null;

  let best: { count: number; source: CitationSourceKey } | null = null;
  for (const key of order) {
    const value = counts[key];
    if (value === undefined) continue;
    if (!best || value > best.count) best = { count: value, source: key };
  }
  return best;
}

export function primaryCitationCount(
  counts: CitationCounts | null,
  order: readonly CitationSourceKey[],
): number | null {
  return primaryCitation(counts, order)?.count ?? null;
}

/** Which provider produced the displayed count, or `null`. */
export function primaryCitationSource(
  counts: CitationCounts | null,
  order: readonly CitationSourceKey[],
): CitationSourceKey | null {
  return primaryCitation(counts, order)?.source ?? null;
}

/**
 * Whether the work is in the top decile of its field and year.
 *
 * Only OpenAlex's field-normalised percentile can answer this. A raw citation
 * count cannot, so an absent percentile is reported as "unknown" rather than
 * guessed from a fixed number.
 */
export function isHighImpact(counts: CitationCounts | null): boolean {
  if (!counts) return false;
  return counts.top10Percent === true || counts.top1Percent === true;
}

/** Display names for the providers, in the authority order. */
export const CITATION_SOURCE_LABELS: Record<CitationSourceKey, string> = {
  googleScholar: "Google Scholar",
  openAlex: "OpenAlex",
  semanticScholar: "Semantic Scholar",
};

// ---------------------------------------------------------------------------
// Provider requests
// ---------------------------------------------------------------------------

const S2_FIELDS =
  "citationCount,influentialCitationCount,title,year,externalIds";

/** Semantic Scholar lookup keyed on whichever identifier we have. */
export function semanticScholarCitationURL(options: {
  doi?: string;
  arxivID?: string;
}): string | null {
  const doi = (options.doi || "").trim();
  if (doi) {
    return `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(
      doi,
    )}?fields=${S2_FIELDS}`;
  }

  const arxivID = (options.arxivID || "").trim();
  if (arxivID) {
    return `https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(
      arxivID,
    )}?fields=${S2_FIELDS}`;
  }

  return null;
}

const OPENALEX_SELECT =
  "cited_by_count,citation_normalized_percentile,title,doi,publication_year";

/**
 * OpenAlex work lookup by DOI.
 *
 * Note that the DataCite arXiv DOIs (`10.48550/arXiv.*`) are **not** indexed as
 * DOI lookups by OpenAlex, so an arXiv-only item is matched by title instead.
 */
export function openAlexCitationURL(options: {
  doi?: string;
  contactEmail?: string;
}): string | null {
  const doi = (options.doi || "").trim();
  if (!doi) return null;

  const mailto = options.contactEmail
    ? `&mailto=${encodeURIComponent(options.contactEmail)}`
    : "";
  return (
    `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}` +
    `?select=${OPENALEX_SELECT}${mailto}`
  );
}

/**
 * OpenAlex title search, used when there is no usable DOI. The caller must
 * still verify the returned work against the item, because OpenAlex carries
 * duplicate and mis-attributed records.
 */
export function openAlexCitationSearchURL(
  title: string,
  options: { perPage?: number; contactEmail?: string } = {},
): string {
  const perPage = options.perPage ?? 3;
  const mailto = options.contactEmail
    ? `&mailto=${encodeURIComponent(options.contactEmail)}`
    : "";
  return (
    "https://api.openalex.org/works" +
    `?search=${encodeURIComponent(title)}` +
    `&per-page=${perPage}&select=${OPENALEX_SELECT}${mailto}`
  );
}

/**
 * Google Scholar title search.
 *
 * Scholar has no API, so the public results page is read. `hl=en` pins the
 * interface language, which keeps the "Cited by N" label stable regardless of
 * the user's Google locale. Results are matched on the title afterwards, the
 * same way the OpenAlex search path works.
 */
export function googleScholarCitationSearchURL(title: string): string {
  const query = encodeURIComponent(`"${(title || "").trim()}"`);
  return "https://scholar.google.com/scholar" + `?hl=en&as_sdt=0,5&q=${query}`;
}

/**
 * Reads the first "Cited by N" count out of a Scholar results page.
 *
 * Returns `null` when the page holds no results, and `-1` when Google answered
 * with something that is not a results page at all (a consent interstitial or
 * a "sorry" block). The caller treats those two cases differently: no match is
 * normal, a block should be logged.
 */
export function googleScholarCitationCount(html: string): number | null {
  const page = html || "";

  // A blocked or consent page carries neither a result container nor a count.
  const hasResults = /class="gs_r|id="gs_res_ccl_mid"/.test(page);
  const hasCount = /Cited by\s*[\d,]+|被引用次数[:：]\s*[\d,]+/.test(page);

  if (!hasResults && !hasCount) {
    return /sorry|consent|unusual traffic|captcha/i.test(page) ? -1 : null;
  }

  const match = page.match(/(?:Cited by\s*|被引用次数[:：]\s*)([\d,]+)/);
  if (!match) return null;

  const value = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Strips the markup out of a Scholar result block so the title can be compared
 * with the item's own title.
 */
export function googleScholarResultTitle(block: string): string {
  const match = block.match(
    /<h3[^>]*class="[^"]*gs_rt[^"]*"[^>]*>([\s\S]*?)<\/h3>/i,
  );
  if (!match) return "";

  return (
    match[1]
      .replace(/<[^>]*>/g, "")
      // Scholar prefixes the format, e.g. "[PDF]", "[HTML]", "[BOOK]".
      .replace(/^\s*(?:\[[A-Z]+\]\s*)+/, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Splits a Scholar results page into its per-result blocks. */
export function googleScholarResultBlocks(html: string): string[] {
  return (html || "")
    .split(/(?=<div[^>]*class="[^"]*\bgs_r\b)/i)
    .slice(1)
    .filter((block) => /gs_ri/.test(block));
}

/** One entry of a Scholar results page, as the picker dialog needs it. */
export interface ScholarResult {
  title: string;
  /** "Cited by" count for this result, or `null` when Scholar shows none. */
  count: number | null;
  /** Authors, venue and year line, for telling near-identical titles apart. */
  meta: string;
  /** Link to the result (Scholar's own link wrapper is unwrapped). */
  url: string;
}

/** Reads the "Cited by N" count of a single result block. */
export function googleScholarResultCount(block: string): number | null {
  const match = (block || "").match(
    /(?:Cited by\s*|被引用次数[:：]\s*)([\d,]+)/i,
  );
  if (!match) return null;

  const value = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Reads the author/venue/year line of a single result block. */
export function googleScholarResultMeta(block: string): string {
  const match = (block || "").match(
    /<div[^>]*class="[^"]*gs_a[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!match) return "";
  return decodeScholarText(match[1]);
}

/**
 * Reads the first link of a result block.
 *
 * Scholar wraps external links in `/url?q=` and keeps internal ones relative,
 * so both shapes are unwrapped here; anything unparseable is dropped rather
 * than shown as a broken link.
 */
export function googleScholarResultURL(block: string): string {
  const match = (block || "").match(
    /<h3[^>]*class="[^"]*gs_rt[^"]*"[^>]*>([\s\S]*?)<\/h3>/i,
  );
  const href = match ? match[1].match(/href="([^"]+)"/i) : null;
  if (!href) return "";

  return unwrapScholarLink(href[1]);
}

function unwrapScholarLink(raw: string): string {
  const value = (raw || "").replace(/&amp;/g, "&").trim();
  if (!value) return "";

  if (value.startsWith("/url?")) {
    const query = value.slice(value.indexOf("?") + 1);
    for (const pair of query.split("&")) {
      const [key, ...rest] = pair.split("=");
      if (key === "q") {
        try {
          return decodeURIComponent(rest.join("="));
        } catch {
          return "";
        }
      }
    }
    return "";
  }

  if (value.startsWith("/")) return `https://scholar.google.com${value}`;
  return /^https?:/i.test(value) ? value : "";
}

function decodeScholarText(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** The results of a Scholar page, in the order Scholar ranked them. */
export function parseGoogleScholarResults(html: string): ScholarResult[] {
  return googleScholarResultBlocks(html)
    .map((block) => ({
      title: googleScholarResultTitle(block),
      count: googleScholarResultCount(block),
      meta: googleScholarResultMeta(block),
      url: googleScholarResultURL(block),
    }))
    .filter((result) => Boolean(result.title));
}

/** The Scholar search URL for a title, used as the query and as the fallback. */
export function scholarTitleSearchURL(title: string): string {
  return googleScholarCitationSearchURL(title);
}

// ---------------------------------------------------------------------------
// Provider responses
// ---------------------------------------------------------------------------

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function booleanFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function citationCountsFromSemanticScholar(
  payload: unknown,
): CitationCounts | null {
  const root = asObject(payload);
  if (!root) return null;

  const counts: CitationCounts = {
    semanticScholar: finiteCount(root.citationCount),
    influential: finiteCount(root.influentialCitationCount),
  };

  return counts.semanticScholar === undefined &&
    counts.influential === undefined
    ? null
    : counts;
}

/** Reads the meaningful fields out of one OpenAlex work. */
export interface OpenAlexWorkInfo {
  counts: CitationCounts;
  title: string;
  doi: string;
  year: number | null;
}

export function openAlexWorkInfo(payload: unknown): OpenAlexWorkInfo | null {
  const root = asObject(payload);
  if (!root) return null;

  const percentile = asObject(root.citation_normalized_percentile);
  const counts: CitationCounts = {
    openAlex: finiteCount(root.cited_by_count),
    top10Percent: booleanFlag(percentile?.is_in_top_10_percent),
    top1Percent: booleanFlag(percentile?.is_in_top_1_percent),
  };

  const doi = typeof root.doi === "string" ? root.doi : "";
  return {
    counts,
    title: typeof root.title === "string" ? root.title : "",
    doi: doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    year: finiteCount(root.publication_year) ?? null,
  };
}

/** Reads the results array of an OpenAlex list response. */
export function openAlexSearchResults(payload: unknown): OpenAlexWorkInfo[] {
  const root = asObject(payload);
  const results = root?.results;
  if (!Array.isArray(results)) return [];

  return results
    .map((entry) => openAlexWorkInfo(entry))
    .filter((info): info is OpenAlexWorkInfo => info !== null);
}
