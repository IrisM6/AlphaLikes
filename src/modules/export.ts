/**
 * Serialisation of selected items for the export context-menu actions.
 *
 * Pure so the escaping rules can be unit tested without touching the file
 * system.
 */

export interface ExportRow {
  title: string;
  doi: string;
  arxivID: string;
  /** alphaXiv like count, or `null` when unknown. */
  likes: number | null;
  /** Primary citation count, or `null` when unknown. */
  citations: number | null;
  /** Semantic Scholar `influentialCitationCount`, when known. */
  influential: number | null;
  /** Whether OpenAlex places the work in its field's top decile. */
  highImpact: boolean;
  /** ISO timestamp of the last AlphaLikes update, when known. */
  updated: string;
}

export type ExportSort = "likes" | "citations" | "title" | "none";

/**
 * Orders rows for export. Unknown values always sort last, so a missing like
 * count never displaces a row with real data.
 */
export function sortRows(rows: ExportRow[], sort: ExportSort): ExportRow[] {
  const copy = [...rows];
  if (sort === "none") return copy;

  const last = Number.NEGATIVE_INFINITY;

  switch (sort) {
    case "likes":
      return copy.sort((a, b) => (b.likes ?? last) - (a.likes ?? last));
    case "citations":
      return copy.sort((a, b) => (b.citations ?? last) - (a.citations ?? last));
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return copy;
  }
}

/** Escapes one CSV field per RFC 4180. */
export function escapeCsvField(value: string): string {
  const text = value ?? "";
  // A leading =, +, - or @ makes spreadsheet software treat the cell as a
  // formula, so those are prefixed with a single quote.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;

  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

const CSV_HEADERS = [
  "Title",
  "DOI",
  "arXiv ID",
  "alphaXiv Likes",
  "Citations",
  "Influential Citations",
  "High Impact",
  "Updated",
];

function cell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "";
  return String(value);
}

export const CSV_BOM = "\uFEFF";

/**
 * Renders rows as CSV.
 *
 * The leading byte-order mark is deliberate: without it Excel on Windows
 * mis-decodes UTF-8 and Chinese titles come out as mojibake.
 */
export function toCsv(rows: ExportRow[], { bom = true } = {}): string {
  const lines = [CSV_HEADERS.join(",")];

  for (const row of rows) {
    lines.push(
      [
        escapeCsvField(row.title),
        escapeCsvField(row.doi),
        escapeCsvField(row.arxivID),
        cell(row.likes),
        cell(row.citations),
        cell(row.influential),
        cell(row.highImpact),
        cell(row.updated),
      ].join(","),
    );
  }

  // Trailing newline keeps the file well-formed for line-oriented tools.
  return (bom ? CSV_BOM : "") + lines.join("\n") + "\n";
}

export interface ExportPayload {
  /** ISO timestamp of the export. */
  exportedAt: string;
  /** Plugin version, so a later reader can tell which fields to expect. */
  version: string;
  /** Number of items in `items`. */
  count: number;
  /** Ordering applied to `items`. */
  sortedBy: ExportSort;
  items: ExportRow[];
}

export function toJson(
  rows: ExportRow[],
  meta: { version: string; sortedBy: ExportSort; exportedAt?: Date },
): string {
  const payload: ExportPayload = {
    exportedAt: (meta.exportedAt ?? new Date()).toISOString(),
    version: meta.version,
    count: rows.length,
    sortedBy: meta.sortedBy,
    items: rows,
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

/** A stable, filesystem-safe file name for the given time. */
export function exportFileName(
  extension: "csv" | "json",
  at: Date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `alphalikes-${stamp}.${extension}`;
}
