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
import { dropRowCache, type ItemTreeView } from "../src/modules/service";
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
});
