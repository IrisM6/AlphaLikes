/**
 * Small surface exposed on the plugin instance (`Zotero.AlphaLikes.api`).
 *
 * The picker dialog and other integrations can use it without importing the
 * bundled module graph.
 */

import { extractIDFromLooseText } from "./arxiv-id";
import { getService } from "./column";
import { pickerStrings } from "./l10n";
import type { ArxivCandidate, PaperMetadata } from "./resolver";

export interface AlphaLikesAPI {
  searchArxiv(paper: PaperMetadata): Promise<ArxivCandidate[]>;
  parseArxivID(value: string): string | null;
  pickerStrings(): Record<string, string>;
  version: string;
}

export function createPluginAPI(version: string): AlphaLikesAPI {
  return {
    searchArxiv: (paper: PaperMetadata) => getService().searchArxiv(paper),
    parseArxivID: (value: string) => extractIDFromLooseText(value),
    pickerStrings: () => pickerStrings(),
    version,
  };
}
