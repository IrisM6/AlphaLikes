// @ts-check Let TypeScript check this config file.

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
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
