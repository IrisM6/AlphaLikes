import { assert } from "chai";
import {
  HISTORY_KEY,
  HISTORY_MAX_ENTRIES,
  fromDateKey,
  latestTrend,
  parseLikesHistory,
  readLikesHistory,
  recordLikesSnapshot,
  toDateKey,
  trendOverDays,
} from "../src/modules/history";

const OTHER_EXTRA = "arXiv: 2301.12345\nPublisher: ACM";

describe("AlphaLikes like history", function () {
  describe("date keys", function () {
    it("round-trips a local calendar day", function () {
      const day = new Date(2026, 8, 20);
      assert.equal(toDateKey(day), "2026-09-20");
      assert.equal(fromDateKey("2026-09-20")?.getDate(), 20);
    });

    it("pads single digit months and days", function () {
      assert.equal(toDateKey(new Date(2026, 0, 5)), "2026-01-05");
    });

    it("rejects values that are not dates", function () {
      assert.isNull(fromDateKey("2026-13-01"));
      assert.isNull(fromDateKey("yesterday"));
      assert.isNull(fromDateKey(""));
    });
  });

  describe("parsing", function () {
    it("reads snapshots newest first", function () {
      const snapshots = parseLikesHistory(
        `${HISTORY_KEY}: 2026-09-18:2967;2026-09-20:2979;2026-09-19:2970`,
      );

      assert.deepEqual(snapshots, [
        { date: "2026-09-20", likes: 2979 },
        { date: "2026-09-19", likes: 2970 },
        { date: "2026-09-18", likes: 2967 },
      ]);
    });

    it("finds the line among other Extra fields", function () {
      const extra = `${OTHER_EXTRA}\nalphaxiv_likes: 2979\n${HISTORY_KEY}: 2026-09-20:2979`;
      assert.lengthOf(readLikesHistory(extra), 1);
    });

    it("keeps the latest value when a day repeats", function () {
      const snapshots = parseLikesHistory(
        `${HISTORY_KEY}: 2026-09-20:1;2026-09-20:9`,
      );
      assert.deepEqual(snapshots, [{ date: "2026-09-20", likes: 9 }]);
    });

    it("skips malformed entries instead of throwing", function () {
      const snapshots = parseLikesHistory(
        `${HISTORY_KEY}: nonsense;2026-09-20:12;:5;2026-09-19:-1`,
      );
      assert.deepEqual(snapshots, [{ date: "2026-09-20", likes: 12 }]);
    });

    it("returns an empty list when the line is absent", function () {
      assert.deepEqual(readLikesHistory(OTHER_EXTRA), []);
      assert.deepEqual(readLikesHistory(""), []);
    });
  });

  describe("recording", function () {
    it("appends today's snapshot to other Extra data", function () {
      const next = recordLikesSnapshot(
        OTHER_EXTRA,
        2979,
        new Date(2026, 8, 20, 10, 30),
      );

      assert.include(next, OTHER_EXTRA);
      assert.include(next, `${HISTORY_KEY}: 2026-09-20:2979`);
    });

    it("replaces the entry for the same day", function () {
      const first = recordLikesSnapshot(
        OTHER_EXTRA,
        2979,
        new Date(2026, 8, 20, 9),
      );
      const second = recordLikesSnapshot(
        first,
        2985,
        new Date(2026, 8, 20, 21),
      );

      assert.notInclude(second, "2979");
      assert.include(second, "2026-09-20:2985");
      assert.lengthOf(readLikesHistory(second), 1);
    });

    it("returns the input unchanged when the same value is recorded twice", function () {
      const once = recordLikesSnapshot(OTHER_EXTRA, 12, new Date(2026, 8, 20));
      const twice = recordLikesSnapshot(once, 12, new Date(2026, 8, 20));
      assert.strictEqual(twice, once);
    });

    it("caps the history so Extra cannot grow without bound", function () {
      let extra = "";
      for (let day = 1; day <= 20; day += 1) {
        extra = recordLikesSnapshot(extra, day * 10, new Date(2026, 8, day));
      }

      const snapshots = readLikesHistory(extra);
      assert.lengthOf(snapshots, HISTORY_MAX_ENTRIES);
      assert.equal(snapshots[0].date, "2026-09-20");
      assert.equal(snapshots[HISTORY_MAX_ENTRIES - 1].date, "2026-09-14");
      assert.notInclude(extra, "2026-09-13");
    });

    it("honours a custom cap", function () {
      let extra = "";
      for (let day = 1; day <= 6; day += 1) {
        extra = recordLikesSnapshot(extra, day, new Date(2026, 8, day), 3);
      }
      assert.lengthOf(readLikesHistory(extra), 3);
    });

    it("ignores values that are not counts", function () {
      assert.strictEqual(
        recordLikesSnapshot(OTHER_EXTRA, Number.NaN),
        OTHER_EXTRA,
      );
      assert.strictEqual(recordLikesSnapshot(OTHER_EXTRA, -1), OTHER_EXTRA);
    });

    it("writes only the history line into empty Extra", function () {
      const extra = recordLikesSnapshot("", 5, new Date(2026, 8, 20));
      assert.equal(extra, `${HISTORY_KEY}: 2026-09-20:5`);
    });
  });

  describe("deltas", function () {
    it("measures the day-over-day change", function () {
      const trend = latestTrend([
        { date: "2026-09-20", likes: 2979 },
        { date: "2026-09-19", likes: 2967 },
      ]);

      assert.deepEqual(trend, {
        delta: 12,
        fromDate: "2026-09-19",
        toDate: "2026-09-20",
        days: 1,
      });
    });

    it("reports a fall as a negative delta", function () {
      const trend = latestTrend([
        { date: "2026-09-20", likes: 10 },
        { date: "2026-09-19", likes: 14 },
      ]);
      assert.equal(trend?.delta, -4);
    });

    it("needs two snapshots", function () {
      assert.isNull(latestTrend([]));
      assert.isNull(latestTrend([{ date: "2026-09-20", likes: 1 }]));
    });

    it("measures a longer window against the requested age", function () {
      const snapshots = [
        { date: "2026-09-20", likes: 3000 },
        { date: "2026-09-19", likes: 2990 },
        { date: "2026-09-14", likes: 2900 },
      ];

      const week = trendOverDays(snapshots, 7, new Date(2026, 8, 20));
      assert.equal(week?.delta, 100);
      assert.equal(week?.fromDate, "2026-09-14");
      assert.equal(week?.days, 6);
    });

    it("reports the span it actually has when the history is short", function () {
      const snapshots = [
        { date: "2026-09-20", likes: 3000 },
        { date: "2026-09-19", likes: 2990 },
      ];
      const short = trendOverDays(snapshots, 7, new Date(2026, 8, 20));

      // The 7-day window is a ceiling: a two-day history must not be dressed
      // up as a week, so the caller is told the delta covers one day.
      assert.equal(short?.days, 1);
      assert.equal(short?.delta, 10);
    });

    it("measures from the newest snapshot when asked for a day", function () {
      const snapshots = [
        { date: "2026-09-20", likes: 3000 },
        { date: "2026-09-19", likes: 2990 },
        { date: "2026-09-18", likes: 2950 },
      ];
      const day = trendOverDays(snapshots, 1, new Date(2026, 8, 20));
      assert.equal(day?.delta, 10);
      assert.equal(day?.fromDate, "2026-09-19");
    });
  });
});
