/**
 * Like-count history, stored as a compact line in `Extra`:
 *
 *   alphaxiv_likes_history: 2026-09-20:2979;2026-09-19:2967
 *
 * One snapshot per calendar day, newest first, capped so `Extra` cannot grow
 * without bound. Everything here is pure so the arithmetic is unit tested.
 */

export const HISTORY_KEY = "alphaxiv_likes_history";

/** How many daily snapshots are kept. Older entries are dropped. */
export const HISTORY_MAX_ENTRIES = 7;

const HISTORY_LINE_RE = new RegExp(
  String.raw`^\s*${HISTORY_KEY}\s*:\s*([^\r\n]*)$`,
  "im",
);

/** Matches the history line as a whole, for the "clear data" action. */
export const HISTORY_ANY_LINE_RE = new RegExp(
  String.raw`^\s*${HISTORY_KEY}\s*:[^\r\n]*$`,
  "im",
);

/** `YYYY-MM-DD` in the user's local time zone. */
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface LikesSnapshot {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  likes: number;
}

export interface TrendDelta {
  /** `newest.likes - older.likes`. Negative when the count went down. */
  delta: number;
  fromDate: string;
  toDate: string;
  /** Calendar days between the two snapshots, so the UI can label the span. */
  days: number;
}

/** Formats a `Date` as the local `YYYY-MM-DD` used on disk. */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses `YYYY-MM-DD` into a `Date` at local midnight, or `null`. */
export function fromDateKey(date: string): Date | null {
  const match = DATE_KEY_RE.exec((date || "").trim());
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole calendar days from `from` to `to`. */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * Parses the snapshot line.
 *
 * The result is always sorted newest first regardless of how the stored value
 * was ordered, so a hand-edited `Extra` field still behaves.
 */
export function parseLikesHistory(raw: string): LikesSnapshot[] {
  const match = HISTORY_LINE_RE.exec(raw || "");
  if (!match) return [];

  const seen = new Map<string, number>();
  for (const chunk of match[1].split(";")) {
    const entry = chunk.trim();
    if (!entry) continue;

    const separator = entry.lastIndexOf(":");
    if (separator <= 0) continue;

    const date = entry.slice(0, separator).trim();
    if (!fromDateKey(date)) continue;

    const likes = Number.parseInt(entry.slice(separator + 1).trim(), 10);
    if (!Number.isSafeInteger(likes) || likes < 0) continue;

    // A duplicated date keeps its latest value rather than appearing twice.
    seen.set(date, likes);
  }

  return [...seen.entries()]
    .map(([date, likes]) => ({ date, likes }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function readLikesHistory(extra: string): LikesSnapshot[] {
  return parseLikesHistory(extra);
}

export function serializeLikesHistory(snapshots: LikesSnapshot[]): string {
  return snapshots.map(({ date, likes }) => `${date}:${likes}`).join(";");
}

/**
 * Records today's count, replacing an entry for the same day, and trims the
 * list. Returns `extra` unchanged when nothing would change, so the caller can
 * skip a needless item save.
 */
export function recordLikesSnapshot(
  extra: string,
  likes: number,
  now: Date = new Date(),
  maxEntries: number = HISTORY_MAX_ENTRIES,
): string {
  if (!Number.isSafeInteger(likes) || likes < 0) return extra;

  const today = toDateKey(now);
  const existing = parseLikesHistory(extra);

  const alreadyToday =
    existing.length > 0 &&
    existing[0].date === today &&
    existing[0].likes === likes;
  if (alreadyToday) return extra;

  const merged = existing.filter((snapshot) => snapshot.date !== today);
  merged.push({ date: today, likes });

  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const trimmed = merged.slice(0, Math.max(1, maxEntries));

  const line = `${HISTORY_KEY}: ${serializeLikesHistory(trimmed)}`;
  if (HISTORY_LINE_RE.test(extra || "")) {
    return (extra || "").replace(HISTORY_LINE_RE, line);
  }

  const withoutTrailingNewlines = (extra || "").replace(/[\r\n]+$/, "");
  return withoutTrailingNewlines ? `${withoutTrailingNewlines}\n${line}` : line;
}

/**
 * Change since the previous snapshot, which is the day-over-day delta because
 * at most one snapshot is written per day. `null` until there are two.
 */
export function latestTrend(snapshots: LikesSnapshot[]): TrendDelta | null {
  if (snapshots.length < 2) return null;

  const [newest, previous] = snapshots;
  const from = fromDateKey(previous.date);
  const to = fromDateKey(newest.date);
  if (!from || !to) return null;

  return {
    delta: newest.likes - previous.likes,
    fromDate: previous.date,
    toDate: newest.date,
    days: daysBetween(from, to),
  };
}

/**
 * Change over the last `days`, measured against the oldest snapshot inside
 * that window.
 *
 * The window is a ceiling, not a target: with a shorter history the delta
 * covers what is actually stored and `days` reports the real span, so a caller
 * that cares can tell "over 6 days" from "over 7 days". `null` is returned
 * only when nothing in the window is older than the newest snapshot, which
 * would just repeat the day-over-day figure.
 */
export function trendOverDays(
  snapshots: LikesSnapshot[],
  days: number,
  now: Date = new Date(),
): TrendDelta | null {
  if (snapshots.length < 2 || days < 1) return null;

  const [newest] = snapshots;
  const newestDate = fromDateKey(newest.date);
  if (!newestDate) return null;

  let reference: LikesSnapshot | null = null;
  for (const snapshot of snapshots) {
    const date = fromDateKey(snapshot.date);
    if (!date) continue;

    const age = daysBetween(date, now);
    // `age > 0` keeps the window delta distinct from the daily one.
    if (age <= 0 || age > days) continue;
    reference = snapshot;
  }
  if (!reference) return null;

  const from = fromDateKey(reference.date);
  if (!from) return null;

  return {
    delta: newest.likes - reference.likes,
    fromDate: reference.date,
    toDate: newest.date,
    days: daysBetween(from, newestDate),
  };
}
