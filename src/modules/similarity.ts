/**
 * Fuzzy matching helpers used to decide whether a candidate found through a
 * scholarly API really is the paper stored in the Zotero item.
 *
 * Pure module: no Zotero or network access, so it is cheap to unit test.
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Longest title we run the quadratic distance calculation on. */
const MAX_COMPARE_LENGTH = 400;

/** Below this many characters a title is too short to trust containment. */
const MIN_CONTAINMENT_LENGTH = 20;

/** Fraction of the longer title the shorter one must cover to count. */
const CONTAINMENT_RATIO = 0.8;

const NAME_PARTICLES = new Set([
  "al",
  "bin",
  "da",
  "de",
  "del",
  "della",
  "den",
  "der",
  "di",
  "dos",
  "el",
  "ibn",
  "la",
  "le",
  "st",
  "van",
  "von",
]);

/**
 * Lower-cases, strips accents and LaTeX markup, and collapses the remainder to
 * space separated alphanumeric tokens.
 *
 * Math delimiters are dropped but their content is kept so that `$\alpha$` and
 * a plain `alpha` normalise to the same token — arXiv titles are full of both.
 */
export function normalizeText(value: string): string {
  const text = (value || "")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    // `\alpha` -> `alpha`, so a LaTeX command reads like the word it names.
    .replace(/\\([a-zA-Z]+)\*?/g, " $1 ")
    .replace(/[{}$\\]/g, " ")
    .toLowerCase();

  return text
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function truncate(value: string): string {
  return value.length > MAX_COMPARE_LENGTH
    ? value.slice(0, MAX_COMPARE_LENGTH)
    : value;
}

/** Iterative Levenshtein distance using two rows of memory. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const left = truncate(a);
  const right = truncate(b);

  let previous = new Array<number>(right.length + 1);
  let current = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j++) previous[j] = j;

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    const leftCode = left.charCodeAt(i - 1);
    for (let j = 1; j <= right.length; j++) {
      const substitutionCost = leftCode === right.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[right.length];
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Weighted blend of normalized edit distance and token overlap.
 *
 * Journal and preprint versions of the same work often differ only by a
 * subtitle, so an almost-complete containment also counts as a strong match —
 * but only when the shorter title covers most of the longer one, which keeps
 * `Attention Is All You Need` from matching `Attention Is All You Need In
 * Speech Separation`.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (
    shorter.length >= MIN_CONTAINMENT_LENGTH &&
    longer.includes(shorter) &&
    shorter.length / longer.length >= CONTAINMENT_RATIO
  ) {
    return 0.96;
  }

  const editRatio =
    1 - levenshteinDistance(left, right) / Math.max(left.length, right.length);
  const overlap = jaccardSimilarity(new Set(tokenize(a)), new Set(tokenize(b)));

  return clamp01(0.6 * editRatio + 0.4 * overlap);
}

/**
 * Surname of a personal name, ignoring nobiliary particles.
 *
 * Handles both `Ashish Vaswani` and the `Vaswani, Ashish` form used by many
 * bibliographic APIs, where the surname is the first token rather than the
 * last one.
 */
export function surnameOf(name: string): string {
  const raw = (name || "").trim();
  if (!raw) return "";

  // Only the part before the comma is a surname in `Last, First` form.
  const source = raw.includes(",") ? raw.slice(0, raw.indexOf(",")) : raw;
  const tokens = tokenize(source).filter((token) => !NAME_PARTICLES.has(token));
  return tokens.length ? tokens[tokens.length - 1] : "";
}

/**
 * `null` when either side has no usable author list, otherwise whether the two
 * lists share an author.
 */
export function authorsMatch(
  paperAuthors: string[],
  candidateAuthors: string[],
): boolean | null {
  const left = (paperAuthors || []).filter(Boolean);
  const right = (candidateAuthors || []).filter(Boolean);
  if (!left.length || !right.length) return null;

  const candidateSurnames = new Set(
    right.map(surnameOf).filter((surname) => surname.length > 1),
  );
  for (const author of left) {
    const surname = surnameOf(author);
    if (surname.length > 1 && candidateSurnames.has(surname)) return true;
  }

  // Fall back to token overlap for names the surname heuristic misses.
  for (const author of left) {
    const tokens = tokenize(author).filter(
      (token) => token.length > 2 && !NAME_PARTICLES.has(token),
    );
    if (!tokens.length) continue;

    for (const candidate of right) {
      const candidateTokens = new Set(
        tokenize(candidate).filter((token) => token.length > 2),
      );
      let shared = 0;
      for (const token of tokens) {
        if (candidateTokens.has(token)) shared++;
      }
      if (shared >= 2 || (tokens.length === 1 && shared === 1)) return true;
    }
  }

  return false;
}

/** `null` when either year is unknown, otherwise `|a - b|`. */
export function yearDistance(
  paperYear: number | null,
  candidateYear: number | null,
): number | null {
  if (!paperYear || !candidateYear) return null;
  return Math.abs(paperYear - candidateYear);
}

/** Publication years of the same work differ by at most one. */
export function yearsMatch(
  paperYear: number | null,
  candidateYear: number | null,
): boolean | null {
  const distance = yearDistance(paperYear, candidateYear);
  return distance === null ? null : distance <= 1;
}

export interface MatchInput {
  title: string;
  authors: string[];
  year: number | null;
}

export interface CandidateMatch {
  score: number;
  titleSimilarity: number;
  authorMatched: boolean | null;
  yearMatched: boolean | null;
  yearDelta: number | null;
}

/**
 * Confidence that a candidate is the same paper as the item.
 *
 * Weights are renormalized over the signals both sides actually provide, so a
 * perfect title match is not punished when the item simply has no author or
 * year metadata.
 */
export function scoreCandidate(
  paper: MatchInput,
  candidate: MatchInput,
): CandidateMatch {
  const similarity = titleSimilarity(paper.title, candidate.title);
  const authorMatched = authorsMatch(paper.authors, candidate.authors);
  const yearMatched = yearsMatch(paper.year, candidate.year);
  const yearDelta = yearDistance(paper.year, candidate.year);

  let weighted = 0.7 * similarity;
  let total = 0.7;

  if (authorMatched !== null) {
    total += 0.2;
    if (authorMatched) weighted += 0.2;
  }
  if (yearMatched !== null) {
    total += 0.1;
    if (yearMatched) weighted += 0.1;
  }

  return {
    score: total ? clamp01(weighted / total) : 0,
    titleSimilarity: similarity,
    authorMatched,
    yearMatched,
    yearDelta,
  };
}

/** First author surname, used for compact candidate descriptions. */
export function shortAuthorList(authors: string[], max = 3): string {
  const list = (authors || []).filter(Boolean);
  if (!list.length) return "";
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} et al.`;
}
