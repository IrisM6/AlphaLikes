/**
 * arXiv identifier parsing and the AlphaPulse `Extra` field cache format.
 *
 * Everything in this module is pure so it can be unit tested outside Zotero.
 */

import {
  CITATIONS_ANY_LINE_RE,
  CITATIONS_UPDATED_LINE_RE,
  SCHOLAR_TITLE_ANY_LINE_RE,
} from "./citations";
import { HISTORY_ANY_LINE_RE } from "./history";

export const CACHE_KEY = "alphaxiv_likes";
export const ARXIV_ID_KEY = "alphaxiv_arxiv_id";
export const UPDATED_KEY = "alphaxiv_likes_updated";

const MODERN_ID = String.raw`\d{4}\.\d{4,5}(?:v\d+)?`;
const LEGACY_ID = String.raw`[a-z][a-z0-9.-]*\/\d{7}(?:v\d+)?`;
const ANY_ID_RE = new RegExp(`(${MODERN_ID}|${LEGACY_ID})`, "i");

const ARXIV_URL_RE = new RegExp(
  String.raw`(?:https?:\/\/)?(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/(${MODERN_ID}|${LEGACY_ID})(?:\.pdf)?(?:[?#][^\s]*)?`,
  "i",
);

/** Any `arxiv.org` URL anywhere in a longer string (used for API payloads). */
export const ARXIV_URL_ANYWHERE_RE = new RegExp(
  String.raw`arxiv\.org\/(?:abs|pdf|html)\/(${MODERN_ID}|${LEGACY_ID})`,
  "i",
);

const CACHE_VALUE_RE = new RegExp(
  String.raw`^${CACHE_KEY}\s*:\s*([\d,]+)\s*$`,
  "im",
);
const CACHE_LINE_RE = new RegExp(String.raw`^${CACHE_KEY}\s*:[^\r\n]*$`, "im");
const ARXIV_ID_LINE_RE = new RegExp(
  String.raw`^\s*${ARXIV_ID_KEY}\s*:\s*(.+?)\s*$`,
  "im",
);
const ARXIV_ID_ANY_LINE_RE = new RegExp(
  String.raw`^${ARXIV_ID_KEY}\s*:[^\r\n]*$`,
  "im",
);
const UPDATED_VALUE_RE = new RegExp(
  String.raw`^${UPDATED_KEY}\s*:\s*(\S+)\s*$`,
  "im",
);
const UPDATED_LINE_RE = new RegExp(
  String.raw`^${UPDATED_KEY}\s*:[^\r\n]*$`,
  "im",
);

/**
 * Accepts a bare ID, an arXiv URL, or an `arXiv: …` fragment and returns a
 * canonical ID without the version suffix (`2301.12345`, `hep-th/9901001`).
 */
export function normalizeArxivID(candidate: string): string | null {
  let value = (candidate || "").trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the original value when it contains malformed URL escapes.
  }

  value = value
    .replace(/^arxiv\s*:\s*/i, "")
    .replace(/^.*?arxiv\.org\/(?:abs|pdf|html)\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\.pdf$/i, "")
    .replace(/[),.;]+$/, "")
    .trim();

  const match = value.match(new RegExp(`^(${MODERN_ID}|${LEGACY_ID})$`, "i"));
  if (!match) return null;

  // Likes belong to a paper rather than to an individual arXiv revision.
  return match[1].replace(/v\d+$/i, "");
}

/**
 * arXiv assigns every preprint a DataCite DOI of the form
 * `10.48550/arXiv.<id>`, which resolves without any network request.
 */
export function extractArxivIDFromDOI(doi: string): string | null {
  const value = (doi || "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:\s*/i, "")
    .trim();
  if (!value) return null;

  const match = value.match(/^10\.48550\/arxiv\.(.+)$/i);
  if (match) return normalizeArxivID(match[1]);

  // Some publishers embed the arXiv ID in a non-DataCite DOI suffix.
  const embedded = value.match(/arxiv[.:/](.+)$/i);
  return embedded ? normalizeArxivID(embedded[1]) : null;
}

/**
 * Resolves an arXiv ID for an item.
 *
 * Priority: explicit AlphaPulse match (a user confirmation always wins), then
 * the DataCite arXiv DOI, then a canonical `arxiv.org` URL, then `arXiv:`
 * metadata lines inside `Extra`.
 */
export function extractArxivID(
  url: string,
  extra: string,
  doi = "",
): string | null {
  const resolved = (extra || "").match(ARXIV_ID_LINE_RE);
  if (resolved) {
    const id = extractIDFromLooseText(resolved[1]);
    if (id) return id;
  }

  const fromDOI = extractArxivIDFromDOI(doi);
  if (fromDOI) return fromDOI;

  const urlMatch = (url || "").match(ARXIV_URL_RE);
  if (urlMatch) return normalizeArxivID(urlMatch[1]);

  for (const line of (extra || "").split(/\r?\n/)) {
    const metadata = line.match(/^\s*arxiv(?:\s+id)?\s*:\s*(.+?)\s*$/i);
    if (!metadata) continue;

    const id = extractIDFromLooseText(metadata[1]);
    if (id) return id;
  }

  return null;
}

/**
 * Pulls an ID out of free text such as `2301.12345v3`,
 * `https://arxiv.org/abs/hep-th/9901001`, or `arXiv:2301.12345`.
 */
export function extractIDFromLooseText(value: string): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;

  const direct = normalizeArxivID(trimmed);
  if (direct) return direct;

  const urlMatch = trimmed.match(ARXIV_URL_RE);
  if (urlMatch) return normalizeArxivID(urlMatch[1]);

  const anyMatch = trimmed.match(ANY_ID_RE);
  return anyMatch ? normalizeArxivID(anyMatch[1]) : null;
}

export function buildAlphaXivURL(arxivID: string): string {
  const encodedID = arxivID
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://www.alphaxiv.org/abs/${encodedID}`;
}

export function buildArxivAbsURL(arxivID: string): string {
  return `https://arxiv.org/abs/${arxivID}`;
}

export function readCachedLikes(extra: string): number | null {
  const match = (extra || "").match(CACHE_VALUE_RE);
  if (!match) return null;

  const likes = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isSafeInteger(likes) && likes >= 0 ? likes : null;
}

/** When the cached like count was written, as a `Date`, or `null`. */
export function readLikesUpdatedAt(extra: string): Date | null {
  const match = (extra || "").match(UPDATED_VALUE_RE);
  if (!match) return null;

  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function readResolvedArxivID(extra: string): string | null {
  const match = (extra || "").match(ARXIV_ID_LINE_RE);
  return match ? extractIDFromLooseText(match[1]) : null;
}

export function upsertCachedLikes(extra: string, likes: number): string {
  const cacheLine = `${CACHE_KEY}: ${likes}`;
  if (CACHE_LINE_RE.test(extra)) {
    return extra.replace(CACHE_LINE_RE, cacheLine);
  }

  const withoutTrailingNewlines = (extra || "").replace(/[\r\n]+$/, "");
  return withoutTrailingNewlines
    ? `${withoutTrailingNewlines}\n${cacheLine}`
    : cacheLine;
}

export function upsertResolvedArxivID(extra: string, arxivID: string): string {
  const line = `${ARXIV_ID_KEY}: ${arxivID}`;
  if (ARXIV_ID_ANY_LINE_RE.test(extra)) {
    return extra.replace(ARXIV_ID_ANY_LINE_RE, line);
  }

  const withoutTrailingNewlines = (extra || "").replace(/[\r\n]+$/, "");
  return withoutTrailingNewlines ? `${withoutTrailingNewlines}\n${line}` : line;
}

/**
 * Writes the like count together with the timestamp used by the cache TTL.
 */
export function upsertLikesCache(
  extra: string,
  likes: number,
  updatedAt: Date = new Date(),
): string {
  let next = upsertCachedLikes(extra, likes);

  const line = `${UPDATED_KEY}: ${updatedAt.toISOString()}`;
  if (UPDATED_LINE_RE.test(next)) {
    next = next.replace(UPDATED_LINE_RE, line);
  } else {
    next = `${next.replace(/[\r\n]+$/, "")}\n${line}`;
  }

  return next;
}

/** Every `Extra` line AlphaPulse owns, for the "clear data" action. */
const OWNED_LINE_RES = [
  CACHE_LINE_RE,
  ARXIV_ID_ANY_LINE_RE,
  UPDATED_LINE_RE,
  HISTORY_ANY_LINE_RE,
  CITATIONS_ANY_LINE_RE,
  CITATIONS_UPDATED_LINE_RE,
  SCHOLAR_TITLE_ANY_LINE_RE,
];

/** Whether `Extra` still holds any line AlphaPulse owns. */
export function hasAlphaLikesData(extra: string): boolean {
  return (extra || "")
    .split(/\r?\n/)
    .some((line) => OWNED_LINE_RES.some((re) => re.test(line)));
}

/** Removes every line AlphaPulse owns, leaving the rest of `Extra` intact. */
export function stripAlphaLikesData(extra: string): string {
  const stripped = (extra || "")
    .split(/\r?\n/)
    .filter((line) => !OWNED_LINE_RES.some((re) => re.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\r\n]+|[\r\n]+$/g, "");

  return stripped;
}
