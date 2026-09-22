/**
 * What the user is told when a read fails.
 *
 * "读取失败" on its own reads as "this is broken, and it is on you": it says
 * nothing about what happened, and nothing about the fact that the plugin will
 * try again by itself in a few minutes. The wait is the part the user acts on -
 * either they wait, or they do something else - so it travels with the failure
 * and is spelled out in the two places a failure is reported: the cell's
 * tooltip and the refresh summary.
 */

import { assert } from "chai";
import { refreshSummaryText } from "../src/modules/menu";
import type { RefreshSummary } from "../src/modules/service";

function summary(overrides: Partial<RefreshSummary>): RefreshSummary {
  return {
    total: 3,
    updated: 2,
    failed: 0,
    skipped: 0,
    ...overrides,
  } as RefreshSummary;
}

/** The retry promise, in whichever language the run is using. */
const RETRY_WORDING = /重试|retry/i;

describe("the notice a failed read leaves behind", function () {
  it("names the wait next to the failure in the refresh summary", function () {
    const text = refreshSummaryText(
      summary({ failed: 1, retryMinutes: 12 }),
      "2",
    );

    assert.include(text, "1", "the failure is still counted");
    assert.match(text, RETRY_WORDING);
    assert.include(
      text,
      "12",
      "the number of minutes is the part the user can act on",
    );
  });

  it("keeps the plain sentence when a failure booked no time of its own", function () {
    const text = refreshSummaryText(summary({ failed: 2 }), "1");

    assert.include(text, "2");
    assert.notMatch(
      text,
      /\d+\s*(分钟|minutes)/,
      "a wait that was never booked must not be invented",
    );
  });

  it("says nothing about retries when nothing failed", function () {
    const text = refreshSummaryText(summary({}), "3");

    assert.notMatch(text, RETRY_WORDING);
  });
});
