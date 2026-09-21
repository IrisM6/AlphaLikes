import { readFileSync } from "node:fs";

import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

/**
 * Release notes come from the newest section of CHANGELOG.md.
 *
 * The scaffold's default collects conventional commits since the previous tag.
 * The commits in this repository are prose, so every release so far shipped the
 * body "_No significant changes._" — both on the release page and in the
 * marketplace listing, which shows the release body. Reading the changelog
 * keeps the release page, the listing and the repository saying the same thing.
 */
function releaseNotes(): string {
  const fallback = "_更新说明见仓库的 CHANGELOG.md。_";
  try {
    const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
    const start = lines.findIndex((line) => line.startsWith("## "));
    if (start < 0) return fallback;
    let end = lines.findIndex(
      (line, index) => index > start && line.startsWith("## "),
    );
    if (end < 0) end = lines.length;
    return lines.slice(start, end).join("\n").trim() || fallback;
  } catch (error) {
    console.warn("CHANGELOG.md could not be read:", error);
    return fallback;
  }
}

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: "alphalikes",
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  release: {
    changelog: () => releaseNotes(),
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
