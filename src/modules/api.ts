/**
 * Small surface exposed on the plugin instance (`Zotero.AlphaPulse.api`).
 *
 * Integrations (and scripts run inside Zotero's console) can use it without
 * importing the bundled module graph.
 */

import { extractIDFromLooseText } from "./arxiv-id";
import { getService } from "./column";
import type { HttpTransport } from "./http";
import type { ScholarItemActivity } from "./service";
import { styleAccents, type BandColors } from "./palette";
import type { ArxivCandidate, PaperMetadata } from "./resolver";

export interface AlphaLikesAPI {
  /** Runs the same search the automatic matcher runs, and returns the ranking. */
  searchArxiv(paper: PaperMetadata): Promise<ArxivCandidate[]>;
  parseArxivID(value: string): string | null;
  /**
   * The colours a display style paints its bands in by default.
   *
   * The settings pane shows these as the starting point of every colour, and
   * the "restore the style's colours" button puts them back, so the pane and
   * the renderer cannot drift apart.
   */
  styleColors(style: string): BandColors;
  /**
   * One real attempt at both reads, written down as text.
   *
   * The settings pane copies the result to the clipboard: what the reads do
   * depends on the machine's network and proxy, so "it does not work" needs the
   * machine's own facts rather than a description of them.
   */
  diagnose(): Promise<string>;
  /**
   * Routes every read through `transport`, or restores Zotero's own with
   * `null`.
   *
   * A test seam, and a way to see what a read does without letting it reach
   * the site: the same transport shape the plugin uses internally
   * (`(method, url, options) => { status, response }`).
   */
  setReadTransport(transport: HttpTransport | null): void;
  /**
   * What the reading is doing, paper by paper, and what each paper waits for.
   *
   * The settings pane reads it to show the reading as it happens: which paper
   * is being read, which one is waiting out Google's check and for how long,
   * and how many searches each of them has cost. The reading is sequential, so
   * a session-wide count says nothing about the paper the user is looking at -
   * `items` is the part that answers that.
   */
  scholarActivity(): {
    requests: number;
    nextInMs: number;
    paused: boolean;
    burstLeft: number;
    autoPaused: boolean;
    items: ScholarItemActivity[];
  };
  version: string;
}

export function createPluginAPI(version: string): AlphaLikesAPI {
  return {
    setReadTransport: (transport: HttpTransport | null) =>
      getService().setReadTransport(transport),
    searchArxiv: (paper: PaperMetadata) => getService().searchArxiv(paper),
    parseArxivID: (value: string) => extractIDFromLooseText(value),
    styleColors: (style: string) => styleAccents(style),
    diagnose: () => getService().diagnose(),
    scholarActivity: () => getService().scholarActivity(),
    version,
  };
}
