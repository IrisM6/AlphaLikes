/**
 * The plugin's one menu entry.
 *
 * Reported: the plugin was five context-menu lines with no heading, so nothing
 * on the right-click said they were one plugin, and the pages the numbers come
 * from were three clicks away in a browser. What is asserted here is the shape
 * the user sees: an entry with an icon and the plugin's name, the actions
 * inside it, and a second host so the entry can also be found in the Tools
 * menu - where a plugin is normally looked for, and where it exists even with
 * nothing selected.
 */

import { assert } from "chai";
import {
  describeScholarActivity,
  menuVisibility,
  registerItemMenu,
  unregisterItemMenu,
} from "../src/modules/menu";
import { t } from "../src/modules/l10n";
import { getService } from "../src/modules/column";

const MENU_ID = "alphalikes-menu";
const TOOLS_MENU_ID = "alphalikes-tools-menu";

/** The parts of Zotero's main window this file touches. */
interface MainWindowish {
  document: Document;
  ZoteroPane?: {
    getSelectedItems?: () => Zotero.Item[];
  };
}

describe("the plugin menu", function () {
  const win = () => Zotero.getMainWindow() as unknown as MainWindowish;
  const doc = () => win().document;
  /** The main window as the menu code wants it. */
  /** The main window as the menu code takes it. */
  const host = () => win() as unknown as Parameters<typeof registerItemMenu>[0];

  /**
   * The entries directly inside a popup.
   *
   * Direct children on purpose: the actions now live in a submenu, and a
   * descendant query would find them there and report the old shape as still
   * present no matter where they were put.
   */
  function itemsIn(popup: Element): Array<{ id: string; label: string }> {
    return Array.from(popup.children)
      .filter((child) => child.tagName.toLowerCase() === "menuitem")
      .map((item) => ({
        id: item.getAttribute("id") ?? "",
        label: item.getAttribute("label") ?? "",
      }));
  }

  before(function () {
    registerItemMenu(host());
  });

  after(function () {
    unregisterItemMenu(host());
  });

  it("is one entry with an icon and the plugin's name", function () {
    const menu = doc().getElementById(MENU_ID);
    assert.isOk(menu, "the item menu has no plugin entry");
    assert.equal(
      menu?.getAttribute("label"),
      "AlphaPulse",
      "the entry has to carry the plugin's name, not a feature's",
    );

    const style = menu?.getAttribute("style") ?? "";
    const image = menu?.getAttribute("image") ?? "";
    assert.include(
      `${style} ${image}`,
      "icons/favicon.png",
      "the entry has to draw the plugin's icon",
    );
  });

  it("holds every action, and nothing is left in the menu's top level", function () {
    const popup = doc().getElementById("alphalikes-menu-popup");
    assert.isOk(popup, "the entry has no popup of its own");

    const ids = itemsIn(popup as Element).map((item) => item.id);
    for (const id of [
      "alphalikes-refresh-likes",
      "alphalikes-refresh-citations",
      "alphalikes-open-alphaxiv",
      "alphalikes-open-scholar",
      "alphalikes-manual-citations",
      "alphalikes-clear-data",
    ]) {
      assert.include(ids, id, `${id} is missing from the plugin menu`);
    }

    // The line about this session's reading is an entry of its own, and it is
    // not an action: it answers "is it working?" and cannot be clicked.
    assert.include(ids, "alphalikes-activity", "the reading status is missing");
    const activity = doc().getElementById("alphalikes-activity");
    assert.isTrue(
      activity?.hasAttribute("disabled"),
      "the status line must not look like something to click",
    );

    // The old shape: the five entries sitting directly in the context menu.
    const itemMenu = doc().getElementById("zotero-itemmenu");
    for (const item of itemsIn(itemMenu as Element)) {
      assert.notInclude(
        [
          "alphalikes-refresh-likes",
          "alphalikes-refresh-citations",
          "alphalikes-open-alphaxiv",
          "alphalikes-open-scholar",
          "alphalikes-manual-citations",
          "alphalikes-clear-data",
        ],
        item.id,
        "an action is still registered at the menu's top level",
      );
    }
  });

  it("is in the Tools menu as well, for when nothing is selected", function () {
    const menu = doc().getElementById(TOOLS_MENU_ID);
    assert.isOk(menu, "the Tools menu does not offer the plugin");
    assert.equal(menu?.getAttribute("label"), "AlphaPulse");

    const popup = doc().getElementById("alphalikes-tools-popup");
    const ids = itemsIn(popup as Element).map((item) => item.id);
    assert.include(
      ids,
      "alphalikes-clear-data",
      "the Tools-menu entry is not the same set of actions",
    );
  });

  it("offers to open the paper's alphaXiv page once it has an ID", async function () {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "AlphaPulse menu probe paper");
    item.setField("date", "2026-09-22");
    item.setField("url", "https://arxiv.org/abs/2401.00031");
    await item.saveTx();

    try {
      const saved = Zotero.Items.get(item.id);
      assert.equal(
        getService().alphaXivPageURL(saved),
        "https://www.alphaxiv.org/abs/2401.00031",
        "the action has to point at the paper's own page",
      );

      // No arXiv ID, no page: the entry hides itself rather than opening the
      // site's front page.
      const plain = new Zotero.Item("journalArticle");
      plain.libraryID = Zotero.Libraries.userLibraryID;
      plain.setField("title", "AlphaPulse menu probe paper without an ID");
      await plain.saveTx();
      try {
        assert.isNull(getService().alphaXivPageURL(Zotero.Items.get(plain.id)));
      } finally {
        await plain.eraseTx();
      }
    } finally {
      await item.eraseTx();
    }
  });

  it("decides each entry from the selection and the sources", function () {
    // The rule is a pure function so it can be read and tested without a live
    // popup: a test that dispatches `popupshowing` cannot tell this module's
    // handler from another copy of it, which is one module instance per bundle
    // - and the rule is what determines what a user sees.
    const open = menuVisibility({
      count: 1,
      citationsEnabled: true,
      findsScholar: true,
      openableAlphaXiv: true,
    });
    assert.deepEqual(open, {
      entry: true,
      refresh: true,
      refreshCitations: true,
      openAlphaXiv: true,
      openScholar: true,
      manualCitations: true,
      clear: true,
    });

    // Google Scholar is the only source that can ask the visitor to prove they
    // are human, so its two entries leave with it.
    const otherSource = menuVisibility({
      count: 1,
      citationsEnabled: true,
      findsScholar: false,
      openableAlphaXiv: false,
    });
    assert.isFalse(otherSource.openScholar);
    assert.isFalse(
      otherSource.openAlphaXiv,
      "a paper with no arXiv ID has no alphaXiv page to open",
    );
    assert.isTrue(otherSource.refresh, "the likes column still reads");

    // One number belongs to one row: with two rows selected there is no single
    // item the typed count would be writing to.
    const twoRows = menuVisibility({
      count: 2,
      citationsEnabled: true,
      findsScholar: true,
      openableAlphaXiv: true,
    });
    assert.isFalse(
      twoRows.manualCitations,
      "a typed citation count is offered for one row at a time",
    );

    // And it is a citation entry, so it leaves with the Citations column.
    const noCitations = menuVisibility({
      count: 1,
      citationsEnabled: false,
      findsScholar: true,
      openableAlphaXiv: true,
    });
    assert.isFalse(noCitations.manualCitations);

    // Nothing selected: the whole entry goes, because a read action with no
    // rows has nothing to act on.
    const nothingSelected = menuVisibility({
      count: 0,
      citationsEnabled: true,
      findsScholar: true,
      openableAlphaXiv: false,
    });
    assert.isFalse(nothingSelected.entry);
    assert.isFalse(nothingSelected.clear);
    // Opening the Scholar page stays: it is about the session, not about a row.
    assert.isTrue(nothingSelected.openScholar);

    // Citations column off: the citation entries leave with it.
    const citationsOff = menuVisibility({
      count: 2,
      citationsEnabled: false,
      findsScholar: true,
      openableAlphaXiv: true,
    });
    assert.isFalse(citationsOff.refreshCitations);
    assert.isFalse(citationsOff.openScholar);
    assert.isTrue(citationsOff.refresh, "the likes column is not affected");
  });

  it("says what the session has read, and what it waits for", function () {
    // A quiet column and a stopped plugin look the same; this line answers the
    // question without the user opening the settings. The wording follows what
    // is true: minutes once the wait is long, seconds while it is short, and a
    // plain "nothing yet" for a session that has not read anything.
    assert.equal(
      describeScholarActivity({ requests: 0, nextInMs: 0 }),
      t("menu-activity-idle"),
      "a session that has read nothing says so",
    );

    const waiting = describeScholarActivity({ requests: 3, nextInMs: 4_000 });
    assert.include(waiting, "3", "the count is in the line");
    assert.include(waiting, "4", "and the wait, in seconds while it is short");

    const resting = describeScholarActivity({
      requests: 12,
      nextInMs: 6 * 60_000,
    });
    assert.include(resting, "12", "the count is still there");
    assert.include(resting, "6", "and the wait in minutes once it is long");

    assert.equal(
      describeScholarActivity({ requests: 1, nextInMs: 0 }),
      t("menu-activity", { count: "1", wait: t("menu-activity-now") }),
      "a read that is due now says so rather than counting down from zero",
    );
  });

  it("takes every entry back out on shutdown", function () {
    unregisterItemMenu(host());
    for (const id of [
      MENU_ID,
      "alphalikes-menu-popup",
      TOOLS_MENU_ID,
      "alphalikes-tools-popup",
      "alphalikes-refresh-likes",
      "alphalikes-activity",
      "alphalikes-manual-citations",
    ]) {
      assert.isNull(doc().getElementById(id), `${id} survived the teardown`);
    }
    registerItemMenu(host());
  });
});
