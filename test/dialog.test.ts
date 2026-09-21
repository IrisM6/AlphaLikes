/**
 * Dialog tests for the two pickers.
 *
 * The reported complaint about the arXiv picker was "it found the paper and
 * still showed a failure, and nothing could be clicked or selected". A unit
 * test on the resolver cannot see that: it happens in the dialog's own DOM. So
 * these tests open the real dialogs, in a real Zotero window, and click.
 *
 * The dialogs are opened without the `modal` flag on purpose - a modal window
 * would block the test run itself.
 */

import { assert } from "chai";
import { config } from "../package.json";
import { pickerStrings, scholarPickerStrings } from "../src/modules/l10n";
import type { PickerRequest, ScholarPickerRequest } from "../src/modules/menu";

const ARXIV_DIALOG = `chrome://${config.addonRef}/content/arxiv-picker.xhtml`;
const SCHOLAR_DIALOG = `chrome://${config.addonRef}/content/scholar-picker.xhtml`;

interface DialogWindow extends Window {
  document: Document;
}

function mainWindow(): Window & {
  openDialog?: (
    url: string,
    name: string,
    features: string,
    arg: unknown,
  ) => DialogWindow | null;
} {
  const win = Zotero.getMainWindow() as unknown as
    (Window & { openDialog?: never }) | null;
  if (!win) throw new Error("the Zotero main window is not available");
  return win as never;
}

async function waitFor<T>(
  what: string,
  probe: () => T | null,
  timeoutMs = 4_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Zotero.Promise.delay(25);
  }
}

/** Fires the click the way a user's mouse would, on `node` itself. */
function click(node: Element): void {
  node.dispatchEvent(
    new (node.ownerDocument!.defaultView as Window).MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("AlphaLikes dialogs", function () {
  this.timeout(20_000);

  describe("the arXiv picker", function () {
    it("lists candidates and applies the one that was clicked", async function () {
      const request: PickerRequest = {
        strings: pickerStrings(),
        itemTitle: "A paper with a candidate",
        itemSummary: "DOI: 10.0/x",
        currentArxivID: null,
        candidates: [
          {
            arxivID: "2401.00001",
            title: "First Candidate",
            authors: [],
            year: 2024,
            source: "arxiv",
            sourceLabel: "arXiv",
            confidence: "medium",
            score: 0.8,
            titleSimilarity: 0.8,
            authorMatched: null,
            yearMatched: null,
            detail: "title 80%",
            url: "https://arxiv.org/abs/2401.00001",
            authoritative: false,
          },
          {
            arxivID: "2401.00002",
            title: "Second Candidate",
            authors: [],
            year: 2024,
            source: "arxiv",
            sourceLabel: "arXiv",
            confidence: "low",
            score: 0.5,
            titleSimilarity: 0.5,
            authorMatched: null,
            yearMatched: null,
            detail: "title 50%",
            url: "https://arxiv.org/abs/2401.00002",
            authoritative: false,
          },
        ],
        paper: {
          title: "A paper with a candidate",
          doi: "10.0/x",
          authors: [],
          year: 2024,
          extra: "",
        },
        autoSearch: false,
        searchAgain: async () => [],
        parseArxivID: (value) => value,
        result: null,
      };

      const dialog = mainWindow().openDialog?.(
        ARXIV_DIALOG,
        "alphalikes-arxiv-picker-test",
        "chrome,centerscreen,resizable,width=760,height=620",
        request,
      );
      assert.isOk(dialog, "the picker dialog has to open");

      const rows = await waitFor("the candidate rows", () => {
        const group = dialog!.document.getElementById("candidate-group");
        const children = group?.children ?? [];
        return children.length ? Array.from(children) : null;
      });
      assert.lengthOf(rows, 2);

      // Click the second row, and click a *child* of it: a handler that only
      // fires for the row itself is what makes a result feel unselectable.
      const secondRow = rows[1] as HTMLElement;
      const target = secondRow.querySelector("description") ?? secondRow;
      click(target);

      const apply = dialog!.document.getElementById("apply") as HTMLElement & {
        disabled?: boolean;
      };
      assert.isFalse(apply.disabled, "picking a row has to enable Apply");
      apply.dispatchEvent(
        new (dialog!.document.defaultView as Window).Event("command"),
      );

      assert.isOk(request.result, "the dialog has to hand a result back");
      assert.equal(
        (request.result as { action: string; arxivID: string }).action,
        "apply",
      );
      assert.equal(
        (request.result as { arxivID: string }).arxivID,
        "2401.00002",
        "the clicked row is the one that is applied",
      );
    });

    it("searches by itself when the list is empty", async function () {
      let searched = 0;
      const request: PickerRequest = {
        strings: pickerStrings(),
        itemTitle: "A paper nothing was found for",
        itemSummary: "",
        currentArxivID: null,
        candidates: [],
        paper: {
          title: "A paper nothing was found for",
          doi: "",
          authors: [],
          year: 2024,
          extra: "",
        },
        autoSearch: true,
        searchAgain: async () => {
          searched += 1;
          return [
            {
              arxivID: "2402.00007",
              title: "Found By The Dialog Itself",
              authors: [],
              year: 2024,
              source: "arxiv",
              sourceLabel: "arXiv",
              confidence: "high",
              score: 0.95,
              titleSimilarity: 0.95,
              authorMatched: null,
              yearMatched: null,
              detail: "title 95%",
              url: "https://arxiv.org/abs/2402.00007",
              authoritative: false,
            },
          ];
        },
        parseArxivID: (value) => value,
        result: null,
      };

      const dialog = mainWindow().openDialog?.(
        ARXIV_DIALOG,
        "alphalikes-arxiv-picker-auto-test",
        "chrome,centerscreen,resizable,width=760,height=620",
        request,
      );
      assert.isOk(dialog, "the picker dialog has to open");

      const rows = await waitFor("the automatically searched row", () => {
        const group = dialog!.document.getElementById("candidate-group");
        const children = group?.children ?? [];
        return children.length ? Array.from(children) : null;
      });

      assert.equal(searched, 1, "the dialog runs the search as it opens");
      assert.lengthOf(rows, 1);

      // Clean up: the test is done with this window.
      dialog!.close();
    });
  });

  describe("the Google Scholar record picker", function () {
    it("applies the clicked record", async function () {
      const request: ScholarPickerRequest = {
        strings: scholarPickerStrings(),
        itemTitle: "A paper with two Scholar records",
        itemSummary: "2020 · Journal",
        pinnedTitle: null,
        results: [
          {
            title: "The Paper As Journal Article",
            count: 128,
            meta: "A. Author - Journal, 2020",
            url: "https://example.org/journal",
          },
          {
            title: "The Paper As Preprint",
            count: 31,
            meta: "A. Author - arXiv, 2019",
            url: "https://arxiv.org/abs/1901.00001",
          },
        ],
        blocked: false,
        error: "",
        searchURL: "https://scholar.google.com/scholar?q=x",
        searchAgain: async () => ({
          results: [],
          blocked: false,
          url: "",
          error: "",
        }),
        openInBrowser: () => undefined,
        result: null,
      };

      const dialog = mainWindow().openDialog?.(
        SCHOLAR_DIALOG,
        "alphalikes-scholar-picker-test",
        "chrome,centerscreen,resizable,width=820,height=640",
        request,
      );
      assert.isOk(dialog, "the Scholar picker has to open");

      const rows = await waitFor("the Scholar result rows", () => {
        const group = dialog!.document.getElementById("result-group");
        const children = group?.children ?? [];
        return children.length ? Array.from(children) : null;
      });
      assert.lengthOf(rows, 2);

      // The row shows what is being chosen: the count itself.
      assert.include((rows[0] as HTMLElement).textContent, "128");

      const firstRow = rows[0] as HTMLElement;
      click(firstRow.querySelector("description") ?? firstRow);

      const apply = dialog!.document.getElementById("apply") as HTMLElement & {
        disabled?: boolean;
      };
      assert.isFalse(apply.disabled);
      apply.dispatchEvent(
        new (dialog!.document.defaultView as Window).Event("command"),
      );

      assert.isOk(request.result);
      const result = request.result as {
        action: string;
        result: { title: string; count: number };
      };
      assert.equal(result.action, "apply");
      assert.equal(result.result.title, "The Paper As Journal Article");
      assert.equal(result.result.count, 128);
    });

    it("explains a human check instead of showing an empty list", async function () {
      const request: ScholarPickerRequest = {
        strings: scholarPickerStrings(),
        itemTitle: "A blocked paper",
        itemSummary: "",
        pinnedTitle: null,
        results: [],
        blocked: true,
        error: "",
        searchURL: "https://scholar.google.com/scholar?q=y",
        searchAgain: async () => ({
          results: [],
          blocked: true,
          url: "https://scholar.google.com/scholar?q=y",
          error: "",
        }),
        openInBrowser: () => undefined,
        result: null,
      };

      const dialog = mainWindow().openDialog?.(
        SCHOLAR_DIALOG,
        "alphalikes-scholar-picker-blocked-test",
        "chrome,centerscreen,resizable,width=820,height=640",
        request,
      );
      assert.isOk(dialog);

      const empty = await waitFor(
        "the block explanation",
        () =>
          dialog!.document.getElementById("empty-message")?.textContent ||
          "" ||
          null,
      );
      assert.isNotEmpty(empty);

      const open = dialog!.document.getElementById("open-browser");
      assert.isOk(open, "the browser link has to be offered");

      dialog!.close();
    });
  });
});
