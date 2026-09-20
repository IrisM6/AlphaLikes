import { assert } from "chai";
import {
  buildAlphaXivURL,
  extractArxivID,
  fromSortableValue,
  normalizeArxivID,
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

    it("sorts through a padded value but renders a plain number", function () {
      assert.isTrue(toSortableValue(9) < toSortableValue(100));
      assert.equal(fromSortableValue(toSortableValue(2979)), "2979");
      assert.equal(fromSortableValue("N/A"), "N/A");
    });
  });
});
