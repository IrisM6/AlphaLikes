/**
 * Composition of the optional "paper summary" note.
 *
 * The note body is XHTML because that is what Zotero stores in the
 * `itemNotes.note` column. Text is escaped here rather than upstream so a
 * title containing `<` or `&` cannot corrupt the note. Labels are passed in,
 * which keeps this module pure and testable.
 */

import type { CitationCounts } from "./citations";
import type { ItemTrend } from "./service";

export interface NoteLabels {
  heading: string;
  likes: string;
  citations: string;
  influential: string;
  highImpact: string;
  trendToday: string;
  trendWindow: string;
  generated: string;
  /** `{id}` is replaced with the bare arXiv ID. */
  arxivLink: string;
}

export interface NoteInput {
  likes: number | null;
  citations: CitationCounts | null;
  arxivID: string | null;
  trend: ItemTrend | null;
  updatedAt: Date | null;
}

export interface NoteOptions {
  includeCitations: boolean;
  includeTrend: boolean;
  includeArxivLink: boolean;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return (value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** `+12` / `-5` / `0`, always with an explicit sign for growth. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function line(label: string, value: string): string {
  return `<p><strong>${escapeHtml(label)}</strong> ${value}</p>`;
}

/**
 * Builds the note body.
 *
 * Returns `null` when there is nothing worth writing, so the caller can tell
 * the user instead of inserting an empty note.
 */
export function buildNoteHTML(
  input: NoteInput,
  options: NoteOptions,
  labels: NoteLabels,
): string | null {
  const parts: string[] = [`<h2>${escapeHtml(labels.heading)}</h2>`];
  // Counted separately from `parts`: the heading and the footer are not
  // content, and a note that carries only a like count is still worth writing.
  let contentParts = 0;

  if (input.likes !== null) {
    let value = String(input.likes);

    if (options.includeTrend && input.trend?.latest) {
      const { latest, window: windowTrend } = input.trend;
      value += ` (${escapeHtml(labels.trendToday)} ${formatDelta(latest.delta)})`;

      // Only add the longer window when it covers more than the day already
      // reported, otherwise the note repeats itself.
      if (
        windowTrend &&
        windowTrend.days > latest.days &&
        windowTrend.delta !== latest.delta
      ) {
        value +=
          ` · ${escapeHtml(labels.trendWindow.replace("{days}", String(windowTrend.days)))}` +
          ` ${formatDelta(windowTrend.delta)}`;
      }
    }

    parts.push(line(labels.likes, value));
    contentParts += 1;
  }

  if (options.includeCitations && input.citations) {
    const counts = input.citations;
    const pieces: string[] = [];

    if (counts.openAlex !== undefined)
      pieces.push(`OpenAlex ${counts.openAlex}`);
    if (counts.semanticScholar !== undefined) {
      pieces.push(`Semantic Scholar ${counts.semanticScholar}`);
    }
    if (counts.influential !== undefined) {
      pieces.push(`${escapeHtml(labels.influential)} ${counts.influential}`);
    }

    if (pieces.length) {
      parts.push(line(labels.citations, pieces.join(" · ")));
      contentParts += 1;
    }
    if (counts.top10Percent || counts.top1Percent) {
      parts.push(`<p>${escapeHtml(labels.highImpact)}</p>`);
      contentParts += 1;
    }
  }

  if (options.includeArxivLink && input.arxivID) {
    const url = `https://arxiv.org/abs/${encodeURIComponent(input.arxivID)}`;
    parts.push(
      `<p><a href="${escapeHtml(url)}">${escapeHtml(
        labels.arxivLink.replace("{id}", input.arxivID),
      )}</a></p>`,
    );
    contentParts += 1;
  }

  if (input.updatedAt) {
    const stamp = input.updatedAt.toISOString().slice(0, 16).replace("T", " ");
    parts.push(
      `<p><em>${escapeHtml(labels.generated)} ${escapeHtml(stamp)} UTC</em></p>`,
    );
  }

  // A heading plus the footer alone carries no information.
  return contentParts > 0 ? parts.join("\n") : null;
}
