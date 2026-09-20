import { assert } from "chai";
import {
  MIN_QUANTILE_SAMPLE,
  percentile,
  quantileThresholds,
} from "../src/modules/quantile";

describe("AlphaLikes quantile colouring", function () {
  describe("percentile", function () {
    it("interpolates between neighbours", function () {
      assert.equal(percentile([0, 10, 20, 30, 40], 50), 20);
      assert.equal(percentile([0, 10, 20, 30, 40], 25), 10);
      assert.equal(percentile([0, 10, 20, 30, 40], 12.5), 5);
    });

    it("returns the ends for 0 and 100", function () {
      assert.equal(percentile([3, 1, 2], 0), 1);
      assert.equal(percentile([3, 1, 2], 100), 3);
    });

    it("handles a single value and an empty list", function () {
      assert.equal(percentile([7], 90), 7);
      assert.isNull(percentile([], 50));
    });

    it("ignores values that are not finite numbers", function () {
      assert.equal(percentile([1, Number.NaN, 3], 100), 3);
    });
  });

  describe("thresholds", function () {
    it("derives cut-offs from the loaded like counts", function () {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const thresholds = quantileThresholds(values, 40, 80);

      // 40th percentile of 1..10 is 4.6 -> floored, 80th is 8.2 -> ceiled.
      assert.equal(thresholds?.low, 4);
      assert.equal(thresholds?.high, 9);
      assert.equal(thresholds?.sampleSize, 10);
    });

    it("refuses to rank a sample that is too small", function () {
      const values = Array.from(
        { length: MIN_QUANTILE_SAMPLE - 1 },
        (_, i) => i,
      );
      assert.isNull(quantileThresholds(values, 40, 80));
    });

    it("refuses a degenerate sample so the column cannot go one colour", function () {
      assert.isNull(quantileThresholds([5, 5, 5, 5, 5, 5], 40, 80));
    });

    it("drops negative and non-numeric values", function () {
      const thresholds = quantileThresholds(
        [-5, Number.NaN, 1, 2, 3, 4, 5, 6, 7, 8],
        40,
        80,
      );
      assert.equal(thresholds?.sampleSize, 8);
    });

    it("keeps the high cut-off above the low one", function () {
      const thresholds = quantileThresholds(
        [1, 1, 1, 2, 2, 2, 3, 3, 3, 100],
        40,
        80,
      );
      assert.isNotNull(thresholds);
      assert.isAbove(thresholds!.high, thresholds!.low);
    });
  });
});
