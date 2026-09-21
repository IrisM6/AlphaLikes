/**
 * Small surface exposed on the plugin instance (`Zotero.AlphaLikes.api`).
 *
 * Integrations (and scripts run inside Zotero's console) can use it without
 * importing the bundled module graph.
 */

import { extractIDFromLooseText } from "./arxiv-id";
import { getService } from "./column";
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
  version: string;
}

export function createPluginAPI(version: string): AlphaLikesAPI {
  return {
    searchArxiv: (paper: PaperMetadata) => getService().searchArxiv(paper),
    parseArxivID: (value: string) => extractIDFromLooseText(value),
    styleColors: (style: string) => styleAccents(style),
    version,
  };
}
