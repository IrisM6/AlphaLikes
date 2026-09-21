/**
 * Tests for the clear action.
 *
 * The action has one rule the user stated outright: remove what this plugin
 * recorded in `Extra`, and leave every other `Extra` line exactly as it was.
 * The second half is the easy one to get wrong - a `setField("extra", "")`
 * would pass any test that only checks whether our own keys are gone - so
 * these tests start from an `Extra` that belongs mostly to somebody else.
 *
 * The other half of the contract is that a clear has to survive the next
 * repaint. The column reads a count as soon as it has none, so an item that
 * was cleared and then read again would get the deleted lines written straight
 * back; a cleared item therefore stays empty until an explicit refresh asks
 * for it, and that is asserted here too.
 */

import { assert } from "chai";
import {
  getService,
  renderCitationCell,
  renderLikeCell,
} from "../src/modules/column";
import { fromSortableValue } from "../src/modules/likes";
import {
  getPref,
  readClearedItemIDs,
  setPref,
  writeClearedItemIDs,
} from "../src/modules/prefs";

/** `Extra` of a user who has been using Zotero for a while. */
const FOREIGN_LINES = [
  "tex.ids: alpha-v1",
  "Citation Key: doe2026attention",
  "My own note about this paper, mentioning alphaxiv_likes: 12 in passing",
  "- [ ] read the appendix",
];

function extraWithPluginData(): string {
  return [
    ...FOREIGN_LINES,
    "alphaxiv_arxiv_id: 2401.00001",
    "alphaxiv_likes: 111",
    "alphaxiv_likes_updated: 2026-09-20T10:00:00.000Z",
    "alphaxiv_likes_history: 2026-09-20:111;2026-09-19:100",
    "alphaxiv_citations: gs=1234",
    "alphaxiv_citations_updated: 2026-09-20T10:00:00.000Z",
    "alphaxiv_scholar_title: The Exact Paper The User Chose",
  ].join("\n");
}

/** A page shaped like the alphaXiv paper view. */
function alphaXivPage(likes: number): Document {
  const win = Zotero.getMainWindow() as unknown as Window;
  const html =
    `<html><body><button aria-label="Like this paper">` +
    `<span class="inline-block">${likes}</span></button></body></html>`;
  return new win.DOMParser().parseFromString(html, "text/html");
}

describe("AlphaLikes clear action", function () {
  let service: ReturnType<typeof getService>;
  let item: Zotero.Item;
  let previousRequester: unknown;

  before(async function () {
    service = getService();
    previousRequester = (service as unknown as { requester: unknown })
      .requester;

    item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "AlphaLikes clear probe paper");
    item.setField("date", "2026-09-21");
    item.setField("extra", extraWithPluginData());
    await item.saveTx();
  });

  after(async function () {
    writeClearedItemIDs([]);
    (service as unknown as { requester: unknown }).requester =
      previousRequester;
    try {
      await item.eraseTx();
    } catch {
      // The library may already be gone when the run tears down.
    }
  });

  it("removes this plugin's lines and nothing else", async function () {
    const target = Zotero.Items.get(item.id);

    const summary = await service.clearItems([target]);

    const extra = String(target.getField("extra"));
    assert.equal(summary.total, 1);
    assert.equal(summary.cleared, 1);
    assert.equal(summary.alreadyEmpty, 0);

    for (const line of FOREIGN_LINES) {
      assert.include(
        extra,
        line,
        "the clear action may only delete the lines this plugin wrote",
      );
    }
    const ownedLines = extra
      .split("\n")
      .filter((line) => /^\s*alphaxiv_/.test(line));
    assert.deepEqual(
      ownedLines,
      [],
      "not one line of this plugin's own keys may survive the clear",
    );
    assert.notInclude(extra, "The Exact Paper The User Chose");
    assert.include(
      extra,
      "mentioning alphaxiv_likes: 12 in passing",
      "a line that merely talks about a key is the user's line, not ours",
    );
  });

  it("reports an item that had nothing of ours", async function () {
    const clean = new Zotero.Item("journalArticle");
    clean.libraryID = Zotero.Libraries.userLibraryID;
    clean.setField("title", "AlphaLikes clear probe paper without records");
    clean.setField("extra", FOREIGN_LINES.join("\n"));
    await clean.saveTx();

    try {
      const summary = await service.clearItems([clean]);

      assert.equal(summary.cleared, 0);
      assert.equal(summary.alreadyEmpty, 1);
      assert.equal(String(clean.getField("extra")), FOREIGN_LINES.join("\n"));
    } finally {
      await clean.eraseTx();
    }
  });

  it("does not read a cleared item back in, and the empty cell says why", async function () {
    const target = Zotero.Items.get(item.id);

    // The arXiv ID is in the item's URL, not in `Extra`, so the identifier is
    // still there; only the cleared mark keeps the lookup from running.
    target.setField("url", "https://arxiv.org/abs/2401.00001");
    await target.saveTx();

    const doc = (Zotero.getMainWindow() as unknown as Window).document;
    const likeCell = renderLikeCell(
      service.getCellData(target),
      { className: "alphalikes-cell" },
      doc,
    );
    assert.equal(
      likeCell.textContent,
      "",
      "a cleared item must stay empty instead of being read again",
    );
    assert.match(
      String(likeCell.title),
      /刷新|refresh/i,
      "an empty cell has to say how the number comes back",
    );

    const citationCell = renderCitationCell(
      service.getCitationCellData(target),
      { className: "alphalikes-citations-cell" },
      doc,
    );
    assert.equal(citationCell.textContent, "");
    assert.match(String(citationCell.title), /刷新|refresh/i);

    assert.isTrue(service.isCleared(target));
    assert.include(
      readClearedItemIDs(),
      target.id,
      "the item has to stay cleared across a restart, so the mark is stored",
    );
    assert.notInclude(
      String(target.getField("extra")),
      "clearedItemIDs",
      "the bookkeeping must not leak into the field the action empties",
    );
  });

  it("comes back when the user refreshes the item", async function () {
    const target = Zotero.Items.get(item.id);
    const served: string[] = [];
    const requester = service as unknown as {
      requester: Record<string, unknown>;
    };
    requester.requester = {
      ...requester.requester,
      requestHTML: async (url: string) => {
        served.push(url);
        return alphaXivPage(222);
      },
    };

    const summary = await service.refreshItems([Zotero.Items.get(item.id)]);

    assert.equal(summary.updated, 1);
    assert.include(served.join(" "), "2401.00001");
    assert.equal(fromSortableValue(service.getCellData(target)), "222");
    assert.isFalse(
      service.isCleared(target),
      "an explicit refresh is how a cleared item comes back",
    );
    assert.notInclude(readClearedItemIDs(), target.id);
    assert.include(
      String(target.getField("extra")),
      "alphaxiv_likes: 222",
      "the refreshed count is written to Extra again",
    );
  });

  it("leaves the plugin's settings alone", async function () {
    // The action is about one item's records, not about the plugin: a clear
    // must not reset colours, styles or sources on the way through.
    setPref("likeStyle", "morandi");
    const target = Zotero.Items.get(item.id);

    await service.clearItems([target]);

    assert.equal(getPref("likeStyle"), "morandi");
    assert.equal(
      JSON.stringify(String(target.getField("extra"))),
      JSON.stringify(FOREIGN_LINES.join("\n")),
      "the item's own Extra content is exactly what the user typed",
    );
    assert.isTrue(service.isCleared(target));
  });
});
