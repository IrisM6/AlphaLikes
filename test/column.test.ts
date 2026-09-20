import { assert } from "chai";
import { renderLikeCell } from "../src/modules/column";
import { toSortableValue, withValueDecorations } from "../src/modules/likes";
import {
  PREF_BRANCH,
  setPref,
  type LikeStyle,
  type RangeFilterMode,
} from "../src/modules/prefs";

const COLUMN = { className: "col-alphaxiv_likes" };

/** The document `renderCell` is handed by the item tree. */
function testDocument(): Document {
  const win = Zotero.getMainWindow() as unknown as
    (Window & { document: Document }) | null;
  if (!win?.document) {
    throw new Error("the Zotero main window is not available in this context");
  }
  return win.document;
}

/** Renders a cell and returns the inner element that carries the styling. */
function render(likes: number): { cell: HTMLElement; visual: HTMLElement } {
  const cell = renderLikeCell(
    toSortableValue(likes),
    COLUMN,
    testDocument(),
  ) as HTMLElement;
  const visual = cell.firstElementChild as HTMLElement;
  assert.isOk(visual, "the cell always contains an inner styled element");
  return { cell, visual };
}

function useStyle(style: LikeStyle): void {
  setPref("likeStyle", style);
}

function restore(): void {
  setPref("likeStyle", "glass");
  setPref("colorEnabled", true);
  setPref("highLikesThreshold", 100);
  setPref("lowLikesThreshold", 10);
  setPref("highLikesColor", "#1a7f37");
  setPref("lowLikesColor", "#9aa0a6");
  setPref("midLikesColor", "");
  setPref("rangeFilterEnabled", false);
  setPref("rangeFilterMode", "hide" as RangeFilterMode);
  setPref("colorMode", "threshold");
  setPref("trendHotDelta", 10);
}

describe("AlphaLikes column rendering", function () {
  before(function () {
    assert.equal(typeof PREF_BRANCH, "string");
  });

  afterEach(restore);

  describe("display styles", function () {
    it("plain style leaves the number unstyled apart from the text", function () {
      useStyle("plain");
      const { visual } = render(500);
      assert.equal(visual.textContent, "500");
      assert.equal(visual.style.borderRadius, "");
      assert.equal(visual.style.background, "");
      assert.equal(visual.style.padding, "");
    });

    it("badge style draws a rounded tinted pill", function () {
      useStyle("badge");
      const { visual } = render(500);
      assert.equal(visual.style.borderRadius, "999px");
      assert.include(visual.style.background, "color-mix");
      assert.include(visual.style.border, "1px solid");
      // The soft badge is not frosted, so it has no backdrop filter.
      assert.equal(visual.style.backdropFilter, "");
    });

    it("glass style adds the frosted highlight and blur", function () {
      useStyle("glass");
      const { visual } = render(500);
      assert.equal(visual.style.borderRadius, "999px");
      assert.include(visual.style.background, "color-mix");
      assert.include(visual.style.backdropFilter, "blur");
      assert.include(visual.style.boxShadow, "inset");
    });

    it("ring style draws a circle for short counts", function () {
      useStyle("ring");
      const { visual } = render(42);
      assert.equal(visual.style.borderRadius, "50%");
      assert.equal(visual.style.height, "22px");
      assert.equal(visual.style.display, "inline-flex");
      // 42 is short enough to stay circular.
      assert.equal(visual.style.fontSize, "");
    });

    it("ring style widens to a stadium for long counts instead of clipping", function () {
      useStyle("ring");
      const { visual } = render(123456);
      assert.equal(visual.style.borderRadius, "999px");
      assert.equal(visual.style.fontSize, "0.85em");
    });
  });

  describe("colours and filtering", function () {
    it("colours a high count with the high colour", function () {
      setPref("colorEnabled", true);
      setPref("highLikesThreshold", 100);
      setPref("highLikesColor", "#1a7f37");
      const { visual } = render(1000);
      assert.equal(visual.style.color, "rgb(26, 127, 55)");
    });

    it("colours a low count with the low colour", function () {
      setPref("colorEnabled", true);
      setPref("lowLikesThreshold", 10);
      setPref("lowLikesColor", "#9aa0a6");
      const { visual } = render(3);
      assert.equal(visual.style.color, "rgb(154, 160, 166)");
    });

    it("keeps the theme colour for the middle band when none is set", function () {
      setPref("colorEnabled", true);
      setPref("highLikesThreshold", 100);
      setPref("lowLikesThreshold", 10);
      setPref("midLikesColor", "");
      const { visual } = render(50);
      assert.equal(visual.style.color, "");
    });

    it("dims out-of-range counts in dim mode", function () {
      setPref("rangeFilterEnabled", true);
      setPref("rangeFilterMode", "dim" as RangeFilterMode);
      setPref("rangeFilterMin", 100);
      setPref("rangeFilterMax", 0);
      const { cell } = render(5);
      assert.equal(cell.style.opacity, "0.45");
    });

    it("leaves in-range counts undimmed", function () {
      setPref("rangeFilterEnabled", true);
      setPref("rangeFilterMode", "dim" as RangeFilterMode);
      setPref("rangeFilterMin", 100);
      const { cell } = render(500);
      assert.notEqual(cell.style.opacity, "0.45");
    });

    it("ignores colours entirely when colouring is switched off", function () {
      setPref("colorEnabled", false);
      useStyle("glass");
      const { visual } = render(1000);
      assert.equal(visual.style.color, "");
      // The structure of the chosen style still applies.
      assert.equal(visual.style.borderRadius, "999px");
    });
  });

  describe("status markers", function () {
    it("renders a status marker without treating it as a count", function () {
      const cell = renderLikeCell("…", COLUMN, testDocument()) as HTMLElement;
      const visual = cell.firstElementChild as HTMLElement;
      assert.equal(visual.textContent, "…");
      assert.equal(visual.style.color, "");
    });
  });

  describe("trend decoration", function () {
    /** A count plus the decoded day-over-day change. */
    function renderTrend(
      likes: number,
      delta: number,
    ): {
      cell: HTMLElement;
      visual: HTMLElement;
      suffix: HTMLElement | null;
    } {
      const cell = renderLikeCell(
        withValueDecorations(toSortableValue(likes), [delta]),
        COLUMN,
        testDocument(),
      ) as HTMLElement;
      return {
        cell,
        visual: cell.children[0] as HTMLElement,
        suffix: (cell.children[1] as HTMLElement) ?? null,
      };
    }

    it("shows the change next to the count", function () {
      setPref("colorEnabled", false);
      const { visual, suffix } = renderTrend(2979, 12);

      assert.equal(visual.textContent, "2979");
      assert.equal(suffix?.textContent, "↑12");
      assert.equal(suffix?.style.fontSize, "0.85em");
    });

    it("marks a fall with a downward arrow", function () {
      setPref("colorEnabled", false);
      assert.equal(renderTrend(2979, -3).suffix?.textContent, "↓3");
      assert.equal(renderTrend(2979, 0).suffix?.textContent, "→0");
    });

    it("highlights growth at or above the hot threshold", function () {
      setPref("colorEnabled", true);
      setPref("trendHotDelta", 10);

      const hot = renderTrend(2979, 12);
      assert.equal(hot.suffix?.style.color, "rgb(26, 127, 55)");
      assert.include(hot.suffix?.title ?? "", "12");

      const cool = renderTrend(2979, 4);
      assert.equal(cool.suffix?.style.color, "");
    });

    it("does not colour a hot suffix when colouring is off", function () {
      setPref("colorEnabled", false);
      const { suffix } = renderTrend(2979, 50);
      assert.equal(suffix?.style.color, "");
      // The arrow itself still shows; only the accent is dropped.
      assert.equal(suffix?.textContent, "↑50");
    });

    it("renders an undecorated count without a suffix", function () {
      const cell = renderLikeCell(
        toSortableValue(2979),
        COLUMN,
        testDocument(),
      ) as HTMLElement;
      assert.lengthOf(cell.children, 1);
    });
  });
});
