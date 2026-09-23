import { assert } from "chai";
import {
  buildAlphaXivURL,
  extractArxivID,
  fromSortableValue,
  normalizeArxivID,
  parseLikesFromDocument,
  parseLikesText,
  readCachedLikes,
  toSortableValue,
  upsertCachedLikes,
} from "../src/modules/alphaxiv";

describe("AlphaLikes core logic", function () {
  describe("arXiv metadata", function () {
    it("extracts a modern ID from the URL field", function () {
      assert.equal(
        extractArxivID("https://arxiv.org/abs/2301.12345", ""),
        "2301.12345",
      );
    });

    it("extracts and normalizes IDs from Extra", function () {
      assert.equal(
        extractArxivID("", "DOI: 10.1234/example\narXiv: 2301.12345v3"),
        "2301.12345",
      );
    });

    it("supports legacy IDs and PDF URLs", function () {
      assert.equal(
        extractArxivID("https://arxiv.org/pdf/hep-th/9901001v2.pdf", ""),
        "hep-th/9901001",
      );
    });

    it("does not treat unrelated items as arXiv papers", function () {
      assert.isNull(
        extractArxivID("https://example.org/papers/2301.12345", "PMID: 123"),
      );
      assert.isNull(normalizeArxivID("not-an-id"));
    });

    it("constructs the canonical alphaXiv page URL", function () {
      assert.equal(
        buildAlphaXivURL("hep-th/9901001"),
        "https://www.alphaxiv.org/abs/hep-th/9901001",
      );
    });
  });

  describe("likes cache", function () {
    it("reads a persisted value, including zero", function () {
      assert.equal(readCachedLikes("alphaxiv_likes: 2,979"), 2979);
      assert.equal(readCachedLikes("alphaxiv_likes: 0"), 0);
    });

    it("adds or replaces only the AlphaLikes cache line", function () {
      assert.equal(
        upsertCachedLikes("arXiv: 2301.12345", 2979),
        "arXiv: 2301.12345\nalphaxiv_likes: 2979",
      );
      assert.equal(
        upsertCachedLikes("alphaxiv_likes: N/A\nDOI: 10.1/test", 42),
        "alphaxiv_likes: 42\nDOI: 10.1/test",
      );
    });
  });

  describe("likes parsing and sorting", function () {
    it("parses formatted and abbreviated values", function () {
      assert.equal(parseLikesText("2,979"), 2979);
      assert.equal(parseLikesText("1.2K"), 1200);
      assert.equal(parseLikesText("Likes: 87"), 87);
      assert.isNull(parseLikesText("N/A"));
    });

    /**
     * The page alphaXiv serves for a paper nobody has liked yet.
     *
     * Verified against the live site: `2312.00001` and `2312.00002` come back
     * with the like button and its thumb icon and no number anywhere on the
     * page, while every paper with a like has a `span.inline-block` holding it.
     * The count is zero; it is not a page that failed to load.
     */
    function alphaXivDocument(inner: string): Document {
      const win = Zotero.getMainWindow() as unknown as Window;
      const html = `<html><body>${inner}</body></html>`;
      return new win.DOMParser().parseFromString(html, "text/html");
    }

    const THUMB = '<svg aria-hidden="true"></svg>';

    it("reads a paper with no likes as zero, not as a failed read", function () {
      // Reported: a paper with 0 likes came back as 「未能读取（保留原值，约 5
      // 分钟后自动重试）」. The page had loaded and said zero - the site simply
      // omits the number - so reporting a failure sent the user off to wait
      // five minutes for a number that was already on the page.
      assert.equal(
        parseLikesFromDocument(
          alphaXivDocument(
            `<button aria-label="Like this paper">${THUMB}</button>`,
          ),
        ),
        0,
        "a button with no number is alphaXiv writing zero",
      );

      // A number that really is zero is read as zero as well, whichever markup
      // the site uses for it.
      assert.equal(
        parseLikesFromDocument(
          alphaXivDocument(
            `<button aria-label="Like this paper">${THUMB}` +
              `<span class="inline-block">0</span></button>`,
          ),
        ),
        0,
      );
    });

    it("still fails when the page is not a paper view at all", function () {
      // The other half of the rule: no like control means the read failed -
      // the markup moved, or this is not a paper page - and a wrong zero would
      // be worse than an honest failure.
      assert.isNull(
        parseLikesFromDocument(
          alphaXivDocument("<main>This paper could not be found</main>"),
        ),
      );
      assert.isNull(
        parseLikesFromDocument(
          alphaXivDocument(`<button aria-label="Share">${THUMB}</button>`),
        ),
      );
    });

    it("sorts through a padded value but renders a plain number", function () {
      assert.isTrue(toSortableValue(9) < toSortableValue(100));
      assert.equal(fromSortableValue(toSortableValue(2979)), "2979");
      assert.equal(fromSortableValue("N/A"), "N/A");
    });
  });
});
