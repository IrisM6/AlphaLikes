// @ts-check Let TypeScript check this config file.

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      // Node-side helper scripts (release notes, the style preview page) run
      // in node, not in the browser.
      files: ["scripts/**/*.mjs"],
      languageOptions: {
        globals: {
          process: "readonly",
          console: "readonly",
        },
      },
    },
    {
      // Tests run in a real Zotero, not under a type checker: the test tree is
      // not part of `tsc` (76 pre-existing type errors), so an identifier that
      // does not exist - a helper that lives inside another suite, say - is
      // only found at run time, as a bare "undefined" failure several minutes
      // into a Zotero run. `no-undef` catches exactly that, cheaply.
      files: ["test/**/*.ts"],
      languageOptions: {
        globals: {
          Zotero: "readonly",
          Services: "readonly",
          ChromeUtils: "readonly",
          Components: "readonly",
          describe: "readonly",
          it: "readonly",
          before: "readonly",
          after: "readonly",
          beforeEach: "readonly",
          afterEach: "readonly",
          window: "readonly",
          document: "readonly",
          DOMParser: "readonly",
          Event: "readonly",
          MouseEvent: "readonly",
          Node: "readonly",
          Window: "readonly",
          Document: "readonly",
          Element: "readonly",
          HTMLElement: "readonly",
          HTMLInputElement: "readonly",
          setTimeout: "readonly",
          clearTimeout: "readonly",
        },
      },
      rules: {
        "no-undef": "error",
      },
    },
    {
      // Chrome scripts under addon/ ship verbatim and are not part of the
      // TypeScript bundle, so they run in a browser/XUL environment instead.
      files: ["addon/**/*.js"],
      languageOptions: {
        globals: {
          window: "readonly",
          document: "readonly",
          Event: "readonly",
          Zotero: "readonly",
          Services: "readonly",
          console: "readonly",
        },
      },
    },
  ],
});
