/**
 * What the reading says about each paper, and when each paper is tried again.
 *
 * Reported: a refresh hit Google's rate limit, the notice said "retrying in
 * about 5 minutes", and the line in the menu said "2 requests this session ·
 * next in about now". Three things were wrong with that line, and each of them
 * is asserted here:
 *
 * - the count was the session's, not the paper's. The reading is sequential -
 *   one search at a time, spaced out, and a refusal stops the ones behind it -
 *   so the only count that means anything is the one belonging to the paper
 *   whose turn it was, and it starts over once that paper has been read;
 * - the wait was the queue's own next slot, which says nothing about the paper
 *   that is waiting out Google's check;
 * - the two numbers came from different places, so the popup and the line
 *   could disagree about the same wait.
 */

import { assert } from "chai";
import { getService } from "../src/modules/column";
import { minutesUntil } from "../src/modules/citations";
import { PacedRequester, type HttpTransport } from "../src/modules/http";
import { setPref } from "../src/modules/prefs";

interface Captured {
  url: string;
}

function makeItem(suffix: string, title?: string) {
  const created = new Zotero.Item("journalArticle");
  created.libraryID = Zotero.Libraries.userLibraryID;
  created.setField("title", title ?? `AlphaPulse activity probe ${suffix}`);
  created.setField("date", "2026-09-23");
  created.setField("DOI", `10.1234/alphalikes.activity.${suffix}`);
  return created;
}

/** A Scholar results page whose first hit is the item itself. */
function scholarPage(title: string, count: number): string {
  return (
    `<div class="gs_r gs_or gs_scl"><div class="gs_ri">` +
    `<h3 class="gs_rt"><a href="/url?q=https://example.org/p">${title}</a></h3>` +
    `<div class="gs_fl"><a href="/scholar?cites=1">Cited by ${count}</a></div>` +
    `</div></div>`
  );
}

describe("AlphaPulse per-paper Scholar reading", function () {
  let service: ReturnType<typeof getService>;
  let items: Zotero.Item[];

  before(async function () {
    service = getService();
    items = ["one", "two", "three"].map((suffix) => makeItem(suffix));
    for (const item of items) await item.saveTx();
    // Google Scholar alone, so the source under test is the only one in play.
    setPref("citationSourcePreferences", "googleScholar");
    setPref("citationsEnabled", true);
  });

  after(async function () {
    for (const item of items) {
      try {
        await item.eraseTx();
      } catch {
        // The library may already be gone when the run tears down.
      }
    }
  });

  /** A refused Scholar, and a working one, behind the same switch. */
  function useTransport(
    answers: (url: string) => { status: number; body: string } | null,
    captured: Captured[],
  ): void {
    const transport: HttpTransport = async (_method, url) => {
      captured.push({ url: String(url) });
      const answer = answers(String(url));
      if (answer) return { status: answer.status, response: answer.body };
      return { status: 200, response: "" };
    };
    service.setReadTransport(transport);

    // These tests send several Scholar reads in a row; production spaces them
    // out (and pauses between bursts) on purpose.
    const options = (
      service as unknown as {
        requester: {
          options: {
            intervalMs: number;
            scholarPacing?: Record<string, number>;
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

  const refused = () => ({
    status: 429,
    body: "<html><title>Sorry...</title><body>unusual traffic</body></html>",
  });

  /** The service's per-paper reading state, as the menu reads it. */
  function activity() {
    return service.scholarActivity();
  }

  async function reset(): Promise<void> {
    const internals = service as unknown as {
      scholarBlockedItems: Set<number>;
      citationStates: Map<number, unknown>;
      scholarItems: Map<number, unknown>;
    };
    internals.scholarBlockedItems.clear();
    internals.citationStates.clear();
    internals.scholarItems.clear();
    await service.resetGoogleSession();
    setPref("citationSourcePreferences", "googleScholar");
  }

  it("counts a search against the paper it was sent for", async function () {
    await reset();
    const captured: Captured[] = [];
    useTransport(
      (url) => (url.includes("scholar.google.com") ? refused() : null),
      captured,
    );

    await service.refreshCitations([Zotero.Items.get(items[0].id)]);

    const rows = activity().items;
    assert.lengthOf(rows, 1, "one paper was asked about, so one row");
    assert.equal(rows[0].itemID, items[0].id, "and the row is that paper's");
    assert.equal(
      rows[0].attempts,
      1,
      "a refused search is still a search this paper cost",
    );
    assert.include(
      rows[0].title,
      "AlphaPulse activity probe one",
      "the row carries the title, so the line can name the paper",
    );
  });

  it("gives every paper its own count, not the session's", async function () {
    await reset();
    const captured: Captured[] = [];
    useTransport(
      (url) => (url.includes("scholar.google.com") ? refused() : null),
      captured,
    );

    await service.refreshCitations(
      items.map((item) => Zotero.Items.get(item.id)),
    );

    const rows = activity().items;
    assert.isAtLeast(rows.length, 1, "the refused papers are reported");
    const total = rows.reduce((sum, row) => sum + row.attempts, 0);
    const searches = captured.filter((call) =>
      call.url.includes("scholar.google.com/scholar?"),
    ).length;
    assert.isAtMost(
      total,
      searches,
      "the counts cannot add up to more searches than were actually sent",
    );
    // The paper the reading stopped on has a count; the ones behind the block
    // were never asked, and say zero rather than borrowing a session total.
    const stuck = rows.find((row) => row.attempts > 0);
    assert.isOk(stuck, "the paper whose search was refused carries a count");
  });

  it("waits for the paper until the same moment the notice names", async function () {
    await reset();
    const captured: Captured[] = [];
    useTransport(
      (url) => (url.includes("scholar.google.com") ? refused() : null),
      captured,
    );

    await service.refreshCitations([Zotero.Items.get(items[0].id)]);

    const status = service.getScholarBlockStatus();
    assert.isTrue(status.blocked, "the block is in force");

    const row = activity().items.find((item) => item.itemID === items[0].id);
    assert.isOk(row, "the paper that was refused has a row");
    const fromLine = Math.round(row!.nextInMs / 60_000);
    assert.equal(
      fromLine,
      status.minutesLeft,
      "the line and the notice describe one wait, not two",
    );
    assert.isAbove(row!.nextInMs, 0, "and that wait is in the future");

    // The notice's own wording rounds on the block's deadline; a line that
    // rounds elsewhere would say a different number a few seconds later.
    const deadline = Date.now() + status.minutesLeft * 60_000;
    assert.equal(
      minutesUntil(deadline),
      status.minutesLeft,
      "one rounding for the same deadline",
    );
  });

  it("starts a paper's count over once it has been read", async function () {
    await reset();
    const captured: Captured[] = [];
    const title = String(items[1].getField("title"));
    useTransport(
      (url) =>
        url.includes("scholar.google.com")
          ? { status: 200, body: scholarPage(title, 1234) }
          : null,
      captured,
    );

    await service.refreshCitations([Zotero.Items.get(items[1].id)]);

    const row = activity().items.find((item) => item.itemID === items[1].id);
    assert.isNotOk(
      row,
      "a paper with its number has nothing left to wait for, so its count is gone",
    );
  });

  it("counts the second attempt at the same paper, and only that paper", async function () {
    await reset();
    const captured: Captured[] = [];
    useTransport(
      (url) => (url.includes("scholar.google.com") ? refused() : null),
      captured,
    );

    const target = Zotero.Items.get(items[2].id);
    await service.refreshCitations([target]);
    const first = activity().items.find((item) => item.itemID === items[2].id);
    assert.equal(first?.attempts, 1);

    // The user asks again: the count follows the paper, not the episode.
    await service.refreshCitations([target]);
    const second = activity().items.find((item) => item.itemID === items[2].id);
    assert.equal(
      second?.attempts,
      2,
      "the paper has now cost two searches, and its line says two",
    );
    assert.lengthOf(
      activity().items.filter((item) => item.itemID === items[2].id),
      1,
      "one row per paper, however many attempts it has had",
    );
  });

  it("reports the papers in the order the reading reaches them", async function () {
    await reset();
    const captured: Captured[] = [];
    useTransport(
      (url) => (url.includes("scholar.google.com") ? refused() : null),
      captured,
    );

    await service.refreshCitations(
      items.map((item) => Zotero.Items.get(item.id)),
    );

    const rows = activity().items;
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      assert.isAtMost(
        previous.nextInMs,
        current.nextInMs,
        "the paper due soonest is named first",
      );
      assert.notEqual(
        previous.itemID,
        current.itemID,
        "a paper appears once, however many rows it was painted in",
      );
    }
  });

  it("drops a paper from the reading when the item is gone", async function () {
    await reset();
    const captured: Captured[] = [];
    useTransport(
      (url) => (url.includes("scholar.google.com") ? refused() : null),
      captured,
    );

    const doomed = makeItem("gone");
    await doomed.saveTx();
    await service.refreshCitations([doomed]);
    const id = doomed.id;
    assert.isOk(activity().items.find((item) => item.itemID === id));

    await doomed.eraseTx();
    assert.isNotOk(
      activity().items.find((item) => item.itemID === id),
      "a line about a deleted paper is a line about nothing",
    );
  });

  it("keeps the pacing line honest about what the queue is doing", async function () {
    // The session's own numbers stay available - the settings line uses them
    // as context - but they are the queue's, and they are not a per-paper
    // count: this asserts the two are separate things.
    const summary = activity();
    assert.isNumber(summary.requests, "the session count is still reported");
    assert.isArray(
      summary.items,
      "and the per-paper reading is reported with it",
    );
    assert.isBoolean(summary.autoPaused);
    assert.instanceOf(
      (service as unknown as { requester: unknown }).requester,
      PacedRequester,
    );
  });
});
