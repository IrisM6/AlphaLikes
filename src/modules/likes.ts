/**
 * Reading like counts out of an alphaXiv paper page, plus the cell encoding
 * used to keep the item-tree column sortable.
 */

import { REQUEST_TIMEOUT_MS } from "./constants";

/** Shown while a value is still being fetched. */
export const CELL_LOADING = "…";
/** Shown when alphaXiv could not be read. */
export const CELL_UNAVAILABLE = "N/A";
/** Shown when a candidate match needs the user to confirm it. */
export const CELL_PENDING = "?";
/**
 * Shown for an item whose records were cleared with the context menu.
 *
 * The cell stays visually empty - that is what the user asked for - but the
 * value is not blank, so the renderer can explain why it is empty and how to
 * bring the counts back. A blank string would be indistinguishable from an
 * item this plugin has simply never looked at.
 */
export const CELL_CLEARED = "cleared";

/** Sort keys are zero padded so lexicographic order equals numeric order. */
const SORT_WIDTH = 16;
const SORTABLE_RE = new RegExp(`^\\d{${SORT_WIDTH},}$`);

/** The like control, whether or not it currently carries a number. */
export const LIKE_BUTTON_SELECTOR = 'button[aria-label="Like this paper"]';

/**
 * Selector chain for the like counter. The first entry is the current alphaXiv
 * markup; the others are older variants kept as a cheap fallback.
 */
export const LIKE_COUNT_SELECTORS = [
  `${LIKE_BUTTON_SELECTOR} span.inline-block`,
  `${LIKE_BUTTON_SELECTOR} span`,
  LIKE_BUTTON_SELECTOR,
] as const;

export function parseLikesText(text: string | null | undefined): number | null {
  const raw = (text || "").trim();
  if (!raw || !/\d/.test(raw)) return null;

  const abbreviated = raw.match(/^([\d,.]+)\s*([kmb])$/i);
  if (abbreviated) {
    const base = Number.parseFloat(abbreviated[1].replace(/,/g, ""));
    const multipliers: Record<string, number> = {
      k: 1_000,
      m: 1_000_000,
      b: 1_000_000_000,
    };
    const result = Math.round(base * multipliers[abbreviated[2].toLowerCase()]);
    return Number.isSafeInteger(result) && result >= 0 ? result : null;
  }

  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const result = Number.parseInt(digits, 10);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

export function parseLikesFromDocument(doc: Document): number | null {
  for (const selector of LIKE_COUNT_SELECTORS) {
    const element = doc.querySelector(selector);
    const likes = parseLikesText(element?.textContent);
    if (likes !== null) return likes;
  }

  // alphaXiv leaves the number out entirely when a paper has no likes yet: the
  // button is there with its thumb and nothing else - on 2312.00001 and
  // 2312.00002 there is no `span.inline-block` anywhere on the page, while
  // every paper with a like carries one. A control that loaded and is blank is
  // a count of zero, not a failed read; reporting it as a failure told the
  // user to wait five minutes for a number the page had already given.
  //
  // The distinction is deliberate: no button at all still means "could not
  // read" (the page is not a paper view, or its markup moved), while a button
  // whose number is absent is the site's way of writing zero.
  if (doc.querySelector(LIKE_BUTTON_SELECTOR)) return 0;

  return null;
}

/**
 * Separates the sort key from the display decorations appended to it.
 *
 * The data provider is the only channel between `dataProvider` and
 * `renderCell`, so anything the cell needs beyond the bare number - a like
 * trend, a high-impact marker - travels in the same string. Decorations only
 * ever follow the sort key, so lexicographic ordering is unaffected.
 */
export const VALUE_DECORATION_SEPARATOR = "|";

export function toSortableValue(likes: number): string {
  return String(likes).padStart(SORT_WIDTH, "0");
}

/** Splits a data value into its sort key and its list of decorations. */
export function splitValueDecorations(value: string): {
  key: string;
  decorations: string[];
} {
  const raw = value ?? "";
  const index = raw.indexOf(VALUE_DECORATION_SEPARATOR);
  if (index < 0) return { key: raw, decorations: [] };

  return {
    key: raw.slice(0, index),
    decorations: raw
      .slice(index + 1)
      .split(VALUE_DECORATION_SEPARATOR)
      .filter(Boolean),
  };
}

/** Attaches decorations to a sort key. An empty key stays empty. */
export function withValueDecorations(
  value: string,
  decorations: (string | number | null | undefined)[],
): string {
  if (!value) return value;

  const parts = decorations
    .filter(
      (entry): entry is string | number =>
        entry !== null && entry !== undefined,
    )
    .map(String)
    .filter(Boolean);

  return parts.length
    ? `${value}${VALUE_DECORATION_SEPARATOR}${parts.join(VALUE_DECORATION_SEPARATOR)}`
    : value;
}

export function fromSortableValue(value: string): string {
  const { key } = splitValueDecorations(value);
  if (!SORTABLE_RE.test(key)) return key;
  return String(Number.parseInt(key, 10));
}

/** Whether a cell value is one of the non-numeric status markers. */
export function isStatusValue(value: string): boolean {
  if (SORTABLE_RE.test(value)) return false;
  const { key } = splitValueDecorations(value);
  return (
    key === CELL_LOADING ||
    key === CELL_UNAVAILABLE ||
    key === CELL_PENDING ||
    key === CELL_CLEARED
  );
}

/**
 * Why a cell is empty, as a short code that travels in the cell value.
 *
 * Every failed read renders the same "N/A", and the reason only exists in the
 * service, which the renderer cannot reach: `dataProvider` and `renderCell`
 * trade a single string, so the code rides along in the decorations. Codes
 * rather than messages, because the renderer is the only place that can
 * translate them.
 */
export const FAILURE_REASONS = [
  /** 403: refused outright, which is usually a regional or bot check. */
  "http-403",
  /** 429: rate limited. */
  "http-429",
  /** Any other 4xx. */
  "http-4xx",
  /** 5xx: the other side is having a bad day. */
  "http-5xx",
  /** The request never produced a response: DNS, proxy, TLS, timeout. */
  "network",
  /** A 2xx with an empty body. */
  "empty",
  /** The page arrived, but the number was not in it. */
  "no-count",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export function isFailureReason(
  value: string | undefined,
): value is FailureReason {
  return (
    value !== undefined &&
    (FAILURE_REASONS as readonly string[]).includes(value)
  );
}

/** Turns whatever a request threw into one of the codes above. */
export function failureReasonFrom(error: unknown): FailureReason {
  const message = error instanceof Error ? error.message : String(error);
  const status = /HTTP\s+(\d{3})/.exec(message);

  if (status) {
    const code = Number.parseInt(status[1], 10);
    if (code === 403) return "http-403";
    if (code === 429) return "http-429";
    return code >= 500 ? "http-5xx" : "http-4xx";
  }
  if (/empty response/i.test(message)) return "empty";
  return "network";
}

/** The reason a cell value carries, when it carries one. */
export function failureReasonIn(
  decorations: readonly string[],
): FailureReason | null {
  return decorations.find(isFailureReason) ?? null;
}

export function isArxivAbsURL(url: string): boolean {
  return /arxiv\.org\/abs\//i.test(url || "");
}

export { REQUEST_TIMEOUT_MS };
