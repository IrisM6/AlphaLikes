import { assert } from "chai";
import {
  CELL_CLEARED,
  CELL_LOADING,
  fromSortableValue,
  isStatusValue,
  splitValueDecorations,
  toSortableValue,
  withValueDecorations,
} from "../src/modules/likes";

describe("AlphaLikes cell encoding", function () {
  it("keeps like counts sortable as strings", function () {
    const small = toSortableValue(9);
    const large = toSortableValue(100);
    assert.isBelow(small.length, large.length + 1);
    assert.isTrue(small < large);
    assert.isTrue(toSortableValue(2979) < toSortableValue(3000));
  });

  it("round-trips a count through the sortable form", function () {
    assert.equal(fromSortableValue(toSortableValue(2979)), "2979");
  });

  it("splits the sort key from its decorations", function () {
    const value = withValueDecorations(toSortableValue(2979), [12]);
    assert.equal(value, `${toSortableValue(2979)}|12`);
    assert.deepEqual(splitValueDecorations(value), {
      key: toSortableValue(2979),
      decorations: ["12"],
    });
  });

  it("still sorts numerically with a decoration attached", function () {
    const lower = withValueDecorations(toSortableValue(2967), [-5]);
    const higher = withValueDecorations(toSortableValue(2979), [12]);
    assert.isTrue(lower < higher);
  });

  it("keeps decoding the display text", function () {
    const value = withValueDecorations(toSortableValue(2979), [12]);
    assert.equal(fromSortableValue(value), "2979");
  });

  it("drops empty decorations", function () {
    assert.equal(
      withValueDecorations(toSortableValue(5), []),
      toSortableValue(5),
    );
    assert.equal(
      withValueDecorations(toSortableValue(5), [null, undefined, ""]),
      toSortableValue(5),
    );
  });

  it("leaves an empty value empty, which is how the filter hides a row", function () {
    assert.equal(withValueDecorations("", [12]), "");
    assert.equal(splitValueDecorations("").key, "");
  });

  it("supports several decorations", function () {
    const value = withValueDecorations(toSortableValue(5), [1, "h"]);
    assert.deepEqual(splitValueDecorations(value).decorations, ["1", "h"]);
  });

  it("recognises the status markers with and without decorations", function () {
    assert.isTrue(isStatusValue(CELL_LOADING));
    assert.isTrue(isStatusValue(withValueDecorations(CELL_LOADING, [1])));
    assert.isTrue(
      isStatusValue(CELL_CLEARED),
      "a cleared cell is a status, not a count: it must stay out of the " +
        "percentile population and out of the range filter",
    );
    assert.isFalse(isStatusValue(toSortableValue(12)));
    assert.isFalse(
      isStatusValue(withValueDecorations(toSortableValue(12), [3])),
    );
  });

  it("passes through plain text that is not a count", function () {
    assert.equal(fromSortableValue("N/A"), "N/A");
  });
});
