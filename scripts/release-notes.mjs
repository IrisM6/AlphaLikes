#!/usr/bin/env node
/**
 * Prints the newest section of CHANGELOG.md.
 *
 * Two callers use this: `zotero-plugin.config.ts` feeds it to the release
 * command, and the release workflow pipes it into `gh release edit`.
 *
 * The scaffold's own default writes the release body from the conventional
 * commits between the previous tag and the release commit. It bails out with
 * "_No significant changes._" as soon as that range is empty — which is what
 * happens on a shallow CI checkout — so every release up to 1.6.0 shipped an
 * empty body, on the release page and in the marketplace listing alike.
 * Reading the changelog makes both say what the repository says, and works no
 * matter how much history the runner fetched.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FALLBACK = "_更新说明见仓库的 CHANGELOG.md。_";

export function releaseNotes(path = "CHANGELOG.md") {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    const start = lines.findIndex((line) => line.startsWith("## "));
    if (start < 0) return FALLBACK;
    let end = lines.findIndex(
      (line, index) => index > start && line.startsWith("## "),
    );
    if (end < 0) end = lines.length;
    return lines.slice(start, end).join("\n").trim() || FALLBACK;
  } catch (error) {
    console.warn(`release-notes: could not read ${path}:`, error.message);
    return FALLBACK;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${releaseNotes(process.argv[2])}\n`);
}
