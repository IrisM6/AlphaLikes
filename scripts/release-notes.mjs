#!/usr/bin/env node
/**
 * Prints the body a release page should carry, from CHANGELOG.md.
 *
 * Two callers use this: `zotero-plugin.config.ts` feeds it to the release
 * command, and the release workflow pipes it into `gh release edit`.
 *
 * The changelog is written for someone who has just arrived - what the plugin
 * is and how to use it - rather than as a list of what changed since the last
 * version, so the whole document is the release body. A file that does keep
 * per-version sections still works: when a `## v<version>` heading is present,
 * only that section is used.
 *
 * The scaffold's own default writes the release body from the conventional
 * commits between the previous tag and the release commit. It bails out with
 * "_No significant changes._" as soon as that range is empty — which is what
 * happens on a shallow CI checkout — so the first releases shipped an
 * empty body, on the release page and in the marketplace listing alike.
 * Reading the changelog makes both say what the repository says, and works no
 * matter how much history the runner fetched.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FALLBACK = "_更新说明见仓库的 CHANGELOG.md。_";

export function releaseNotes(path = "CHANGELOG.md") {
  try {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");

    // Drop the document title: the release page already shows the version, and
    // the marketplace listing shows the add-on's name above the body.
    const body = (lines[0]?.startsWith("# ") ? lines.slice(1) : lines)
      .join("\n")
      .trim();

    const section = lines.findIndex((line) => line.startsWith("## v"));
    if (section < 0) return body || FALLBACK;

    const start = lines.findIndex(
      (line, index) => index >= section && line.startsWith("## "),
    );
    let end = lines.findIndex(
      (line, index) => index > start && line.startsWith("## "),
    );
    if (end < 0) end = lines.length;
    return lines.slice(start, end).join("\n").trim() || body || FALLBACK;
  } catch (error) {
    console.warn(`release-notes: could not read ${path}:`, error.message);
    return FALLBACK;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${releaseNotes(process.argv[2])}\n`);
}
