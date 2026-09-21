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
import { getService } from "../src/modules/column";
import { upsertLikesCache } from "../src/modules/arxiv-id";
import { fromSortableValue, CELL_LOADING } from "../src/modules/likes";
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
  failLikes: boolean;
  failScholar: boolean;
  /** Set to hold the next request open until `release` is called. */
  hold: boolean;
  release: (() => void) | null;
}

function stubRequester(service: unknown, likes: number, scholar = 0): Stub {
  const state: Stub = {
    served: [],
    likes,
    scholar,
    failLikes: false,
    failScholar: false,
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
      return scholarPage(state.scholar, "AlphaLikes refresh probe paper");
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

    it("adopts a record picked by hand and remembers it", async function () {
      const target = Zotero.Items.get(item.id);
      stub = stubRequester(service, 0, 1234);

      await service.applyScholarResult(target, {
        title: "The Exact Paper The User Chose",
        count: 1234,
        meta: "A. Author - Journal, 2020",
        url: "https://example.org/picked",
      });

      const extra = String(target.getField("extra"));
      assert.include(
        extra,
        "alphaxiv_scholar_title: The Exact Paper The User Chose",
        "the choice has to survive the next refresh",
      );
      assert.equal(
        service.planCitationCell(target).text,
        "1234",
        "the picked record's count is what the column shows",
      );

      // The pin also decides what the automatic lookup searches for, so a
      // refresh keeps landing on the record the user chose.
      const queries = stub.served
        .filter((url) => url.includes("scholar.google.com"))
        .map((url) => decodeURIComponent(url));
      assert.isTrue(
        queries.some((url) => url.includes("The Exact Paper The User Chose")),
      );
    });

    it("forgets the picked record when asked to", async function () {
      const target = Zotero.Items.get(item.id);
      stub = stubRequester(service, 0, 9);

      await service.clearScholarResult(target);

      const extra = String(target.getField("extra"));
      assert.notInclude(extra, "alphaxiv_scholar_title");
      assert.isNull(service.getScholarPinnedTitle(target));
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
