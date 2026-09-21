/**
 * Regression tests for the two refresh actions.
 *
 * The reported case: 「刷新 alphaXiv 点赞」 looked like it did nothing, while
 * 「清除」 visibly re-read the counts - because the stored number stayed in the
 * cell for the whole request, so a refresh that came back with the same figure
 * was indistinguishable from one that never ran. These tests drive the real
 * service against a stubbed network, which is the only way to tell "the count
 * really was re-read" from "the count happened to be the same".
 */

import { assert } from "chai";
import { trimBodyHead } from "../src/modules/http";
import { getService } from "../src/modules/column";
import { upsertLikesCache } from "../src/modules/arxiv-id";
import {
  fromSortableValue,
  CELL_LOADING,
  CELL_UNAVAILABLE,
} from "../src/modules/likes";
import { CITATIONS_BLOCKED_MARKER } from "../src/modules/citations";
import { setPref } from "../src/modules/prefs";

/** A page shaped like the alphaXiv paper view. */
function alphaXivPage(likes: number): Document {
  const win = Zotero.getMainWindow() as unknown as Window;
  const html =
    `<html><body><button aria-label="Like this paper">` +
    `<span class="inline-block">${likes}</span></button></body></html>`;
  return new win.DOMParser().parseFromString(html, "text/html");
}

/** A Scholar results page whose first hit is the item itself. */
function scholarPage(count: number, title: string): string {
  return `
    <div class="gs_r gs_or gs_scl"><div class="gs_ri">
      <h3 class="gs_rt"><a href="/url?q=https://example.org/p">${title}</a></h3>
      <div class="gs_fl"><a href="/scholar?cites=1">Cited by ${count}</a></div>
    </div></div>`;
}

interface Stub {
  served: string[];
  likes: number;
  scholar: number;
  /** Title of the single Scholar hit the stub serves. */
  scholarTitle: string;
  failLikes: boolean;
  failScholar: boolean;
  /** HTTP status the Scholar request answers with. */
  scholarStatus: number;
  /** Set to hold the next request open until `release` is called. */
  hold: boolean;
  release: (() => void) | null;
}

function stubRequester(service: unknown, likes: number, scholar = 0): Stub {
  const state: Stub = {
    served: [],
    likes,
    scholar,
    scholarTitle: "AlphaLikes refresh probe paper",
    failLikes: false,
    failScholar: false,
    scholarStatus: 200,
    hold: false,
    release: null,
  };
  const target = service as { requester: Record<string, unknown> };
  const previous = target.requester;

  function gate(): Promise<void> {
    if (!state.hold) return Promise.resolve();
    return new Promise<void>((resolve) => {
      state.release = resolve;
    });
  }

  target.requester = {
    ...previous,
    // The service asks what the session's opening Google request answered; a
    // stub has no such history.
    sessionWarmup: () => null,
    requestHTML: async (url: string) => {
      state.served.push(url);
      await gate();
      if (state.failLikes) throw new Error("service unavailable");
      return alphaXivPage(state.likes);
    },
    requestText: async (url: string) => {
      state.served.push(url);
      await gate();
      if (state.failScholar) throw new Error("service unavailable");
      return scholarPage(state.scholar, state.scholarTitle);
    },
    // Scholar reads go through the two-path reader; a stub answers on the
    // request path, which is also what the plugin falls back to.
    requestScholarPage: async (url: string) => {
      state.served.push(url);
      await gate();
      if (state.failScholar) throw new Error("service unavailable");
      const body =
        state.scholarStatus === 200
          ? scholarPage(state.scholar, state.scholarTitle)
          : "<html><title>Sorry...</title><body>unusual traffic</body></html>";
      const attempt = {
        via: "xhr" as const,
        status: state.scholarStatus,
        error: null,
        bytes: body.length,
        bodyHead: trimBodyHead(body),
        usable: state.scholarStatus === 200,
      };
      return {
        status: state.scholarStatus,
        body: state.scholarStatus === 200 ? body : "",
        via: state.scholarStatus === 200 ? ("xhr" as const) : null,
        attempts: [attempt],
      };
    },
    // Scholar reads keep the status, so a refusal can be told from a page that
    // carried nothing.
    requestPage: async (url: string) => {
      state.served.push(url);
      await gate();
      if (state.failScholar) throw new Error("service unavailable");
      return {
        status: state.scholarStatus,
        body:
          state.scholarStatus === 200
            ? scholarPage(state.scholar, state.scholarTitle)
            : "<html><title>Sorry...</title><body>unusual traffic</body></html>",
      };
    },
  };

  return state;
}

describe("AlphaLikes refresh", function () {
  let item: Zotero.Item;
  let service: ReturnType<typeof getService>;
  let stub: Stub;

  before(async function () {
    service = getService();
    item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "AlphaLikes refresh probe paper");
    item.setField("date", "2026-09-21");
    item.setField(
      "extra",
      upsertLikesCache("alphaxiv_arxiv_id: 2401.00001", 111),
    );
    await item.saveTx();
  });

  after(async function () {
    try {
      await item.eraseTx();
    } catch {
      // The library may already be gone when the run tears down.
    }
  });

  describe("like counts", function () {
    it("shows the cached count until something re-reads it", function () {
      assert.equal(fromSortableValue(service.getCellData(item)), "111");
    });

    it("re-reads the count when the refresh action runs", async function () {
      stub = stubRequester(service, 222);

      const summary = await service.refreshItems([Zotero.Items.get(item.id)]);

      assert.include(
        stub.served.join(" "),
        "2401.00001",
        "the refresh has to ask alphaXiv about this paper",
      );
      assert.equal(fromSortableValue(service.getCellData(item)), "222");
      assert.equal(summary.total, 1);
      assert.equal(summary.updated, 1);
      assert.equal(summary.failed, 0);
    });

    it("shows the loading state while the re-read is in flight", async function () {
      stub = stubRequester(service, 333);
      stub.hold = true;

      const running = service.refreshItems([Zotero.Items.get(item.id)]);
      assert.equal(
        fromSortableValue(service.getCellData(item)),
        CELL_LOADING,
        "a refresh has to be visible: a stored number that never changes " +
          "looks exactly like a refresh that did nothing",
      );

      stub.hold = false;
      stub.release?.();
      await running;

      assert.equal(fromSortableValue(service.getCellData(item)), "333");
    });

    it("keeps the old count when the re-read fails", async function () {
      stub = stubRequester(service, 444);
      stub.failLikes = true;

      const summary = await service.refreshItems([Zotero.Items.get(item.id)]);

      assert.equal(
        fromSortableValue(service.getCellData(item)),
        "333",
        "a failed refresh must not blank a count that is still the best we know",
      );
      assert.equal(summary.updated, 0);
      assert.equal(summary.failed, 1);
    });

    it("leaves citations alone", async function () {
      stub = stubRequester(service, 555, 42);

      await service.refreshItems([Zotero.Items.get(item.id)]);

      assert.notInclude(
        stub.served.join(" "),
        "scholar.google.com",
        "re-reading likes is not a request to re-read citations",
      );
    });
  });

  describe("citation counts", function () {
    before(function () {
      // The default source is Google Scholar; make sure nothing else is
      // ticked from an earlier test in this run.
      setPref("citationSourcePreferences", "googleScholar");
    });

    it("re-reads the count and caches it", async function () {
      stub = stubRequester(service, 0, 42);

      const summary = await service.refreshCitations([
        Zotero.Items.get(item.id),
      ]);

      assert.include(stub.served.join(" "), "scholar.google.com");
      assert.equal(summary.total, 1);
      assert.equal(summary.updated, 1);
      assert.equal(summary.failed, 0);

      const plan = service.planCitationCell(Zotero.Items.get(item.id));
      assert.equal(plan.text, "42");
      assert.equal(plan.source, "Google Scholar");
    });

    it("shows the loading state while the re-read is in flight", async function () {
      stub = stubRequester(service, 0, 77);
      stub.hold = true;

      const running = service.refreshCitations([Zotero.Items.get(item.id)]);
      assert.equal(
        service.planCitationCell(Zotero.Items.get(item.id)).text,
        CELL_LOADING,
      );

      stub.hold = false;
      stub.release?.();
      await running;

      assert.equal(
        service.planCitationCell(Zotero.Items.get(item.id)).text,
        "77",
      );
    });

    it("searches for the record an older install left in Extra", async function () {
      const target = Zotero.Items.get(item.id);
      // A different figure from the one already in Extra, so the re-read is
      // visible in the summary rather than looking like "nothing happened".
      stub = stubRequester(service, 0, 4321);

      // Rows an older build wrote: the chosen record's title, then the counts.
      // The remembered title is what the search asks for, and Scholar answers
      // with that same record, so the automatic match lands on it.
      stub.scholarTitle = "The Exact Paper The User Chose";
      await target.setField(
        "extra",
        [
          "alphaxiv_arxiv_id: 2401.00001",
          "alphaxiv_scholar_title: The Exact Paper The User Chose",
          "alphaxiv_citations: gs=1234",
        ].join("\n"),
      );
      await target.saveTx();

      const summary = await service.refreshCitations([target]);
      assert.equal(summary.updated, 1);
      assert.equal(service.planCitationCell(target).text, "4321");

      // The remembered title decides what the silent lookup searches for, so
      // an install that upgraded keeps landing on the record it had chosen.
      const queries = stub.served
        .filter((url) => url.includes("scholar.google.com"))
        .map((url) => decodeURIComponent(url));
      assert.isTrue(
        queries.some((url) => url.includes("The Exact Paper The User Chose")),
      );
    });

    it("adopts a match only at high confidence", async function () {
      const target = Zotero.Items.get(item.id);
      // A near-but-not-exact title: the Scholar hit scores below the high
      // confidence band, and a medium match is treated as "not found" now
      // that there is no dialog to confirm it in.
      stub = stubRequester(service, 0, 97531);
      stub.scholarTitle = "A Completely Different Paper About Fish";

      const summary = await service.refreshCitations([target]);
      assert.equal(summary.updated, 0);

      const plan = service.planCitationCell(target);
      assert.notInclude(String(plan.text), "97531");
    });

    it("reads a 403 as the human check, not as a failed request", async function () {
      // The reported bug: from a network Google distrusts, Scholar answers
      // with 403 and a "sorry" page. Throwing on that status meant the error
      // surfaced as a broken read and the count stayed empty for good, even
      // though the same request in a browser was fine.
      //
      // The item has no stored count, so a refusal leaves nothing to keep.
      const target = new Zotero.Item("journalArticle");
      target.libraryID = Zotero.Libraries.userLibraryID;
      target.setField("title", "AlphaLikes refresh probe paper");
      target.setField("date", "2026-09-21");
      target.setField("DOI", "10.1234/alphalikes.403");
      await target.saveTx();

      try {
        stub = stubRequester(service, 0, 0);
        stub.scholarStatus = 403;

        const summary = await service.refreshCitations([target]);

        assert.equal(summary.updated, 0);
        assert.equal(summary.failed, 1);
        const plan = service.planCitationCell(target);
        assert.include(
          plan.value,
          CITATIONS_BLOCKED_MARKER,
          "a refusal has to book a retry, not read as a paper with no citations",
        );
        assert.equal(plan.text, CELL_UNAVAILABLE);

        // Leave no block behind: the next test would otherwise see the retry
        // window rather than its own stub.
        stub.scholarStatus = 200;
        stub.scholar = 12;
        await service.refreshCitations([target]);
        assert.equal(service.planCitationCell(target).text, "12");
      } finally {
        await target.eraseTx();
      }
    });

    it("reads a 429 as rate limiting, which is a different answer", async function () {
      // Google rate limits an address (429) rather than refusing the request
      // (403). The wait is the same, but what the user is told is not: one is
      // "slow down, this network is busy", the other is "prove you are a
      // person", and opening a browser only helps with the second.
      const target = new Zotero.Item("journalArticle");
      target.libraryID = Zotero.Libraries.userLibraryID;
      target.setField("title", "AlphaLikes refresh probe paper");
      target.setField("date", "2026-09-21");
      target.setField("DOI", "10.1234/alphalikes.429");
      await target.saveTx();

      try {
        stub = stubRequester(service, 0, 0);
        stub.scholarStatus = 429;

        const summary = await service.refreshCitations([target]);

        assert.equal(summary.updated, 0);
        assert.equal(summary.failed, 1);

        const status = service.getScholarBlockStatus();
        assert.isTrue(status.blocked, "a 429 has to book a retry as well");
        assert.isTrue(
          status.rateLimited,
          "429 means the address is being limited, not that Google wants a " +
            "human check",
        );
        const plan = service.planCitationCell(target);
        assert.include(plan.value, CITATIONS_BLOCKED_MARKER);
        assert.equal(plan.text, CELL_UNAVAILABLE);

        // Leave no block behind: the next test would otherwise see the retry
        // window rather than its own stub.
        stub.scholarStatus = 200;
        stub.scholar = 12;
        await service.refreshCitations([target]);
        assert.equal(service.planCitationCell(target).text, "12");
        assert.isFalse(service.getScholarBlockStatus().rateLimited);
      } finally {
        await target.eraseTx();
      }
    });

    it("counts an item with nothing to look up as skipped", async function () {
      const bare = new Zotero.Item("journalArticle");
      bare.libraryID = Zotero.Libraries.userLibraryID;
      bare.setField("title", "An item with no identifier at all");
      await bare.saveTx();

      try {
        stub = stubRequester(service, 0, 5);
        const summary = await service.refreshCitations([bare]);

        assert.equal(summary.skipped, 1);
        assert.equal(summary.updated, 0);
      } finally {
        await bare.eraseTx();
      }
    });
  });
});
