/**
 * The Scholar reading rhythm: the gap between two searches, the settle after a
 * page loads, and the pause between bursts.
 *
 * A fixed gap is a rhythm, and a rhythm is one of the things a site looking for
 * a robot looks for, so every delay is drawn from a range the user adjusts in
 * the settings pane: 16-30 s between searches, ~3 s looking at the page before
 * reading it, and 10-20 minutes away after every 2-5 searches. What these tests
 * check is that the draw really stays inside the range, that the pause is
 * counted in searches and applies to Google alone, and that the page really is
 * left alone before it is read.
 *
 * The ranges under test are milliseconds wide, not minutes: the point is the
 * shape, and a suite cannot spend twenty minutes proving a pause happened.
 */

import { assert } from "chai";
import { PacedRequester, type HttpTransport } from "../src/modules/http";
import {
  createPageLoader,
  hiddenBrowserClass,
  scrollAndSettle,
} from "../src/modules/page";
import {
  getScholarPacing,
  PREF_BRANCH,
  setPref,
  type ScholarPacing,
} from "../src/modules/prefs";

const SEARCH_URL =
  "https://scholar.google.com/scholar?hl=en&as_sdt=0,5&q=probe";

/** A pacing block with every field spelled out, most of them switched off. */
function pacing(overrides: Partial<ScholarPacing>): ScholarPacing {
  return {
    intervalMinMs: 0,
    intervalMaxMs: 0,
    dwellMs: 0,
    batchMin: 99,
    batchMax: 99,
    pauseMinMs: 0,
    pauseMaxMs: 0,
    ...overrides,
  };
}

/** A transport that answers everything and records when each call went out. */
function recordingTransport(): {
  sent: string[];
  at: number[];
  transport: HttpTransport;
} {
  const sent: string[] = [];
  const at: number[] = [];
  return {
    sent,
    at,
    transport: async (_method, url) => {
      sent.push(url);
      at.push(Date.now());
      return { status: 200, response: "<html><body>Cited by 5</body></html>" };
    },
  };
}

/** Sets preferences for the duration of `body`, then puts them back. */
async function withPrefs(
  values: Record<string, number>,
  body: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map<string, string | number | boolean>();
  for (const [name, value] of Object.entries(values)) {
    saved.set(
      name,
      Zotero.Prefs.get(`${PREF_BRANCH}.${name}`, true) as
        string | number | boolean,
    );
    setPref(name as Parameters<typeof setPref>[0], value);
  }
  try {
    await body();
  } finally {
    for (const [name, value] of saved) {
      Zotero.Prefs.set(`${PREF_BRANCH}.${name}`, value, true);
    }
  }
}

describe("the Scholar reading rhythm", function () {
  this.timeout(60_000);

  describe("the ranges the user sets", function () {
    it("reads the seconds the pane shows as milliseconds", async function () {
      await withPrefs(
        {
          scholarIntervalMinSeconds: 20,
          scholarIntervalMaxSeconds: 45,
          scholarDwellSeconds: 5,
        },
        () => {
          const result = getScholarPacing();
          assert.equal(
            result.intervalMinMs,
            20_000,
            "the pane says seconds, so 20 is twenty seconds",
          );
          assert.equal(result.intervalMaxMs, 45_000);
          assert.equal(result.dwellMs, 5_000);
        },
      );
    });

    it("keeps a range that was typed the wrong way round usable", async function () {
      await withPrefs(
        {
          scholarIntervalMinSeconds: 40,
          scholarIntervalMaxSeconds: 10,
          scholarBatchMin: 5,
          scholarBatchMax: 2,
          scholarPauseMinMinutes: 30,
          scholarPauseMaxMinutes: 5,
        },
        () => {
          const result = getScholarPacing();
          assert.equal(
            result.intervalMinMs,
            10_000,
            "a smaller number in the maximum field is the new minimum, not an error",
          );
          assert.equal(result.intervalMaxMs, 40_000);
          assert.isAtMost(result.batchMin, result.batchMax);
          assert.isAtMost(result.pauseMinMs, result.pauseMaxMs);
        },
      );
    });

    it("clamps what the fields cannot express", async function () {
      await withPrefs(
        {
          scholarIntervalMinSeconds: 0,
          scholarIntervalMaxSeconds: 99_999,
          scholarDwellSeconds: 0,
          scholarPauseMinMinutes: 0,
        },
        () => {
          const result = getScholarPacing();
          assert.equal(result.intervalMinMs, 1_000, "a floor of one second");
          assert.equal(
            result.intervalMaxMs,
            600_000,
            "a ceiling of ten minutes",
          );
          assert.equal(
            result.dwellMs,
            0,
            "zero is a choice the user is allowed to make",
          );
          assert.equal(result.pauseMinMs, 0);
        },
      );
    });
  });

  describe("the gap between two searches", function () {
    it("stays inside the range, and is not the same gap twice", async function () {
      const { at, sent, transport } = recordingTransport();
      const requester = new PacedRequester({
        timeoutMs: 5_000,
        intervalMs: 0,
        transport,
        // No browser path: the request is what is being paced.
        pageLoader: async () => ({ status: null, html: "", error: "unused" }),
        scholarPacing: pacing({ intervalMinMs: 40, intervalMaxMs: 160 }),
      });

      for (let index = 0; index < 5; index += 1) {
        await requester.requestScholarPage(`${SEARCH_URL}&start=${index}`);
      }

      assert.isAtLeast(sent.length, 5, "every search reached the transport");
      const gaps = at
        .slice(1)
        .map((time, index) => time - (at[index] as number))
        .slice(-4);

      for (const gap of gaps) {
        assert.isAtLeast(gap, 25, `a gap shorter than the range: ${gap}ms`);
        assert.isAtMost(
          gap,
          2_500,
          `a gap far past the range, which would be a stall, not pacing: ${gap}ms`,
        );
      }
      assert.isAbove(
        new Set(gaps).size,
        1,
        "identical gaps are the fixed rhythm the random draw exists to avoid",
      );
    });
  });

  describe("the pause between bursts", function () {
    it("holds the next search back once the burst is done", async function () {
      const { transport } = recordingTransport();
      const requester = new PacedRequester({
        timeoutMs: 5_000,
        intervalMs: 0,
        transport,
        pageLoader: async () => ({ status: null, html: "", error: "unused" }),
        // Two searches to a burst. The session's opening request is not one of
        // them: it is a visit to the front page, not a search.
        scholarPacing: pacing({
          batchMin: 2,
          batchMax: 2,
          pauseMinMs: 400,
          pauseMaxMs: 400,
        }),
      });

      assert.isFalse(
        requester.scholarWait().paused,
        "nothing is paused before the first read",
      );

      await requester.requestScholarPage(SEARCH_URL);
      assert.isFalse(
        requester.scholarWait().paused,
        "one search into a burst of two is not a reason to stand down",
      );

      await requester.requestScholarPage(`${SEARCH_URL}&start=1`);

      const pause = requester.scholarWait();
      assert.isTrue(
        pause.paused,
        "a finished burst has to stand down, or the rhythm is a metronome",
      );
      assert.isAtLeast(
        pause.pauseMinutes,
        1,
        "the pause is reported in whole minutes, because that is how the pane and the tooltip speak",
      );

      const startedAt = Date.now();
      await requester.requestScholarPage(`${SEARCH_URL}&start=2`);
      assert.isAtLeast(
        Date.now() - startedAt,
        350,
        "the search after a burst waits the pause out",
      );
    });

    it("leaves other sites alone while Google is being waited out", async function () {
      const { transport } = recordingTransport();
      const requester = new PacedRequester({
        timeoutMs: 5_000,
        intervalMs: 0,
        transport,
        pageLoader: async () => ({ status: null, html: "", error: "unused" }),
        scholarPacing: pacing({
          batchMin: 1,
          batchMax: 1,
          pauseMinMs: 30_000,
          pauseMaxMs: 30_000,
        }),
      });

      await requester.requestScholarPage(SEARCH_URL);
      assert.isTrue(requester.scholarWait().paused);

      const startedAt = Date.now();
      const page = await requester.requestText(
        "https://api.openalex.org/works/doi:10.1234/x",
      );
      assert.equal(page, "<html><body>Cited by 5</body></html>");
      assert.isBelow(
        Date.now() - startedAt,
        1_000,
        "a pause for Google's sake must not park the citation APIs",
      );
    });

    it("is over when its time is up", async function () {
      const { transport } = recordingTransport();
      const requester = new PacedRequester({
        timeoutMs: 5_000,
        intervalMs: 0,
        transport,
        pageLoader: async () => ({ status: null, html: "", error: "unused" }),
        scholarPacing: pacing({
          batchMin: 1,
          batchMax: 1,
          pauseMinMs: 200,
          pauseMaxMs: 200,
        }),
      });

      await requester.requestScholarPage(SEARCH_URL);
      assert.isTrue(requester.scholarWait().paused);

      await Zotero.Promise.delay(300);
      assert.isFalse(
        requester.scholarWait().paused,
        "a pause is a wait, not a state: once it is over, reading resumes",
      );
    });
  });

  describe("the settle after a page loads", function () {
    it("scrolls the page a little and waits before it is read", async function () {
      const offsets: number[] = [];
      const browser = {
        browser: {
          contentWindow: {
            scrollBy: (_x: number, y: number) => offsets.push(y),
          },
        },
      };

      const startedAt = Date.now();
      await scrollAndSettle(browser as never, 300);
      const elapsed = Date.now() - startedAt;

      assert.isAtLeast(elapsed, 250, "the page is left alone for the dwell");
      assert.isAtLeast(
        offsets.length,
        1,
        "and is scrolled on the way, the way a person reads down a result list",
      );
      assert.isAbove(offsets[0] as number, 0, "the scroll goes down the page");
    });

    it("waits for nothing when the dwell is zero", async function () {
      const offsets: number[] = [];
      const browser = {
        contentWindow: { scrollBy: (_x: number, y: number) => offsets.push(y) },
      };

      const startedAt = Date.now();
      await scrollAndSettle(browser as never, 0);

      assert.equal(offsets.length, 0, "no dwell, no scrolling");
      assert.isBelow(Date.now() - startedAt, 100);
    });

    it("is applied by the reader it belongs to, not only by the test", async function () {
      assert.isFunction(
        hiddenBrowserClass().constructor,
        `HiddenBrowser 不可用：${hiddenBrowserClass().error ?? "原因未知"}`,
      );

      // A page on this machine: the loader is real, and the URL is not Google,
      // so nothing here depends on the network.
      const path = "/tmp/alphalikes-dwell-probe.html";
      await Zotero.File.putContentsAsync(
        Zotero.File.pathToFile(path) as never,
        "<html><head><title>AlphaLikes dwell probe</title></head>" +
          "<body><div id='out'></div>" +
          "<script>document.getElementById('out').textContent = 'Cited by 42';</script>" +
          "</body></html>",
      );

      // No injected loader and no injected transport: the requester builds the
      // real page loader, and the dwell it hands it comes from the pacing the
      // user configured.
      const requester = new PacedRequester({
        timeoutMs: 8_000,
        intervalMs: 0,
        scholarPacing: pacing({ dwellMs: 400 }),
      });

      const startedAt = Date.now();
      const page = await requester.requestScholarPage(path);
      const elapsed = Date.now() - startedAt;

      assert.include(
        page.body,
        "Cited by 42",
        "the page is read, and the script in it has run",
      );
      assert.isAtLeast(
        elapsed,
        300,
        "the same reader has to dwell, or the setting only exists on paper",
      );
    });

    it("hands the real loader the dwell from the settings", async function () {
      const path = "/tmp/alphalikes-dwell-probe-loader.html";
      await Zotero.File.putContentsAsync(
        Zotero.File.pathToFile(path) as never,
        "<html><head><title>AlphaLikes dwell probe</title></head>" +
          "<body>Cited by 7</body></html>",
      );

      const loader = createPageLoader({ dwellMs: () => 250 });
      const startedAt = Date.now();
      const result = await loader(path, 8_000);

      assert.isAtLeast(
        Date.now() - startedAt,
        200,
        "the loader reads the page only after it has been left to settle",
      );
      assert.include(result.html, "Cited by 7");
    });
  });
});
