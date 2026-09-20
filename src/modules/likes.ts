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

/** Sort keys are zero padded so lexicographic order equals numeric order. */
const SORT_WIDTH = 16;
const SORTABLE_RE = new RegExp(`^\\d{${SORT_WIDTH},}$`);

/**
 * Selector chain for the like counter. The first entry is the current alphaXiv
 * markup; the others are older variants kept as a cheap fallback.
 */
export const LIKE_COUNT_SELECTORS = [
  'button[aria-label="Like this paper"] span.inline-block',
  'button[aria-label="Like this paper"] span',
  'button[aria-label="Like this paper"]',
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
  return null;
}

export function toSortableValue(likes: number): string {
  return String(likes).padStart(SORT_WIDTH, "0");
}

export function fromSortableValue(value: string): string {
  if (!SORTABLE_RE.test(value)) return value;
  return String(Number.parseInt(value, 10));
}

/** Whether a cell value is one of the non-numeric status markers. */
export function isStatusValue(value: string): boolean {
  return (
    value === CELL_LOADING ||
    value === CELL_UNAVAILABLE ||
    value === CELL_PENDING
  );
}

export function isArxivAbsURL(url: string): boolean {
  return /arxiv\.org\/abs\//i.test(url || "");
}

export { REQUEST_TIMEOUT_MS };
