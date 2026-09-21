import { assert } from "chai";
import { renderCitationCell, renderLikeCell } from "../src/modules/column";
import { getLikeStyle } from "../src/modules/prefs";
import { toSortableValue, withValueDecorations } from "../src/modules/likes";
import {
  LIKE_STYLES,
  PREF_BRANCH,
  setPref,
  type LikeStyle,
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
  setPref("likeStyle", "badge");
  setPref("colorEnabled", true);
  setPref("highLikesThreshold", 100);
  setPref("lowLikesThreshold", 10);
  setPref("highLikesColor", "#1a7f37");
  setPref("lowLikesColor", "#9aa0a6");
  setPref("midLikesColor", "");
  setPref("rangeFilterEnabled", false);
  setPref("colorMode", "threshold");
  setPref("trendHotDelta", 10);
  setPref("useGoogleScholar", true);
  setPref("citationSourcePreference", "auto");
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

    it("no style asks for a backdrop filter", function () {
      for (const style of LIKE_STYLES) {
        useStyle(style);
        const { visual } = render(500);
        assert.equal(
          visual.style.backdropFilter,
          "",
          `${style} should not frost the backdrop`,
        );
      }
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

    it("dims out-of-range counts instead of hiding them", function () {
      setPref("rangeFilterEnabled", true);
      setPref("rangeFilterMin", 100);
      setPref("rangeFilterMax", 0);
      const { cell, visual } = render(5);
      assert.equal(cell.style.opacity, "0.45");
      // The count stays readable: that is the point of dimming over hiding.
      assert.equal(visual.textContent, "5");
    });

    it("leaves in-range counts undimmed", function () {
      setPref("rangeFilterEnabled", true);
      setPref("rangeFilterMin", 100);
      const { cell } = render(500);
      assert.notEqual(cell.style.opacity, "0.45");
    });

    it("ignores colours entirely when colouring is switched off", function () {
      setPref("colorEnabled", false);
      useStyle("badge");
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

  describe("appearance styles", function () {
    /** Renders a high count and returns the styled element. */
    function high(style: LikeStyle): HTMLElement {
      setPref("colorEnabled", true);
      setPref("highLikesThreshold", 100);
      setPref("highLikesColor", "#1a7f37");
      setPref("lowLikesThreshold", 10);
      useStyle(style);
      const cell = renderLikeCell(
        toSortableValue(1000),
        COLUMN,
        testDocument(),
      ) as HTMLElement;
      return cell.firstElementChild as HTMLElement;
    }

    it("bookmark paints a cream fill with an accent left edge", function () {
      const visual = high("bookmark");
      assert.equal(visual.style.background, "rgb(253, 249, 232)");
      assert.equal(visual.style.color, "rgb(166, 124, 0)");
      assert.include(visual.style.borderLeftWidth, "3px");
    });

    it("morandi separates its three bands", function () {
      const fills = (["high", "mid", "low"] as const).map((band) => {
        setPref("highLikesThreshold", 100);
        setPref("lowLikesThreshold", 10);
        useStyle("morandi");
        const likes = band === "high" ? 1000 : band === "low" ? 3 : 50;
        const cell = renderLikeCell(
          toSortableValue(likes),
          COLUMN,
          testDocument(),
        ) as HTMLElement;
        return cell.firstElementChild as HTMLElement;
      });

      assert.equal(fills[0].style.background, "rgb(159, 179, 191)");
      assert.equal(fills[1].style.background, "rgb(220, 211, 201)");
      assert.equal(fills[2].style.background, "rgb(241, 241, 239)");
      // Three distinct fills, not three near-identical greys.
      assert.equal(new Set(fills.map((v) => v.style.background)).size, 3);
      assert.equal(fills[0].style.borderRadius, "999px");
    });

    it("academic inverts to a solid navy for high counts", function () {
      const visual = high("academic");
      assert.equal(visual.style.background, "rgb(0, 51, 102)");
      assert.equal(visual.style.color, "rgb(255, 255, 255)");
      assert.equal(visual.style.borderRadius, "3px");
    });

    it("fresh paints a mint fill", function () {
      const visual = high("fresh");
      assert.equal(visual.style.background, "rgb(230, 247, 240)");
      assert.equal(visual.style.color, "rgb(46, 139, 87)");
      // The DOM normalises the shadow by putting the colour first.
      assert.include(visual.style.boxShadow, "2px 4px");
      assert.include(visual.style.boxShadow, "0.05");
    });

    it("playful pairs yellow with a hard shadow", function () {
      const visual = high("playful");
      assert.equal(visual.style.background, "rgb(255, 215, 0)");
      assert.equal(visual.style.color, "rgb(0, 0, 0)");
      assert.include(visual.style.boxShadow, "2px 2px 0");
    });

    it("outline draws a hairline around a transparent fill", function () {
      const visual = high("outline");
      assert.equal(visual.style.background, "transparent");
      assert.include(visual.style.border, "1px solid");
    });

    it("split shows a label half and a number half", function () {
      const visual = high("split");
      assert.equal(visual.style.display, "inline-flex");
      const halves = visual.children;
      assert.lengthOf(halves, 2);
      assert.equal((halves[1] as HTMLElement).textContent, "1000");
      assert.equal(
        (halves[0] as HTMLElement).style.color,
        "rgb(255, 255, 255)",
      );
      assert.equal((halves[1] as HTMLElement).style.color, "rgb(51, 51, 51)");
    });

    it("maps a style that was removed onto its closest survivor", function () {
      // Someone who chose 纯文本极简 / 玻璃胶囊 / 典雅精致 keeps an equivalent
      // look after upgrading instead of being reset to the default.
      const cases: Array<[string, string]> = [
        ["minimal", "plain"],
        ["glass", "badge"],
        ["elegant", "academic"],
      ];

      for (const [retired, expected] of cases) {
        setPref("likeStyle", retired);
        assert.equal(
          getLikeStyle(),
          expected,
          `${retired} should read as ${expected}`,
        );
      }

      // A value that never existed still lands on the default.
      setPref("likeStyle", "not-a-style");
      assert.equal(getLikeStyle(), "badge");
    });

    it("dot prints a long number in full", function () {
      setPref("colorEnabled", true);
      useStyle("dot");
      const cell = renderLikeCell(
        toSortableValue(1234),
        COLUMN,
        testDocument(),
      ) as HTMLElement;
      const visual = cell.firstElementChild as HTMLElement;
      assert.equal(visual.textContent, "1234");
      // Four digits no longer fit a circle, so the badge becomes a stadium.
      assert.equal(visual.style.borderRadius, "999px");
      assert.equal(cell.title, "");
    });

    it("dot keeps a short number as a circle", function () {
      setPref("colorEnabled", true);
      useStyle("dot");
      const cell = renderLikeCell(
        toSortableValue(42),
        COLUMN,
        testDocument(),
      ) as HTMLElement;
      const visual = cell.firstElementChild as HTMLElement;
      assert.equal(visual.textContent, "42");
      assert.equal(visual.style.borderRadius, "50%");
    });

    it("palette styles fall back to their middle band when colouring is off", function () {
      setPref("colorEnabled", false);
      useStyle("morandi");
      const cell = renderLikeCell(
        toSortableValue(1000),
        COLUMN,
        testDocument(),
      ) as HTMLElement;
      const visual = cell.firstElementChild as HTMLElement;
      // The muted band, not the "high" one. Both halves of the band move
      // together, so the fill and the text are checked against the same band.
      assert.equal(visual.style.background, "rgb(220, 211, 201)");
      assert.equal(visual.style.color, "rgb(74, 66, 59)");
    });
  });

  describe("citation cells", function () {
    const CITATION_COLUMN = { className: "col-alphaxiv_citations" };

    function renderCitations(
      count: number,
      decorations: string[] = [],
    ): HTMLElement {
      return renderCitationCell(
        withValueDecorations(toSortableValue(count), decorations),
        CITATION_COLUMN,
        testDocument(),
      ) as HTMLElement;
    }

    it("shows the count and no marker for an ordinary work", function () {
      const cell = renderCitations(500);
      const visual = cell.firstElementChild as HTMLElement;
      assert.equal(visual.textContent, "500");
      assert.lengthOf(cell.children, 1);
    });

    it("marks a top-decile work and names the source", function () {
      const cell = renderCitations(7608, ["1", "openAlex"]);
      assert.lengthOf(cell.children, 2);
      assert.include(cell.title, "OpenAlex");
    });

    it("names Google Scholar when it supplied the number", function () {
      const cell = renderCitations(8012, ["googleScholar"]);
      assert.include(cell.title, "Google Scholar");
    });

    it("treats a high-impact work as the style's high band", function () {
      setPref("colorEnabled", true);
      useStyle("academic");
      const cell = renderCitations(7608, ["1", "openAlex"]);
      const visual = cell.firstElementChild as HTMLElement;
      assert.equal(visual.style.background, "rgb(0, 51, 102)");
    });

    it("uses the middle band for a work with no percentile", function () {
      setPref("colorEnabled", true);
      useStyle("academic");
      const cell = renderCitations(12, ["openAlex"]);
      const visual = cell.firstElementChild as HTMLElement;
      assert.equal(visual.style.background, "rgb(245, 245, 245)");
    });

    it("still renders a status marker", function () {
      const cell = renderCitationCell(
        "N/A",
        CITATION_COLUMN,
        testDocument(),
      ) as HTMLElement;
      assert.equal((cell.firstElementChild as HTMLElement).textContent, "N/A");
    });
  });
});
