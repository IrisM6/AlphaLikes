/**
 * Citation counts from Semantic Scholar and OpenAlex, cached in `Extra`:
 *
 *   alphaxiv_citations: oa=1300,s2=1234,infl=56,top10=1,top1=0
 *   alphaxiv_citations_updated: 2026-09-20T10:00:00.000Z
 *
 * One compact line keeps `Extra` readable next to the like-count lines. The
 * parsing and formatting half of this module is pure.
 */

export const CITATIONS_KEY = "alphaxiv_citations";
export const CITATIONS_UPDATED_KEY = "alphaxiv_citations_updated";

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
  return counts.openAlex !== undefined || counts.semanticScholar !== undefined;
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

/**
 * The number shown in the column. OpenAlex covers more of the literature, so
 * it wins when both providers answered.
 */
export function primaryCitationCount(
  counts: CitationCounts | null,
): number | null {
  if (!counts) return null;
  if (counts.openAlex !== undefined) return counts.openAlex;
  if (counts.semanticScholar !== undefined) return counts.semanticScholar;
  return null;
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

export function citationSources(counts: CitationCounts | null): string[] {
  if (!counts) return [];
  const sources: string[] = [];
  if (counts.openAlex !== undefined) sources.push("OpenAlex");
  if (counts.semanticScholar !== undefined) sources.push("Semantic Scholar");
  return sources;
}

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
