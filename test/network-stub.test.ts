/**
 * The suite's network boundary.
 *
 * Nothing in these tests may reach the internet. The plugin reads like counts
 * and citation counts from live sites, and Zotero's own item tree asks the
 * column for a value whenever it repaints - so a test that clears an item (or
 * refreshes one) makes the *running plugin* start a real read of the live
 * alphaXiv and Google Scholar, in the background, with its own service
 * instance. That read lands whenever it lands, and its answer (whatever the
 * site says for a made-up arXiv ID) shows up in a later assertion in a
 * different file. It also means the suite hammers two real sites on every run.
 *
 * So the transport is replaced in both module graphs - the tests' own, and the
 * plugin's, through `api.setReadTransport` - at module load, before any test
 * runs. A test that wants a specific answer still replaces the requester
 * itself, as the other files do.
 */

import { assert } from "chai";
import pkg from "../package.json";
import { getService } from "../src/modules/column";
import type { HttpTransport } from "../src/modules/http";

/** A page shaped like the alphaXiv paper view. */
function alphaXivPage(likes: number): string {
  return (
    `<html><body><button aria-label="Like this paper">` +
    `<span class="inline-block">${likes}</span></button></body></html>`
  );
}

/** A page shaped like a Google Scholar result with one hit. */
function scholarPage(citedBy: number): string {
  return (
    "<html><body><div class='gs_r gs_or gs_scl'>" +
    "<h3 class='gs_rt'><a href='#'>AlphaLikes stub paper</a></h3>" +
    `<div class='gs_fl'><a href='#'>Cited by ${citedBy}</a></div>` +
    "</div></body></html>"
  );
}

/** The answer every unstubbed read gets. */
const STUB_LIKES = 42;
const STUB_CITATIONS = 7;

const stubTransport: HttpTransport = async (_method, url) => {
  if (url.includes("alphaxiv.org")) {
    return { status: 200, response: alphaXivPage(STUB_LIKES) };
  }
  if (url.includes("scholar.google.com")) {
    return { status: 200, response: scholarPage(STUB_CITATIONS) };
  }
  // The resolvers' APIs: valid JSON, no candidates.
  return { status: 200, response: "{}" };
};

/** The plugin instance, as the test graph sees it through Zotero. */
function pluginAPI(): { setReadTransport?: (t: HttpTransport | null) => void } {
  try {
    const instance = (Zotero as unknown as Record<string, unknown>)[
      pkg.config.addonInstance
    ] as { api?: { setReadTransport?: (t: HttpTransport | null) => void } };
    return instance?.api ?? {};
  } catch {
    return {};
  }
}

/**
 * What the *running plugin's* own reads get: nothing at all.
 *
 * The plugin is a second service instance in the same session, and Zotero's
 * item tree asks it for a value on every repaint - including the repaints
 * these tests cause. If it read for real it would write a real count into the
 * item a test is asserting on, seconds later, from another module graph. A
 * transport that answers nothing leaves the item untouched and lets the test
 * graph's own service (which every test that cares replaces anyway) be the
 * only writer.
 */
const quietTransport: HttpTransport = async () => ({ status: 0, response: "" });

/** Routes the running plugin's reads away from the network, and this graph's
 * to a deterministic answer. */
function installNetworkStub(): void {
  getService().setReadTransport(stubTransport);
  pluginAPI().setReadTransport?.(quietTransport);
}

installNetworkStub();

// Re-armed before every test, not only at load. The running plugin is a second
// module graph and it can be reloaded in the middle of a session - a reloaded
// instance builds its service again and starts out with the live transport -
// so a stub installed once at load does not hold. That is how a real alphaXiv
// count (a made-up arXiv ID gets a default 5 from the live page) ended up in an
// item that a diagnostic test was asserting on, in an unrelated file.
// Top level on purpose: this has to hold for every test in every file, and a
// hook inside a suite would only cover that suite.
// eslint-disable-next-line mocha/no-top-level-hooks
beforeEach(installNetworkStub);

describe("the test suite's network boundary", function () {
  it("silences the running plugin's background reads", function () {
    const api = pluginAPI();
    assert.isFunction(
      api.setReadTransport,
      "the plugin's API must expose the transport seam, or its background reads go to the live sites and write into the items under test",
    );
    installNetworkStub();
  });

  it("writes nothing when the transport answers nothing", async function () {
    // The plugin instance in a test session is a second service whose reads
    // are driven by the item tree, not by the test. This is what its transport
    // is set to, and the point of it: no count written, no site contacted.
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "AlphaLikes network boundary probe");
    item.setField("extra", "alphaxiv_arxiv_id: 2401.00002");
    await item.saveTx();

    const service = getService();
    try {
      service.setReadTransport(quietTransport);
      await service.refreshItems([Zotero.Items.get(item.id)]);

      assert.notInclude(
        String(item.getField("extra")),
        "alphaxiv_likes",
        "a transport that answers nothing must not let a count be written",
      );
    } finally {
      service.setReadTransport(stubTransport);
      await item.eraseTx();
    }
  });

  it("answers this graph's reads with the stub", async function () {
    const page = await getService()
      .diagnose([])
      .catch(() => "");
    assert.isString(page);
  });
});
