/**
 * Resolving an arXiv ID for items that do not carry one.
 *
 * The lookup follows the strategy described in the README:
 *
 *   1. a DataCite `10.48550/arXiv.*` DOI resolves offline;
 *   2. otherwise the DOI is resolved through Semantic Scholar, OpenAlex and
 *      Unpaywall, which report the arXiv version of a published paper;
 *   3. when no DOI hit exists, the title is searched on the arXiv API and on
 *      Semantic Scholar / OpenAlex;
 *   4. every candidate is scored on title similarity, author overlap and year
 *      proximity, and classified as high / medium / low confidence.
 *
 * Only the orchestration touches the network; parsing and scoring are pure so
 * they can be unit tested with fixtures.
 */

import {
  ARXIV_URL_ANYWHERE_RE,
  buildArxivAbsURL,
  extractArxivIDFromDOI,
  extractIDFromLooseText,
  normalizeArxivID,
} from "./arxiv-id";
import { scoreCandidate, shortAuthorList, type MatchInput } from "./similarity";

export type CandidateSource =
  | "doi:datacite"
  | "doi:semantic-scholar"
  | "doi:openalex"
  | "doi:unpaywall"
  | "title:arxiv"
  | "title:semantic-scholar"
  | "title:openalex"
  | "manual";

export type Confidence = "high" | "medium" | "low";

export interface PaperMetadata {
  title: string;
  doi: string;
  authors: string[];
  year: number | null;
  extra?: string;
}

export interface RawCandidate {
  arxivID: string;
  title: string;
  authors: string[];
  year: number | null;
  source: CandidateSource;
  /** `true` when the provider confirmed the arXiv ID rather than guessing it. */
  authoritative: boolean;
}

export interface ArxivCandidate extends RawCandidate {
  score: number;
  confidence: Confidence;
  titleSimilarity: number;
  authorMatched: boolean | null;
  yearMatched: boolean | null;
  sourceLabel: string;
  url: string;
  detail: string;
}

export interface ResolverPrefs {
  useSemanticScholar: boolean;
  useOpenAlex: boolean;
  useCrossref: boolean;
  useUnpaywall: boolean;
  useArxivTitleSearch: boolean;
  titleSearchResults: number;
  contactEmail: string;
  autoAccept: number;
  confirm: number;
}

export interface ResolverDeps {
  requestJSON(url: string): Promise<unknown>;
  requestXML(url: string): Promise<Document>;
  prefs: ResolverPrefs;
  debug(message: string): void;
}

const SOURCE_LABELS: Record<CandidateSource, string> = {
  "doi:datacite": "arXiv DOI",
  "doi:semantic-scholar": "Semantic Scholar (DOI)",
  "doi:openalex": "OpenAlex (DOI)",
  "doi:unpaywall": "Unpaywall (DOI)",
  "title:arxiv": "arXiv title search",
  "title:semantic-scholar": "Semantic Scholar (title)",
  "title:openalex": "OpenAlex (title)",
  manual: "Manual entry",
};

/** Candidates ranked below this are never shown. */
const MIN_DISPLAY_SCORE = 0.35;
const MAX_CANDIDATES = 10;
const MAX_QUERY_TITLE_LENGTH = 300;

// ---------------------------------------------------------------------------
// JSON helpers (payloads are untrusted, so everything is narrowed by hand)
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function field(source: unknown, key: string): unknown {
  const object = asObject(source);
  return object ? object[key] : undefined;
}

/** First four-digit year found in an ISO-ish date string. */
function yearFromDateString(value: string): number | null {
  const match = (value || "").match(/(\d{4})/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return year >= 1900 && year <= 2100 ? year : null;
}

export function normalizeDoi(doi: string): string {
  return (doi || "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:\s*/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Turns provider hits into scored, classified candidates, dropping duplicates
 * and anything too weak to show.
 */
export function rankCandidates(
  paper: PaperMetadata,
  raw: RawCandidate[],
  prefs: Pick<ResolverPrefs, "autoAccept" | "confirm">,
  minScore: number = MIN_DISPLAY_SCORE,
): ArxivCandidate[] {
  const matchInput: MatchInput = {
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
  };

  const best = new Map<string, ArxivCandidate>();

  for (const candidate of raw) {
    const arxivID = normalizeArxivID(candidate.arxivID);
    if (!arxivID) continue;

    const match = scoreCandidate(matchInput, {
      title: candidate.title,
      authors: candidate.authors,
      year: candidate.year,
    });

    // A provider that confirmed the ID through a DOI is authoritative, so the
    // title difference between the journal and preprint version cannot veto it.
    const score = candidate.authoritative ? 1 : match.score;
    const confidence = classify(score, candidate.authoritative, prefs);

    const ranked: ArxivCandidate = {
      ...candidate,
      arxivID,
      score,
      confidence,
      titleSimilarity: match.titleSimilarity,
      authorMatched: candidate.authoritative ? null : match.authorMatched,
      yearMatched: candidate.authoritative ? null : match.yearMatched,
      sourceLabel: SOURCE_LABELS[candidate.source] ?? candidate.source,
      url: buildArxivAbsURL(arxivID),
      detail: describeEvidence(candidate, match),
    };

    const previous = best.get(arxivID);
    if (!previous || ranked.score > previous.score) {
      best.set(arxivID, ranked);
    }
  }

  return [...best.values()]
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
}

export function classify(
  score: number,
  authoritative: boolean,
  prefs: Pick<ResolverPrefs, "autoAccept" | "confirm">,
): Confidence {
  if (authoritative || score >= prefs.autoAccept) return "high";
  if (score >= prefs.confirm) return "medium";
  return "low";
}

function describeEvidence(
  candidate: RawCandidate,
  match: ReturnType<typeof scoreCandidate>,
): string {
  if (candidate.authoritative) {
    return `Confirmed via ${SOURCE_LABELS[candidate.source] ?? candidate.source}`;
  }

  const parts = [`title ${Math.round(match.titleSimilarity * 100)}%`];
  if (match.authorMatched === true) parts.push("author matched");
  else if (match.authorMatched === false) parts.push("author differs");
  if (match.yearDelta !== null) parts.push(`year ±${match.yearDelta}`);

  const authors = shortAuthorList(candidate.authors);
  if (authors) parts.push(authors);

  return parts.join(" · ");
}

/** The candidate that should be adopted, if any, and why. */
export function selectBest(
  candidates: ArxivCandidate[],
  prefs: Pick<ResolverPrefs, "autoAccept" | "confirm">,
): ArxivCandidate | null {
  const best = candidates[0];
  if (!best) return null;
  return best.score >= prefs.confirm ? best : null;
}

// ---------------------------------------------------------------------------
// Provider payload parsing
// ---------------------------------------------------------------------------

export function candidateFromSemanticScholar(
  payload: unknown,
  source: CandidateSource,
  authoritative: boolean,
): RawCandidate | null {
  const arxivID = asString(field(field(payload, "externalIds"), "ArXiv"));
  if (!arxivID) return null;

  const authors = asArray(field(payload, "authors"))
    .map((author) => asString(field(author, "name")))
    .filter(Boolean);

  return {
    arxivID,
    title: asString(field(payload, "title")),
    authors,
    year: asNumber(field(payload, "year")),
    source,
    authoritative,
  };
}

export function candidateFromCrossref(payload: unknown): RawCandidate | null {
  const message = field(payload, "message");
  const links = [
    ...asArray(field(message, "link")),
    field(message, "resource"),
  ];

  for (const link of links) {
    const url = asString(field(link, "URL") ?? field(link, "url"));
    const match = url.match(ARXIV_URL_ANYWHERE_RE);
    if (match) {
      const arxivID = normalizeArxivID(match[1]);
      if (arxivID) {
        return {
          arxivID,
          title: asString(asArray(field(message, "title"))[0]),
          authors: crossrefAuthors(message),
          year: crossrefYear(message),
          source: "title:arxiv",
          authoritative: true,
        };
      }
    }
  }

  return null;
}

function crossrefAuthors(message: unknown): string[] {
  return asArray(field(message, "author"))
    .map((author) => {
      const given = asString(field(author, "given"));
      const family = asString(field(author, "family"));
      const name = asString(field(author, "name"));
      return [given, family].filter(Boolean).join(" ") || name;
    })
    .filter(Boolean);
}

function crossrefYear(message: unknown): number | null {
  for (const key of [
    "published-print",
    "published-online",
    "issued",
    "created",
  ]) {
    const parts = asArray(field(field(message, key), "date-parts"));
    const year = asNumber(asArray(parts[0])[0]);
    if (year) return year;
  }
  return null;
}

/** Title, authors and year from a Crossref work, used to sharpen title search. */
export function crossrefMetadata(payload: unknown): PaperMetadata | null {
  const message = field(payload, "message");
  const title = asString(asArray(field(message, "title"))[0]);
  if (!title) return null;

  return {
    title,
    doi: "",
    authors: crossrefAuthors(message),
    year: crossrefYear(message),
  };
}

export function candidateFromOpenAlexWork(
  work: unknown,
  source: CandidateSource,
  authoritative: boolean,
): RawCandidate | null {
  const arxivID = arxivIDFromOpenAlexWork(work);
  if (!arxivID) return null;

  const authors = asArray(field(work, "authorships"))
    .map((entry) => asString(field(field(entry, "author"), "display_name")))
    .filter(Boolean);

  return {
    arxivID,
    title: asString(field(work, "title") ?? field(work, "display_name")),
    authors,
    year: asNumber(field(work, "publication_year")),
    source,
    authoritative,
  };
}

/** Finds an arXiv ID in an OpenAlex work, either from a location URL or a DOI. */
export function arxivIDFromOpenAlexWork(work: unknown): string | null {
  const locations = [
    field(work, "primary_location"),
    field(work, "best_oa_location"),
    ...asArray(field(work, "locations")),
  ];

  for (const location of locations) {
    for (const key of ["landing_page_url", "pdf_url", "url"]) {
      const url = asString(field(location, key));
      if (!url) continue;
      const match = url.match(ARXIV_URL_ANYWHERE_RE);
      if (match) {
        const arxivID = normalizeArxivID(match[1]);
        if (arxivID) return arxivID;
      }
    }
  }

  const ids = asObject(field(work, "ids"));
  if (ids) {
    for (const [key, value] of Object.entries(ids)) {
      if (!/arxiv/i.test(key)) continue;
      const arxivID = extractIDFromLooseText(asString(value));
      if (arxivID) return arxivID;
    }
  }

  return extractArxivIDFromDOI(asString(field(work, "doi")));
}

// ---------------------------------------------------------------------------
// arXiv Atom API
// ---------------------------------------------------------------------------

export interface AtomEntry {
  arxivID: string;
  title: string;
  authors: string[];
  year: number | null;
}

function directChildren(root: Element, localName: string): Element[] {
  return Array.from(root.children).filter(
    (child) => child.localName === localName,
  );
}

function directChild(root: Element, localName: string): Element | null {
  return directChildren(root, localName)[0] ?? null;
}

export function parseArxivAtom(doc: Document | null): AtomEntry[] {
  if (!doc) return [];

  const feed = doc.documentElement;
  if (!feed) return [];

  const entries: AtomEntry[] = [];

  for (const entry of directChildren(feed, "entry")) {
    const rawID = asString(directChild(entry, "id")?.textContent);
    const arxivID = normalizeArxivID(rawID) ?? extractIDFromLooseText(rawID);
    if (!arxivID) continue;

    const authors = directChildren(entry, "author")
      .map((author) => asString(directChild(author, "name")?.textContent))
      .filter(Boolean);

    entries.push({
      arxivID,
      title: asString(directChild(entry, "title")?.textContent).replace(
        /\s+/g,
        " ",
      ),
      authors,
      year: yearFromDateString(
        asString(directChild(entry, "published")?.textContent),
      ),
    });
  }

  return entries;
}

export function buildArxivSearchURL(
  title: string,
  maxResults: number,
  field: "ti" | "all" = "ti",
): string {
  const cleaned = (title || "")
    .replace(/["\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_TITLE_LENGTH);

  const query = `${field}:"${cleaned}"`;
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(maxResults),
    sortBy: "relevance",
  });

  return `https://export.arxiv.org/api/query?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Resolves a DOI to an arXiv ID. Returns both the candidate and, when
 * Crossref provided a better title, metadata for the follow-up title search.
 */
export async function resolveByDoi(
  doi: string,
  deps: ResolverDeps,
): Promise<{ candidate: RawCandidate | null; metadata: PaperMetadata | null }> {
  const normalized = normalizeDoi(doi);
  if (!normalized) return { candidate: null, metadata: null };

  // 1. arXiv's own DataCite DOI needs no network round trip.
  const dataCiteID = extractArxivIDFromDOI(normalized);
  if (dataCiteID) {
    return {
      candidate: {
        arxivID: dataCiteID,
        title: "",
        authors: [],
        year: null,
        source: "doi:datacite",
        authoritative: true,
      },
      metadata: null,
    };
  }

  const encodedDoi = encodeURIComponent(normalized);

  if (deps.prefs.useSemanticScholar) {
    const payload = await attempt(deps, "Semantic Scholar DOI lookup", () =>
      deps.requestJSON(
        `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodedDoi}` +
          "?fields=externalIds,title,year,authors",
      ),
    );
    const candidate = candidateFromSemanticScholar(
      payload,
      "doi:semantic-scholar",
      true,
    );
    if (candidate) return { candidate, metadata: null };
  }

  if (deps.prefs.useOpenAlex) {
    const payload = await attempt(deps, "OpenAlex DOI lookup", () =>
      deps.requestJSON(
        `https://api.openalex.org/works/doi:${encodedDoi}${openAlexMailto(deps)}`,
      ),
    );
    const candidate = candidateFromOpenAlexWork(payload, "doi:openalex", true);
    if (candidate) return { candidate, metadata: null };
  }

  if (deps.prefs.useUnpaywall && deps.prefs.contactEmail) {
    const payload = await attempt(deps, "Unpaywall DOI lookup", () =>
      deps.requestJSON(
        `https://api.unpaywall.org/v2/${encodedDoi}?email=${encodeURIComponent(
          deps.prefs.contactEmail,
        )}`,
      ),
    );
    const candidate = candidateFromUnpaywall(payload);
    if (candidate) return { candidate, metadata: null };
  }

  if (deps.prefs.useCrossref) {
    const payload = await attempt(deps, "Crossref DOI lookup", () =>
      deps.requestJSON(`https://api.crossref.org/works/${encodedDoi}`),
    );
    const candidate = candidateFromCrossref(payload);
    if (candidate) return { candidate, metadata: null };
    return { candidate: null, metadata: crossrefMetadata(payload) };
  }

  return { candidate: null, metadata: null };
}

function candidateFromUnpaywall(payload: unknown): RawCandidate | null {
  const locations = [
    field(payload, "best_oa_location"),
    ...asArray(field(payload, "oa_locations")),
  ];

  for (const location of locations) {
    for (const key of ["url_for_pdf", "url"]) {
      const url = asString(field(location, key));
      const match = url.match(ARXIV_URL_ANYWHERE_RE);
      if (match) {
        const arxivID = normalizeArxivID(match[1]);
        if (arxivID) {
          return {
            arxivID,
            title: asString(field(payload, "title")),
            authors: [],
            year: yearFromDateString(asString(field(payload, "year"))),
            source: "doi:unpaywall",
            authoritative: true,
          };
        }
      }
    }
  }

  return null;
}

function openAlexMailto(deps: ResolverDeps): string {
  const email = deps.prefs.contactEmail;
  return email ? `?mailto=${encodeURIComponent(email)}` : "";
}

/**
 * Searches for the paper by title across the enabled providers.
 */
export async function searchByTitle(
  paper: PaperMetadata,
  deps: ResolverDeps,
): Promise<RawCandidate[]> {
  const results: RawCandidate[] = [];
  const limit = deps.prefs.titleSearchResults;

  if (deps.prefs.useArxivTitleSearch && paper.title) {
    // `ti:` is precise but misses re-titled journal versions, so a broader
    // `all:` search runs when the first query comes back empty.
    for (const field of ["ti", "all"] as const) {
      const doc = await attempt(deps, `arXiv title search (${field})`, () =>
        deps.requestXML(buildArxivSearchURL(paper.title, limit, field)),
      );
      const entries = parseArxivAtom(doc);
      if (!entries.length) continue;

      for (const entry of entries) {
        results.push({
          arxivID: entry.arxivID,
          title: entry.title,
          authors: entry.authors,
          year: entry.year,
          source: "title:arxiv",
          authoritative: false,
        });
      }
      break;
    }
  }

  if (deps.prefs.useSemanticScholar && paper.title) {
    const payload = await attempt(deps, "Semantic Scholar title search", () =>
      deps.requestJSON(
        "https://api.semanticscholar.org/graph/v1/paper/search" +
          `?query=${encodeURIComponent(paper.title)}` +
          `&limit=${limit}&fields=title,year,externalIds,authors`,
      ),
    );
    for (const entry of asArray(field(payload, "data"))) {
      const candidate = candidateFromSemanticScholar(
        entry,
        "title:semantic-scholar",
        false,
      );
      if (candidate) results.push(candidate);
    }
  }

  if (deps.prefs.useOpenAlex && paper.title) {
    const payload = await attempt(deps, "OpenAlex title search", () =>
      deps.requestJSON(
        `https://api.openalex.org/works?search=${encodeURIComponent(paper.title)}` +
          `&per-page=${limit}${openAlexMailto(deps).replace("?", "&").replace(/^&$/, "")}` +
          "&select=id,doi,title,publication_year,authorships,locations,ids",
      ),
    );
    for (const entry of asArray(field(payload, "results"))) {
      const candidate = candidateFromOpenAlexWork(
        entry,
        "title:openalex",
        false,
      );
      if (candidate) results.push(candidate);
    }
  }

  return results;
}

async function attempt<T>(
  deps: ResolverDeps,
  label: string,
  task: () => Promise<T>,
): Promise<T | null> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.debug(`${label} failed: ${message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function findArxivCandidates(
  paper: PaperMetadata,
  deps: ResolverDeps,
  options: { minScore?: number } = {},
): Promise<ArxivCandidate[]> {
  const raw: RawCandidate[] = [];
  let searchMetadata: PaperMetadata = paper;

  if (paper.doi) {
    const { candidate, metadata } = await resolveByDoi(paper.doi, deps);
    if (candidate) {
      // An authoritative DOI hit answers the question outright.
      return rankCandidates(paper, [candidate], deps.prefs, options.minScore);
    }
    // Crossref may know the canonical title of a DOI the other providers miss,
    // which makes the title search noticeably more reliable.
    if (metadata?.title && metadata.title !== paper.title) {
      searchMetadata = {
        ...paper,
        title: metadata.title,
        authors: paper.authors.length ? paper.authors : metadata.authors,
        year: paper.year ?? metadata.year,
      };
    }
  }

  raw.push(...(await searchByTitle(searchMetadata, deps)));
  return rankCandidates(paper, raw, deps.prefs, options.minScore);
}
