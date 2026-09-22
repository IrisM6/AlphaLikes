/**
 * Regression tests for "a setting only applies after a manual refresh".
 *
 * The reported case: switching 「在列里显示每日变化」 on did nothing until the
 * item list was reloaded. The cause was that a preference change only redrew
 * the tree; the cell value is memoised per row, so the freshly computed value
 * (with or without the trend arrow) was never read. Zotero 10 happens to drop
 * that cache when a plugin refreshes its columns, Zotero 7-9 do not, which is
 * why the bug was invisible in the CI that ran on the beta build.
 *
 * These tests pin the behaviour down: whatever the version, a preference
 * change has to drop the row cache before asking for a repaint.
 */

import { assert } from "chai";
import {
  dropRowCache,
  repaintRows,
  type ItemTreeView,
} from "../src/modules/service";
import { getService } from "../src/modules/column";
import { upsertLikesCache } from "../src/modules/arxiv-id";
import { PREF_BRANCH } from "../src/modules/prefs";

/** A stand-in that records what was asked of it. */
function fakeItemTree(options: { method?: boolean; cache?: boolean } = {}) {
  const calls: string[] = [];
  const view: ItemTreeView & { invalidatedAll?: boolean } = {};
  const cache = { row: "stale" };

  if (options.method) {
    view.invalidateRowCache = (invalidateAll?: boolean) => {
      calls.push(`invalidateRowCache(${invalidateAll})`);
      view.invalidatedAll = invalidateAll === true;
    };
  } else if (options.cache) {
    view._rowCache = cache;
  }
  view.tree = {
    invalidate: () => {
      calls.push("invalidate");
    },
  };

  return { view, calls, cache };
}

describe("AlphaLikes item-tree repaints", function () {
  describe("dropRowCache", function () {
    it("clears everything through the method when the build has one", function () {
      const { view, calls } = fakeItemTree({ method: true });

      dropRowCache(view);

      assert.deepEqual(calls, ["invalidateRowCache(true)", "invalidate"]);
      assert.isTrue(view.invalidatedAll, "the whole cache has to go");
    });

    it("replaces the row cache itself on builds without the method", function () {
      const { view, calls, cache } = fakeItemTree({ cache: true });

      dropRowCache(view);

      // A new object, not the stale one: this is what makes the next paint
      // read the provider again.
      assert.notStrictEqual(view._rowCache, cache);
      assert.deepEqual(view._rowCache, {});
      assert.deepEqual(calls, ["invalidate"]);
    });

    it("still redraws when there is no cache to drop", function () {
      const { view, calls } = fakeItemTree();

      dropRowCache(view);

      assert.deepEqual(calls, ["invalidate"]);
    });

    it("survives a window that has already gone", function () {
      assert.doesNotThrow(() => dropRowCache(null));
      assert.doesNotThrow(() => dropRowCache(undefined));
    });
  });

  describe("a preference change", function () {
    /** The main window's item tree, when the test window has one to poke. */
    function liveItemTree(): (ItemTreeView & { _rowCache?: unknown }) | null {
      const win = Zotero.getMainWindow() as unknown as {
        ZoteroPane?: { itemsView?: ItemTreeView };
      } | null;
      return (win?.ZoteroPane?.itemsView as ItemTreeView) ?? null;
    }

    it("drops the row cache so the new setting takes effect at once", async function () {
      const view = liveItemTree();
      if (!view) {
        this.skip();
        return;
      }

      const sentinel = { marker: "sentinel" };
      view._rowCache = sentinel;

      Zotero.Prefs.set(`${PREF_BRANCH}.showTrend`, false, true);
      await Zotero.Promise.delay(80);

      assert.notStrictEqual(
        view._rowCache,
        sentinel,
        "the service has to drop the row cache when a preference changes",
      );

      Zotero.Prefs.set(`${PREF_BRANCH}.showTrend`, true, true);
      await Zotero.Promise.delay(80);
    });
  });

  describe("repaintRows", function () {
    /** A view that knows two rows and records what was invalidated. */
    function liveView(rowID = 11) {
      const entries: Record<number, unknown> = {
        [rowID]: { value: "a" },
        12: { value: "b" },
      };
      const invalidatedRows: number[] = [];
      let invalidatedAll = 0;
      const view = {
        _rowCache: entries,
        _rowMap: { [rowID]: 0, 12: 1 },
        tree: {
          invalidateRow: (row: number) => invalidatedRows.push(row),
          invalidate: () => {
            invalidatedAll += 1;
          },
        },
      } as unknown as ItemTreeView & { _rowCache: Record<number, unknown> };

      return {
        view,
        entries,
        invalidatedRows,
        allInvalidated: () => invalidatedAll,
      };
    }

    /** Runs `body` with every window replaced by one holding `view`. */
    async function withView<T>(
      view: ItemTreeView,
      body: () => Promise<T>,
    ): Promise<T> {
      const zotero = Zotero as unknown as {
        getMainWindows: () => unknown[];
      };
      const original = zotero.getMainWindows;
      zotero.getMainWindows = () => [{ ZoteroPane: { itemsView: view } }];
      try {
        return await body();
      } finally {
        zotero.getMainWindows = original;
      }
    }

    it("repaints only the rows it is given", function () {
      const { view, entries, invalidatedRows, allInvalidated } = liveView();

      withView(view, async () => {
        repaintRows([11]);
        return undefined;
      });

      assert.deepEqual(invalidatedRows, [0], "only row 0 was invalidated");
      assert.equal(allInvalidated(), 0, "no full repaint");
      assert.notProperty(entries, "11", "the row's value is dropped");
      assert.property(entries, "12", "the other row keeps its value");
    });

    it("falls back to a full repaint when the tree cannot do one row", function () {
      const { view, invalidatedRows, allInvalidated } = liveView();
      // Zotero 7's tree has no `invalidateRow`.
      delete (view.tree as { invalidateRow?: unknown }).invalidateRow;

      withView(view, async () => {
        repaintRows([11, 12]);
        return undefined;
      });

      assert.deepEqual(invalidatedRows, []);
      assert.equal(allInvalidated(), 1);
    });

    it("refreshes one item without touching the other rows", async function () {
      // Reported: "我只选中了单条，但是你所有的条目一起刷新了". A refresh
      // repainted every row, and a row with no count of its own starts a read
      // the moment it is asked for its value - so one refresh read the whole
      // list. Only the refreshed item's row may be invalidated.
      const first = new Zotero.Item("journalArticle");
      first.libraryID = Zotero.Libraries.userLibraryID;
      first.setField("title", "AlphaLikes repaint probe (refreshed)");
      first.setField(
        "extra",
        upsertLikesCache("alphaxiv_arxiv_id: 2401.00009", 5),
      );
      await first.saveTx();

      const { view, invalidatedRows, allInvalidated } = liveView(first.id);

      try {
        await withView(view, () =>
          getService().refreshItems([Zotero.Items.get(first.id)]),
        );

        assert.equal(
          allInvalidated(),
          0,
          "a refresh must not repaint the list",
        );
        assert.isTrue(invalidatedRows.length > 0, "the refreshed row repaints");
        assert.deepEqual(
          [...new Set(invalidatedRows)],
          [0],
          "the refreshed item's row is the only one invalidated - the rows " +
            "next to it keep their values and are never asked for a new one",
        );
      } finally {
        try {
          await first.eraseTx();
        } catch {
          // The library may already be gone when the run tears down.
        }
      }
    });
  });
});
