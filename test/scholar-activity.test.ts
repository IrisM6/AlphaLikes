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
import { renderCitationCell, getService } from "../src/modules/column";
import { minutesUntil } from "../src/modules/citations";
import { CELL_LOADING } from "../src/modules/likes";
import { PacedRequester, type HttpTransport } from "../src/modules/http";
import { setPref } from "../src/modules/prefs";

const CITATION_COLUMN = { className: "col-alphaxiv_citations" };

/** The document the renderer is handed by the item tree. */
function testDocument(): Document {
  const win = Zotero.getMainWindow() as unknown as
    (Window & { document: Document }) | null;
  if (!win?.document) {
    throw new Error("the Zotero main window is not available in this context");
  }
  return win.document;
}

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

  /**
   * A page that is not a Scholar result set.
   *
   * This is what a read that did not happen looks like: the answer is not
   * "nothing matched", it is "the search did not come back", so the paper is
   * owed another attempt rather than an answer.
   */
  const noResults = () => ({
    status: 200,
    body: "<html><body><p>Scholar did not answer with a result set.</p></body></html>",
  });

  /** A Scholar hit for the paper, with no citation count anywhere on it. */
  function scholarPageWithoutCount(title: string): string {
    return (
      `<div class="gs_r gs_or gs_scl"><div class="gs_ri">` +
      `<h3 class="gs_rt"><a href="/url?q=https://example.org/p">${title}</a></h3>` +
      `</div></div>`
    );
  }

  /** The paper a Scholar search URL was sent for, unquoted. */
  function searchedFor(url: string): string {
    const query = url.split("q=")[1] ?? "";
    return decodeURIComponent(query).replaceAll('"', "").replaceAll("+", " ");
  }

  /**
   * Runs `body` with the selection replaced by `selected`.
   *
   * A Google Scholar read belongs to a selected row, so a test that wants an
   * automatic read has to say what the user has selected - the same stand-in
   * the guardrails suite uses.
   */
  async function withSelection<T>(
    selected: Zotero.Item[],
    body: () => Promise<T>,
  ): Promise<T> {
    const zotero = Zotero as unknown as { getMainWindows: () => unknown[] };
    const original = zotero.getMainWindows;
    zotero.getMainWindows = () => [
      { ZoteroPane: { getSelectedItems: () => selected } },
    ];
    (service as unknown as { selectionCache: unknown }).selectionCache = null;
    try {
      return await body();
    } finally {
      zotero.getMainWindows = original;
      (service as unknown as { selectionCache: unknown }).selectionCache = null;
    }
  }

  /** The service's per-paper reading state, as the menu reads it. */
  function activity() {
    return service.scholarActivity();
  }

  async function reset(): Promise<void> {
    const internals = service as unknown as {
      scholarBlockedItems: Set<number>;
      citationStates: Map<number, unknown>;
      scholarItems: Map<number, unknown>;
      scholarQueue: unknown[];
      scholarQueued: Set<number>;
      refreshingCitations: Set<number>;
      scholarQueueTimer: ReturnType<typeof setTimeout> | null;
      scholarRetryTimer: ReturnType<typeof setTimeout> | null;
      scholarBlock: unknown;
      scholarRound: number;
      scholarRetryPaused: boolean;
      scholarBlockAnnounced: boolean;
      scholarReading: number | null;
      selectionCache: unknown;
    };
    // The waiting list is part of the reading state, and so is everything the
    // list moves: a paper left in it by the test before this one would be
    // served first, its deadline would be the one the timer woke for, and the
    // refusal it met would still be counted in this test's round. Every test
    // here is about one paper's place in the queue, so the queue starts empty
    // for each of them - including the two ways into it that outlive a test
    // (the dedupe set, and the papers a refusal put aside for another try).
    for (const timer of [
      internals.scholarQueueTimer,
      internals.scholarRetryTimer,
    ]) {
      if (timer !== null) clearTimeout(timer);
    }
    internals.scholarQueueTimer = null;
    internals.scholarRetryTimer = null;
    internals.scholarQueue.length = 0;
    internals.scholarQueued.clear();
    internals.scholarBlockedItems.clear();
    internals.citationStates.clear();
    internals.scholarItems.clear();
    internals.refreshingCitations.clear();
    internals.scholarReading = null;
    internals.scholarBlock = null;
    internals.scholarRound = 0;
    internals.scholarRetryPaused = false;
    internals.scholarBlockAnnounced = false;
    internals.selectionCache = null;
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

    // Reported (1.3.7): a paper added while an older one was waiting out its
    // retry was told the *older* paper's time ("in about 5 minutes", on both
    // lines, neither of which kept it). The list is served in order, so what a
    // paper has to say about its own turn is its place in the list: the one
    // whose turn it is names when it is tried again, and the ones behind it
    // say how many papers are read before them and nothing else.
    await service.refreshCitations(
      items.map((item) => Zotero.Items.get(item.id)),
    );

    const rows = activity().items;
    assert.deepEqual(
      rows.map((row) => row.itemID),
      items.map((item) => item.id),
      "one line per paper, in the order the papers were named",
    );
    assert.equal(rows[0].ahead, 0, "the paper whose turn it is has none ahead");
    assert.isAbove(
      rows[0].nextInMs,
      0,
      "and it names the moment it is tried again",
    );
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      assert.isAbove(
        current.ahead,
        previous.ahead,
        "each paper behind it counts the ones in front of it",
      );
      assert.equal(
        current.nextInMs,
        0,
        "and does not borrow the deadline of the paper it waits behind",
      );
      assert.notEqual(
        previous.itemID,
        current.itemID,
        "a paper appears once, however many rows it was painted in",
      );
    }
  });

  it("reads a paper added on the way only after the paper in front is done", async function () {
    // Reported: adding an entry while an older one is waiting for its retry
    // left both unread - the new one said "asked 0 times, in about 5 minutes",
    // the same five minutes the older one was keeping. What the user asked for
    // is one waiting list: the new paper is read after the older one's turn,
    // never beside it.
    await reset();
    const captured: Captured[] = [];
    // The shared helper installs a transport and takes the reading rhythm out
    // of the picture; the transport below is the one under this test.
    useTransport(() => null, captured);

    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    service.setReadTransport(async (_method, url) => {
      const target = String(url);
      captured.push({ url: target });
      if (!target.includes("scholar.google.com")) {
        return { status: 200, response: "" };
      }
      // The first read stays in the air until the test lets it answer, which
      // is the moment a paper is added in the real thing: while a search is
      // running, somebody adds a paper.
      await held;
      return {
        status: 200,
        response: scholarPage(searchedFor(target), 4321),
      };
    });

    const older = makeItem("queue-older");
    const newer = makeItem("queue-newer");
    await older.saveTx();
    await newer.saveTx();

    try {
      await withSelection([newer], async () => {
        const running = service.refreshCitations([Zotero.Items.get(older.id)]);
        await Zotero.Promise.delay(60);
        assert.isTrue(
          activity().items.some(
            (row) => row.itemID === older.id && row.reading,
          ),
          "the older paper is the one being read",
        );

        // The user adds a paper and its row asks for a read, the way a repaint
        // asks for every visible row.
        assert.equal(
          String(service.planCitationCell(newer).text),
          CELL_LOADING,
        );
        await Zotero.Promise.delay(60);

        assert.deepEqual(
          captured.filter(
            (call) => searchedFor(call.url) === newer.getField("title"),
          ),
          [],
          "a paper added while a read is running is not read beside it",
        );
        const behind = activity().items.find((row) => row.itemID === newer.id);
        assert.isOk(behind, "it is in the list, waiting its turn");
        assert.equal(behind?.ahead, 1, "behind the paper that is being read");
        assert.equal(behind?.attempts, 0, "with no search spent on it yet");
        assert.equal(
          behind?.nextInMs,
          0,
          "and no time of its own - the paper in front decides",
        );

        // The older paper's turn ends, and the new one is read after it.
        release?.();
        await running;
        await Zotero.Promise.delay(400);

        const asked = captured
          .map((call) => searchedFor(call.url))
          .filter((title) => title !== "");
        assert.lengthOf(asked, 2, "one search each, and no more");
        assert.equal(asked[0], older.getField("title"));
        assert.equal(
          asked[1],
          newer.getField("title"),
          "the paper added on the way is read once the older one is done",
        );
        assert.deepEqual(
          activity().items,
          [],
          "and the list is empty once both have been read",
        );
      });
    } finally {
      for (const item of [older, newer]) {
        try {
          await item.eraseTx();
        } catch {
          // The run may have taken the library already.
        }
      }
    }
  });

  it("comes back for a waiting paper when its wait is up", async function () {
    // The other half of the reported bug: a paper said "retrying in about 5
    // minutes" and was never tried again. The wait the line names is the wait
    // the list's own timer wakes up for.
    await reset();
    const captured: Captured[] = [];
    let counted = false;
    useTransport(
      (url) =>
        url.includes("scholar.google.com")
          ? counted
            ? { status: 200, body: scholarPage(searchedFor(url), 4321) }
            : noResults()
          : null,
      captured,
    );

    const older = makeItem("wait-older");
    const newer = makeItem("wait-newer");
    await older.saveTx();
    await newer.saveTx();

    try {
      await withSelection([newer], async () => {
        await service.refreshCitations([Zotero.Items.get(older.id)]);
        const waiting = activity().items.find((row) => row.itemID === older.id);
        assert.isOk(waiting, "a paper that failed stays in the list");
        assert.isAbove(
          waiting?.nextInMs ?? 0,
          0,
          "with the wait the line is showing",
        );

        // Five minutes are not held up for; the paper is owed its next
        // attempt a moment from now, which is the deadline the line is showing
        // and therefore the one the list's own timer has to wake for. Nothing
        // presses refresh a second time in this half of the test.
        const internals = service as unknown as {
          scholarQueue: Array<{ itemID: number; notBefore: number | null }>;
          citationStates: Map<number, { kind: string; retryAfter?: number }>;
        };
        const entry = internals.scholarQueue.find(
          (row) => row.itemID === older.id,
        );
        assert.isOk(entry, "and keeps its place until then");
        if (entry) entry.notBefore = Date.now() + 5;
        const state = internals.citationStates.get(older.id);
        if (state?.retryAfter !== undefined) state.retryAfter = Date.now() + 5;

        // The new paper's row is painted, which is what puts it in the list:
        // behind the older one, whose upcoming turn comes first.
        counted = true;
        service.planCitationCell(newer);

        // The list wakes for the deadline on its own - the wait between two
        // searches is the requester's, and the shortest one it hands out is a
        // second - so the paper is asked again with no repaint to push it.
        await Zotero.Promise.delay(2_000);

        const asked = captured
          .map((call) => searchedFor(call.url))
          .filter((title) => title !== "");
        assert.isAbove(asked.length, 1, "the waiting paper was asked again");
        assert.equal(asked[1], older.getField("title"));
        assert.isTrue(
          asked.includes(newer.getField("title")),
          "and the paper behind it was read after it",
        );
      });
    } finally {
      for (const item of [older, newer]) {
        try {
          await item.eraseTx();
        } catch {
          // The run may have taken the library already.
        }
      }
    }
  });

  it("counts a paper found by its title alone, whose count is nothing", async function () {
    // Reported: a paper with no DOI, no arXiv id and no URL was found by its
    // title alone, the result carried no citation count at all, and the
    // refresh said "0 citations re-read; 1 without a DOI/arXiv ID" and kept
    // the paper unread. The title is a key of its own, and zero is what
    // Scholar answered - a number like any other.
    await reset();
    const captured: Captured[] = [];
    useTransport(
      (url) =>
        url.includes("scholar.google.com")
          ? { status: 200, body: scholarPageWithoutCount(searchedFor(url)) }
          : null,
      captured,
    );

    const paper = makeItem("title-only");
    paper.setField("title", "A paper findable by its title alone");
    paper.setField("DOI", "");
    paper.setField("url", "");
    await paper.saveTx();

    try {
      const summary = await withSelection([paper], async () =>
        service.refreshCitations([Zotero.Items.get(paper.id)]),
      );

      assert.isTrue(
        captured.some(
          (call) => searchedFor(call.url) === paper.getField("title"),
        ),
        "a paper with nothing but a title is still searched for",
      );
      assert.equal(summary.updated, 1, "the paper was read");
      assert.equal(summary.failed, 0, "and nothing failed");
      assert.equal(summary.missing, 0, "and nothing was missing a key");
      assert.equal(summary.skipped, 0, "and nothing was passed over");

      assert.equal(
        String(service.planCitationCell(paper).text),
        "0",
        "the count Scholar gave, which was nothing, is shown as a number",
      );
      assert.deepEqual(activity().items, [], "and nothing is waiting");
    } finally {
      try {
        await paper.eraseTx();
      } catch {
        // The run may have taken the library already.
      }
    }
  });

  it("says Scholar has no such paper instead of promising a retry", async function () {
    // Reported: a paper Scholar cannot find was reported as a failure and
    // given five minutes to come back with the same nothing. The answer is an
    // answer: the cell says what was found, the summary counts it, and no
    // attempt is booked for later.
    await reset();
    const captured: Captured[] = [];
    useTransport(
      (url) =>
        url.includes("scholar.google.com")
          ? {
              status: 200,
              body: scholarPage("A paper that is not this one", 12),
            }
          : null,
      captured,
    );

    const paper = makeItem("no-match");
    paper.setField("title", "A paper Google Scholar does not have");
    await paper.saveTx();

    try {
      const summary = await withSelection([paper], async () =>
        service.refreshCitations([Zotero.Items.get(paper.id)]),
      );

      assert.equal(summary.missing, 1, "the summary says it was not found");
      assert.equal(summary.failed, 0, "which is not a failed read");
      assert.equal(summary.updated, 0, "and nothing was written");

      const plan = service.planCitationCell(paper);
      const cell = renderCitationCell(
        String(plan.value),
        CITATION_COLUMN,
        testDocument(),
      ) as HTMLElement;
      assert.match(
        cell.title,
        /高置信度|high-confidence/i,
        "the tooltip says what Scholar answered",
      );
      assert.notMatch(
        cell.title,
        /\d+\s*(分钟|minutes)/,
        "and promises no retry, because there is nothing to wait for",
      );
      assert.isNotOk(
        activity().items.find((row) => row.itemID === paper.id),
        "and nothing is waiting to be tried again",
      );
    } finally {
      try {
        await paper.eraseTx();
      } catch {
        // The run may have taken the library already.
      }
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
