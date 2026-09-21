/**
 * Tests for the settings that decide *what* the columns look like.
 *
 * Two rounds of user reports live here:
 *
 *   - citation counts may come from one source (strict) or several (the
 *     largest of them), and an install that chose a source in 1.6.0 keeps it;
 *   - the Citations column can either follow the likes appearance or have its
 *     own style, colours and range filter, because citation counts and like
 *     counts rarely live on the same scale.
 */

import { assert } from "chai";
import { renderCitationCell } from "../src/modules/column";
import {
  PREF_DEFAULTS,
  getCitationAppearance,
  getCitationSourcePreferences,
  parseCitationSourceList,
  setPref,
  type LikeStyle,
} from "../src/modules/prefs";
import {
  CELL_LOADING,
  toSortableValue,
  withValueDecorations,
} from "../src/modules/likes";

const CITATION_COLUMN = { className: "col-alphaxiv_citations" };

function testDocument(): Document {
  const win = Zotero.getMainWindow() as unknown as
    (Window & { document: Document }) | null;
  if (!win?.document) {
    throw new Error("the Zotero main window is not available in this context");
  }
  return win.document;
}

function renderCitations(count: number, decorations: string[] = []) {
  return renderCitationCell(
    withValueDecorations(toSortableValue(count), decorations),
    CITATION_COLUMN,
    testDocument(),
  ) as HTMLElement;
}

/** Puts every preference this file touches back to its built-in default. */
function restore(): void {
  setPref("citationSourcePreferences", "googleScholar");
  setPref("citationSourcePreference", "googleScholar");
  setPref("appearanceLinked", true);
  setPref("likeStyle", "badge");
  setPref("colorEnabled", true);
  setPref("highLikesThreshold", 100);
  setPref("lowLikesThreshold", 10);
  setPref("highLikesColor", "#1a7f37");
  setPref("lowLikesColor", "#9aa0a6");
  setPref("midLikesColor", "");
  setPref("rangeFilterEnabled", false);
  setPref("citationStyle", "badge");
  setPref("citationColorEnabled", true);
  setPref("citationHighLikesThreshold", 100);
  setPref("citationLowLikesThreshold", 10);
  setPref("citationHighLikesColor", "#1a7f37");
  setPref("citationLowLikesColor", "#9aa0a6");
  setPref("citationMidLikesColor", "");
  setPref("citationRangeFilterEnabled", false);
  setPref("citationRangeFilterMin", 0);
  setPref("citationRangeFilterMax", 0);
}

describe("AlphaLikes preferences", function () {
  beforeEach(restore);

  after(restore);

  describe("the citation source list", function () {
    it("parses a comma-separated list in canonical order", function () {
      assert.deepEqual(parseCitationSourceList("openAlex,googleScholar"), [
        "googleScholar",
        "openAlex",
      ]);
      assert.deepEqual(
        parseCitationSourceList(" semanticScholar , , openAlex "),
        ["openAlex", "semanticScholar"],
      );
    });

    it("drops anything that is not a provider", function () {
      assert.deepEqual(parseCitationSourceList("auto"), []);
      assert.deepEqual(parseCitationSourceList(""), []);
      assert.deepEqual(parseCitationSourceList("openAlex,whatever"), [
        "openAlex",
      ]);
    });

    it("reads the stored selection", function () {
      setPref("citationSourcePreferences", "googleScholar,openAlex");
      assert.deepEqual(getCitationSourcePreferences(), [
        "googleScholar",
        "openAlex",
      ]);

      setPref("citationSourcePreferences", "openAlex");
      assert.deepEqual(getCitationSourcePreferences(), ["openAlex"]);
    });

    it("keeps the source an older version stored", function () {
      // Upgrading from 1.6.0 must not silently move a user off their source.
      setPref("citationSourcePreferences", "");
      setPref("citationSourcePreference", "semanticScholar");

      assert.deepEqual(getCitationSourcePreferences(), ["semanticScholar"]);
    });

    it("falls back to Google Scholar for anything unusable", function () {
      setPref("citationSourcePreferences", "");
      setPref("citationSourcePreference", "auto");
      assert.deepEqual(getCitationSourcePreferences(), ["googleScholar"]);

      assert.deepEqual(PREF_DEFAULTS.citationSourcePreferences.split(","), [
        "googleScholar",
      ]);
    });
  });

  describe("the citation appearance", function () {
    it("follows the likes settings while linked", function () {
      setPref("appearanceLinked", true);
      setPref("likeStyle", "morandi");
      setPref("colorEnabled", true);
      setPref("highLikesThreshold", 250);
      setPref("highLikesColor", "#123456");
      setPref("rangeFilterEnabled", true);
      setPref("rangeFilterMin", 5);

      // Citation-only values that must be ignored while linked.
      setPref("citationStyle", "dot");
      setPref("citationHighLikesThreshold", 1);
      setPref("citationHighLikesColor", "#000000");

      const appearance = getCitationAppearance();
      assert.isTrue(appearance.linked);
      assert.equal(appearance.style, "morandi");
      assert.equal(appearance.highThreshold, 250);
      assert.equal(appearance.high, "#123456");
      assert.isTrue(appearance.filter.enabled);
      assert.equal(appearance.filter.min, 5);
    });

    it("uses its own values once unlinked", function () {
      setPref("appearanceLinked", false);
      setPref("citationStyle", "dot");
      setPref("citationColorEnabled", true);
      setPref("citationHighLikesThreshold", 1000);
      setPref("citationLowLikesThreshold", 100);
      setPref("citationHighLikesColor", "#b45309");
      setPref("citationLowLikesColor", "#9aa0a6");
      setPref("citationRangeFilterEnabled", true);
      setPref("citationRangeFilterMin", 50);
      setPref("citationRangeFilterMax", 5000);

      const appearance = getCitationAppearance();
      assert.isFalse(appearance.linked);
      assert.equal(appearance.style, "dot");
      assert.equal(appearance.highThreshold, 1000);
      assert.equal(appearance.lowThreshold, 100);
      assert.equal(appearance.high, "#b45309");
      assert.deepEqual(appearance.filter, {
        enabled: true,
        min: 50,
        max: 5000,
      });
    });

    it("keeps the cut-offs in order", function () {
      setPref("appearanceLinked", false);
      setPref("citationHighLikesThreshold", 10);
      setPref("citationLowLikesThreshold", 900);

      const appearance = getCitationAppearance();
      assert.equal(appearance.highThreshold, 10);
      assert.equal(appearance.lowThreshold, 10);
    });

    it("maps a retired style the same way the likes column does", function () {
      setPref("appearanceLinked", false);
      setPref("citationStyle", "glass");
      assert.equal(getCitationAppearance().style, "badge");

      setPref("citationStyle", "nonsense");
      assert.equal(getCitationAppearance().style, "badge");
    });

    it("draws the column with its own style when unlinked", function () {
      setPref("appearanceLinked", false);
      setPref("citationStyle", "dot" as LikeStyle);

      const cell = renderCitations(42);
      const visual = cell.firstElementChild as HTMLElement;
      assert.equal(visibleText(visual), "42");
      // `dot` is the rounded badge, so a circle for a two-digit count.
      assert.equal(visual.style.borderRadius, "50%");
    });

    it("dims an out-of-range citation row when its own filter is on", function () {
      setPref("appearanceLinked", false);
      setPref("citationRangeFilterEnabled", true);
      setPref("citationRangeFilterMin", 100);
      setPref("likeStyle", "badge");
      setPref("citationStyle", "badge");

      const below = renderCitations(3);
      assert.equal(below.style.opacity, "0.45");
      assert.isNotEmpty(below.title, "the dimmed cell explains itself");

      const within = renderCitations(150);
      assert.equal(within.style.opacity, "");
    });

    it("ignores the like filter while the appearance is linked to it", function () {
      setPref("appearanceLinked", true);
      setPref("rangeFilterEnabled", true);
      setPref("rangeFilterMin", 100);
      // Linked means both columns behave the same, so the citation row is
      // dimmed by the like filter too.
      assert.equal(renderCitations(3).style.opacity, "0.45");
      assert.equal(renderCitations(500).style.opacity, "");
    });

    it("leaves a loading cell alone", function () {
      setPref("appearanceLinked", false);
      setPref("citationRangeFilterEnabled", true);
      setPref("citationRangeFilterMin", 1000);

      const cell = renderCitationCell(
        CELL_LOADING,
        CITATION_COLUMN,
        testDocument(),
      ) as HTMLElement;

      assert.equal(cell.style.opacity, "");
      assert.isNotEmpty(cell.title);
    });
  });
});

/** The text of a cell and its nested halves, for the split styles. */
function visibleText(node: HTMLElement): string {
  const own = Array.from(node.childNodes)
    .filter((child) => child.nodeType === 3)
    .map((child) => child.textContent ?? "")
    .join("");
  const nested = Array.from(node.children)
    .map((child) => visibleText(child as HTMLElement))
    .join("");
  return `${own}${nested}`;
}
