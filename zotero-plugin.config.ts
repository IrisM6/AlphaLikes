import { releaseNotes } from "./scripts/release-notes.mjs";
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: "alphapulse",
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}-v{{version}}.xpi",

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
    // The whole suite is what ships, but a run that watches one area is worth
    // having while it is being written: point this at a directory holding
    // links to the files you want and the rest of the suite stays out of the
    // way. Unset, nothing changes.
    entries: process.env.ALPHAPULSE_TEST_ENTRIES
      ? process.env.ALPHAPULSE_TEST_ENTRIES.split(",")
      : undefined,
  },

  release: {
    // See scripts/release-notes.mjs: the newest CHANGELOG.md section, instead
    // of the conventional-commit summary that came out empty on CI.
    changelog: () => releaseNotes(),
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
