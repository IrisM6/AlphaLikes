/**
 * The rules that keep Google Scholar's refusals from feeding themselves.
 *
 * Reported: a refresh of one selected entry, followed by "attempt 20" in the
 * next diagnostic and an address that stayed rate-limited for hours while the
 * user's own browser was fine. Three things were wrong, and each of them made
 * the next one worse:
 *
 * - a refresh repainted every row, and a row without a count starts a read as
 *   soon as it is asked for its value, so one refresh read the whole list;
 * - every failed read counted as an attempt, so a list's worth of refusals in
 *   one second looked like twenty retries and tripped the stop-after-four rule
 *   immediately;
 * - the reset action emptied the cookie jar but left the session thinking it
 *   had already been to Google - so the retry went out with no cookies at all
 *   and without ever loading the front page, which is the state Google is
 *   least willing to answer.
 *
 * These tests pin all three down, plus the rule that came out of them: with
 * Google Scholar selected, automatic reads happen for the items the user is
 * looking at, and nowhere else.
 */

import { assert } from "chai";
import { getService } from "../src/modules/column";
import {
  googleConsentStored,
  PacedRequester,
  type HttpTransport,
} from "../src/modules/http";
import { CELL_LOADING, CELL_UNAVAILABLE } from "../src/modules/likes";
import { setPref } from "../src/modules/prefs";
import { upsertLikesCache } from "../src/modules/arxiv-id";

interface Captured {
  url: string;
}

/** A transport that answers like a refused Scholar, and records the calls. */
function refusingTransport(captured: Captured[]): HttpTransport {
  return async (_method, url) => {
    captured.push({ url: String(url) });
    if (String(url).includes("peet.ws")) {
      return { status: 200, response: '{"tls":{"ja4":"stub"}}' };
    }
    return {
      status: 429,
      response:
        "<html><title>Sorry...</title><body>unusual traffic</body></html>",
    };
  };
}

function makeItem(suffix: string, fields: Record<string, string> = {}) {
  const created = new Zotero.Item("journalArticle");
  created.libraryID = Zotero.Libraries.userLibraryID;
  created.setField("title", `AlphaLikes scholar guard probe ${suffix}`);
  created.setField("date", "2026-09-22");
  created.setField("DOI", `10.1234/alphalikes.guard.${suffix}`);
  if (fields.extra) created.setField("extra", fields.extra);
  return created;
}

describe("AlphaLikes Scholar guardrails", function () {
  let service: ReturnType<typeof getService>;
  let item: Zotero.Item;
  let captured: Captured[];

  before(async function () {
    service = getService();
    item = makeItem("one", {
      extra: upsertLikesCache("alphaxiv_arxiv_id: 2401.00021", 7),
    });
    await item.saveTx();
    // Google Scholar alone, so the guardrail is the only source in play.
    setPref("citationSourcePreferences", "googleScholar");
    setPref("citationsEnabled", true);
  });

  after(async function () {
    try {
      await item.eraseTx();
    } catch {
      // The library may already be gone when the run tears down.
    }
  });

  function useTransport(): void {
    captured = [];
    service.setReadTransport(refusingTransport(captured));
    // These tests send several Scholar reads in a row; production spaces them
    // out (and pauses between bursts) on purpose.
    const options = (
      service as unknown as {
        requester: {
          options: {
            intervalMs: number;
            scholarPacing?: {
              intervalMinMs: number;
              intervalMaxMs: number;
              dwellMinMs: number;
              dwellMaxMs: number;
              batchMin: number;
              batchMax: number;
              pauseMinMs: number;
              pauseMaxMs: number;
            };
          };
        };
      }
    ).requester.options;
    options.intervalMs = 0;
    options.scholarPacing = {
      intervalMinMs: 0,
      intervalMaxMs: 0,
      dwellMinMs: 0,
      dwellMaxMs: 0,
      batchMin: 1,
      batchMax: 1,
      pauseMinMs: 0,
      pauseMaxMs: 0,
    };
  }

  describe("counting a block", function () {
    it("counts a round of refusals as one attempt, not one per item", async function () {
      useTransport();
      const extras: Zotero.Item[] = [Zotero.Items.get(item.id)];
      for (const suffix of ["two", "three"]) {
        const extra = makeItem(suffix);
        await extra.saveTx();
        extras.push(Zotero.Items.get(extra.id));
      }

      try {
        await service.refreshCitations(extras);

        assert.equal(
          service.getScholarBlockStatus().attempts,
          1,
          "three rows refused in the same second are one episode of being " +
            "blocked, not three retries",
        );
      } finally {
        for (const target of extras.slice(1)) {
          try {
            await target.eraseTx();
          } catch {
            // Already gone with the run.
          }
        }
      }
    });

    it("stops the automatic retries once four rounds have been refused", async function () {
      useTransport();
      const internals = service as unknown as {
        scholarRound: number;
        scholarRetryPaused: boolean;
        retryBlockedScholar: () => Promise<void>;
      };

      // One refused round, so the item is waiting on the block.
      await service.refreshCitations([Zotero.Items.get(item.id)]);
      assert.equal(service.getScholarBlockStatus().attempts, 1);

      // The retry timer has fired three times already.
      internals.scholarRound = 3;
      await internals.retryBlockedScholar();

      assert.isTrue(
        internals.scholarRetryPaused,
        "the fourth refusal has to end the automatic retrying, which is the " +
          "only thing that stops the pile from growing",
      );
      assert.equal(service.getScholarBlockStatus().attempts, 4);
    });

    it("lets the user's own refresh start a new episode", async function () {
      useTransport();
      const internals = service as unknown as { scholarRetryPaused: boolean };

      await service.refreshCitations([Zotero.Items.get(item.id)]);

      assert.isFalse(
        internals.scholarRetryPaused,
        "the user asking again is a new attempt, not a fifth refusal",
      );
      assert.equal(service.getScholarBlockStatus().attempts, 1);
    });
  });

  describe("reading Google only for the rows the user asked about", function () {
    /** Runs `body` with the selection replaced by `selected`. */
    async function withSelection<T>(
      selected: Zotero.Item[],
      body: () => Promise<T>,
    ): Promise<T> {
      const zotero = Zotero as unknown as { getMainWindows: () => unknown[] };
      const original = zotero.getMainWindows;
      zotero.getMainWindows = () => [
        { ZoteroPane: { getSelectedItems: () => selected } },
      ];
      // The selection is remembered for a moment so that one repaint's worth
      // of questions is answered once; drop the memory so each case sees its
      // own selection rather than the one from a moment ago.
      (service as unknown as { selectionCache: unknown }).selectionCache = null;
      try {
        return await body();
      } finally {
        zotero.getMainWindows = original;
        (service as unknown as { selectionCache: unknown }).selectionCache =
          null;
      }
    }

    /**
     * Starts from a clean Google slate: the tests above leave a block behind,
     * and a blocked column reports the block rather than the rule under test.
     */
    async function clearBlock(target: Zotero.Item): Promise<void> {
      const internals = service as unknown as {
        scholarBlockedItems: Set<number>;
        citationStates: Map<number, unknown>;
      };
      internals.scholarBlockedItems.clear();
      // A failed read leaves a cooldown behind, and a cooling-down row reports
      // that failure rather than the rule under test.
      internals.citationStates.delete(target.id);
      await service.resetGoogleSession();
    }

    it("leaves an unselected row alone, and says why", async function () {
      useTransport();
      const target = Zotero.Items.get(item.id);
      await clearBlock(target);
      await withSelection([], async () => {
        const plan = service.planCitationCell(target);

        assert.equal(
          String(plan.text),
          CELL_UNAVAILABLE,
          "no count, and no read started for it",
        );
        assert.include(
          String(service.planCitationCell(target).value),
          "not-selected",
          "the tooltip has to carry the reason, or the blank cell looks broken",
        );
      });

      assert.deepEqual(
        captured.filter((call) => call.url.includes("scholar.google.com")),
        [],
        "nothing was sent to Google",
      );
    });

    it("reads the row the user has selected", async function () {
      useTransport();
      const target = Zotero.Items.get(item.id);
      await clearBlock(target);

      await withSelection([target], async () => {
        const plan = service.planCitationCell(target);
        assert.equal(
          String(plan.text),
          CELL_LOADING,
          "a selected row starts reading",
        );
      });

      assert.isTrue(
        captured.some((call) => call.url.includes("scholar.google.com")),
        "the selected row is the one Google is asked about",
      );
    });

    it("still reads what an explicit refresh names, selected or not", async function () {
      useTransport();
      const target = Zotero.Items.get(item.id);
      await clearBlock(target);

      await withSelection([], async () => {
        await service.refreshCitations([Zotero.Items.get(item.id)]);
      });

      assert.isTrue(
        captured.some((call) => call.url.includes("scholar.google.com")),
        "the refresh action is the user asking for these entries",
      );
    });
  });

  describe("what happens to the cookies when a read is refused", function () {
    it("clears them by itself, and never shows the user a thing", async function () {
      // The jar is emptied by the plugin on its own: a block is the one moment
      // where the cookies collected so far are worth dropping, and the next
      // attempt should look like a browser that has just arrived. There is no
      // entry for it in the menu and nothing is said about it - the user only
      // ever sees the retry, never the housekeeping.
      useTransport();
      const internals = service as unknown as { requester: PacedRequester };
      const requester = internals.requester;

      // A session that has been to Google and holds its cookies.
      await requester.requestPage("https://scholar.google.com/?hl=en");
      assert.isTrue(googleConsentStored(), "the session has its cookies");

      const target = Zotero.Items.get(item.id);
      internals.scholarBlockedItems.clear();
      await service.refreshCitations([target]);

      assert.isFalse(
        googleConsentStored(),
        "a refused read drops the Google cookies without being asked to",
      );
      assert.isNull(
        requester.sessionWarmup(),
        "and the session starts over, so the retry arrives with a fresh visit",
      );
    });
  });

  describe("resetting the Google session", function () {
    it("starts the session over instead of retrying with an empty jar", async function () {
      useTransport();
      const internals = service as unknown as {
        requester: PacedRequester;
        scholarBlockedItems: Set<number>;
      };
      const requester = internals.requester;

      // A session that has already been to Google, and the consent cookie the
      // visit wrote.
      await requester.requestPage("https://scholar.google.com/scholar?q=warm");
      assert.isNotNull(requester.sessionWarmup(), "the session warmed up");
      assert.isTrue(googleConsentStored(), "and the consent cookie is there");

      // Nothing is waiting on the block, so this reset only resets.
      internals.scholarBlockedItems.clear();
      await service.resetGoogleSession();

      assert.isNull(
        requester.sessionWarmup(),
        "the session is forgotten, so the next Google request is the front " +
          "page again - the visit a browser that has never been here makes",
      );
      assert.isFalse(
        googleConsentStored(),
        "and the consent cookie went out with the jar",
      );

      captured.length = 0;
      await requester.requestPage("https://scholar.google.com/scholar?q=after");

      assert.equal(
        captured[0]?.url,
        "https://scholar.google.com/",
        "the first Google request of the new session is the site itself",
      );
      assert.isNotNull(requester.sessionWarmup(), "and it warms up again");
      assert.isTrue(
        googleConsentStored(),
        "the consent cookie goes back in with the new session",
      );
    });
  });
});
