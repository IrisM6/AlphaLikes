/**
 * The two ways a Google Scholar page is read.
 *
 * The reported bug: the same search, on the same machine, with the same
 * cookies, opens in a browser and comes back `429` to the plugin. What differs
 * is the client - a navigation versus an XMLHttpRequest - so the read now has
 * two paths, tries the browser one first, falls back to the request, and
 * remembers whichever answered.
 *
 * The decision logic is tested with an injected loader and an injected
 * transport. The loader itself is then tested against Zotero's real hidden
 * browser and a page served from this machine: that is what proves the module
 * this fix depends on exists and behaves the same on Zotero 7, 8, 9 and 10.
 */

import { assert } from "chai";
import {
  geckoMajorVersion,
  matchGeckoVersion,
  PacedRequester,
  type HttpTransport,
} from "../src/modules/http";
import { createPageLoader, hiddenBrowserClass } from "../src/modules/page";

const SEARCH_URL =
  "https://scholar.google.com/scholar?hl=en&as_sdt=0,5&q=probe";

/**
 * No waiting at all.
 *
 * These tests send several Scholar reads back to back, which is the one thing
 * the production rhythm exists to prevent; the pacing itself has its own tests.
 */
const NO_PACING = {
  intervalMinMs: 0,
  intervalMaxMs: 0,
  dwellMinMs: 0,
  dwellMaxMs: 0,
  batchMin: 1,
  batchMax: 1,
  pauseMinMs: 0,
  pauseMaxMs: 0,
};

interface Captured {
  method: string;
  url: string;
  options: Record<string, unknown>;
}

function transportStub(reply: { status: number; response?: string }): {
  captured: Captured[];
  transport: HttpTransport;
} {
  const captured: Captured[] = [];
  return {
    captured,
    transport: async (method, url, options) => {
      captured.push({ method, url, options });
      return reply;
    },
  };
}

function loaderStub(reply: {
  status: number | null;
  html?: string;
  error?: string | null;
}): {
  calls: string[];
  loader: (url: string) => Promise<{
    status: number | null;
    html: string;
    error: string | null;
  }>;
} {
  const calls: string[] = [];
  return {
    calls,
    loader: async (url: string) => {
      calls.push(url);
      return {
        status: reply.status,
        html: reply.html ?? "",
        error: reply.error ?? null,
      };
    },
  };
}

/** Only the search requests: the session's opening request is not one. */
function searches(captured: Captured[]): Captured[] {
  return captured.filter((call) => call.url === SEARCH_URL);
}

function makeRequester(options: {
  transport: HttpTransport;
  loader: (url: string) => Promise<{
    status: number | null;
    html: string;
    error: string | null;
  }>;
}): PacedRequester {
  return new PacedRequester({
    timeoutMs: 5_000,
    intervalMs: 0,
    // Two Scholar reads inside one session are the point of these tests.
    scholarPacing: NO_PACING,
    transport: options.transport,
    pageLoader: options.loader,
  });
}

describe("the Scholar page read", function () {
  describe("choosing between the two paths", function () {
    it("opens the page as a browser first, without also sending the request", async function () {
      const transport = transportStub({
        status: 200,
        response: "request body",
      });
      const loader = loaderStub({
        status: 200,
        html: "<html><body>Cited by 42</body></html>",
      });
      const requester = makeRequester({
        transport: transport.transport,
        loader: loader.loader,
      });

      const page = await requester.requestScholarPage(SEARCH_URL);

      assert.equal(page.via, "browser");
      assert.include(page.body, "Cited by 42");
      assert.lengthOf(
        searches(transport.captured),
        0,
        "a page that loads must not cost a second request",
      );
      assert.deepEqual(loader.calls, [SEARCH_URL]);
      assert.equal(requester.scholarReadPath(), "browser");
    });

    it("falls back to the request when no page can be opened, and remembers that", async function () {
      const transport = transportStub({ status: 200, response: "Cited by 7" });
      const loader = loaderStub({
        status: null,
        error: "没有可用的浏览器组件",
      });
      const requester = makeRequester({
        transport: transport.transport,
        loader: loader.loader,
      });

      const first = await requester.requestScholarPage(SEARCH_URL);
      assert.equal(first.via, "xhr");
      assert.include(first.body, "Cited by 7");
      assert.equal(requester.scholarReadPath(), "xhr");

      // The path that answered is tried first from then on, so a session does
      // not pay for a browser that is not going to work every single time.
      await requester.requestScholarPage(SEARCH_URL);
      assert.lengthOf(searches(transport.captured), 2);
      assert.lengthOf(loader.calls, 1, "the browser path is not retried");
    });

    it("sends both paths when the diagnostic asks for the comparison", async function () {
      const transport = transportStub({ status: 429, response: "sorry" });
      const loader = loaderStub({
        status: 200,
        html: "<html><body>Cited by 11</body></html>",
      });
      const requester = makeRequester({
        transport: transport.transport,
        loader: loader.loader,
      });

      const page = await requester.requestScholarPage(SEARCH_URL, {
        compare: true,
      });

      assert.equal(page.via, "browser");
      assert.lengthOf(page.attempts, 2);
      assert.deepEqual(
        page.attempts.map((attempt) => attempt.via),
        ["browser", "xhr"],
      );
      assert.equal(page.attempts[0].status, 200);
      assert.equal(page.attempts[1].status, 429);
      assert.lengthOf(
        searches(transport.captured),
        1,
        "the refusal is recorded, not hidden",
      );
    });

    it("keeps a refusal's status, so the wait it books says which kind it is", async function () {
      const transport = transportStub({ status: 429, response: "sorry" });
      const loader = loaderStub({
        status: 429,
        html: "<html><body>unusual traffic</body></html>",
      });
      const requester = makeRequester({
        transport: transport.transport,
        loader: loader.loader,
      });

      // The diagnostic asks for both paths; a refusal page arrives on both, and
      // the status of each has to survive into the report.
      const page = await requester.requestScholarPage(SEARCH_URL, {
        compare: true,
      });

      assert.lengthOf(page.attempts, 2);
      assert.equal(page.attempts[0].status, 429);
      assert.equal(page.attempts[1].status, 429);
      assert.include(page.attempts[0].bodyHead, "unusual traffic");
      assert.equal(
        page.status,
        429,
        "a 429 must reach the block logic as a 429, not as a page",
      );
    });

    it("stops at the first path that answers", async function () {
      const transport = transportStub({
        status: 200,
        response: "second answer",
      });
      const loader = loaderStub({
        status: 429,
        html: "<html><body>unusual traffic</body></html>",
      });
      const requester = makeRequester({
        transport: transport.transport,
        loader: loader.loader,
      });

      const page = await requester.requestScholarPage(SEARCH_URL);

      assert.lengthOf(page.attempts, 1);
      assert.equal(page.attempts[0].via, "browser");
      assert.lengthOf(
        searches(transport.captured),
        0,
        "a refused page is still an answer: the request is not sent on top of it",
      );
    });

    it("counts an answer that arrived without a reported status", async function () {
      // Zotero's page-data actor does not always keep the response status by the
      // time the document can be read; the document that arrived is still the
      // site's answer, and its content says what it is.
      const transport = transportStub({
        status: 200,
        response: "should not be used",
      });
      const loader = loaderStub({
        status: null,
        html: "<html><body>Cited by 5</body></html>",
      });
      const requester = makeRequester({
        transport: transport.transport,
        loader: loader.loader,
      });

      const page = await requester.requestScholarPage(SEARCH_URL);

      assert.equal(page.via, "browser");
      assert.equal(page.status, 200);
      assert.include(page.body, "Cited by 5");
      assert.lengthOf(searches(transport.captured), 0);
    });

    it("keeps a refusal rather than a transport error when neither answered", async function () {
      const transport = transportStub({ status: 403, response: "captcha" });
      const loader = loaderStub({ status: null, error: "打开页面超时" });
      const requester = makeRequester({
        transport: transport.transport,
        loader: loader.loader,
      });

      const page = await requester.requestScholarPage(SEARCH_URL);

      assert.equal(
        page.status,
        403,
        "a status that says the site answered must win over one that says nothing did",
      );
    });

    it("does not mistake an empty page for an answer", async function () {
      const transport = transportStub({ status: 200, response: "Cited by 3" });
      const loader = loaderStub({ status: 200, html: "" });
      const requester = makeRequester({
        transport: transport.transport,
        loader: loader.loader,
      });

      const page = await requester.requestScholarPage(SEARCH_URL);

      assert.equal(page.via, "xhr");
      assert.include(page.body, "Cited by 3");
    });
  });

  describe("sharing the network between the two reads", function () {
    it("does not make a like count wait for a Scholar read", async function () {
      // The reported behaviour: the like column sat on its loading marker
      // while a citation lookup finished. They are two different sites, and a
      // Google read is the slowest thing the plugin does, so the two queue
      // separately - that is the whole point of this test.
      const started: string[] = [];
      let releaseScholar: (() => void) | null = null;
      const scholarHeld = new Promise<void>((resolve) => {
        releaseScholar = resolve;
      });

      const transport: HttpTransport = async (_method, url) => {
        started.push(url);
        if (url.includes("scholar.google.com/scholar")) await scholarHeld;
        return { status: 200, response: "<html><body></body></html>" };
      };
      // No hidden browser in this test: the Scholar read falls through to the
      // request, which is the path being held open.
      const loader = loaderStub({
        status: null,
        error: "没有可用的浏览器组件",
      });
      const requester = makeRequester({
        transport,
        loader: loader.loader,
      });

      const scholar = requester.requestScholarPage(SEARCH_URL, {
        compare: true,
      });

      // Wait until the Scholar read is actually inside its request, so the
      // order below cannot pass by accident.
      while (!started.some((url) => url.includes("/scholar"))) {
        await Zotero.Promise.delay(20);
      }

      const page = await requester.requestPage(
        "https://www.alphaxiv.org/abs/1706.03762",
      );

      assert.equal(page.status, 200);
      assert.include(
        started.join(" "),
        "alphaxiv.org",
        "the alphaXiv read has to go out while Scholar is still waiting",
      );
      assert.isFalse(
        started.filter((url) => url.includes("alphaxiv.org")).length > 1,
        "and only once",
      );

      releaseScholar?.();
      await scholar;
    });

    it("still paces reads of the same host", async function () {
      // Independent queues must not mean "no pacing": arXiv asks for three
      // seconds between calls, and that is per host, not per queue.
      const sent: number[] = [];
      const transport: HttpTransport = async (_method, url) => {
        if (url.includes("arxiv.org")) sent.push(Date.now());
        return { status: 200, response: "<feed></feed>" };
      };
      const requester = new PacedRequester({
        timeoutMs: 5_000,
        intervalMs: 0,
        transport,
        pageLoader: loaderStub({ status: null, error: "unused" }).loader,
      });

      const first = requester.requestText(
        "https://export.arxiv.org/api/query?search_query=all:one",
      );
      const second = requester.requestText(
        "https://export.arxiv.org/api/query?search_query=all:two",
      );
      await Promise.all([first, second]);

      assert.lengthOf(sent, 2);
      assert.isAtLeast(
        sent[1] - sent[0],
        2_900,
        "the second arXiv call has to wait out the three second rule",
      );
    });
  });

  describe("the User-Agent sent to Google", function () {
    it("names the engine this Zotero actually runs", function () {
      const major = geckoMajorVersion();
      assert.isNumber(major);

      const rewritten = matchGeckoVersion(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:42.0) Gecko/20100101 Firefox/42.0",
        major,
      );
      assert.include(rewritten, `rv:${major}.0`);
      assert.include(rewritten, `Firefox/${major}.0`);
      assert.notInclude(
        rewritten,
        "42.0",
        "an engine version the client is not running is itself a signal",
      );
      assert.include(
        rewritten,
        "Windows NT 10.0; Win64; x64",
        "everything but the version is left as the platform reported it",
      );
    });

    it("leaves a version that cannot be trusted alone", function () {
      const agent =
        "Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0";
      assert.equal(matchGeckoVersion(agent, null), agent);
      assert.equal(matchGeckoVersion(agent, 7), agent);
    });
  });

  describe("Zotero's hidden browser", function () {
    it("is available on this version", function () {
      const resolved = hiddenBrowserClass();
      assert.isFunction(
        resolved.constructor,
        `HiddenBrowser 不可用：${resolved.error ?? "原因未知"}`,
      );
    });

    it("opens a page, JavaScript and all, and hands the document back", async function () {
      // The page writes its content with a script: a plain request would fetch it
      // as text, but only a browser runs it. That is the difference this path
      // exists for - and it proves the whole chain works on this Zotero version:
      // the module, the hidden browser, the navigation, the document read.
      const path = "/tmp/alphalikes-loader-probe.html";
      const html =
        "<html><head><title>AlphaLikes probe</title></head><body>" +
        "<div id='out'></div>" +
        "<script>document.getElementById('out').textContent = 'Cited by 42';</script>" +
        "</body></html>";
      await Zotero.File.putContentsAsync(
        Zotero.File.pathToFile(path) as never,
        html,
      );

      const loader = createPageLoader();
      const result = await loader(path, 8_000);

      assert.isNull(result.error);
      assert.include(
        result.html,
        "Cited by 42",
        "the script has to have run: that is what a browser adds",
      );
      assert.isTrue(
        result.status === null || result.status === 200,
        `the status is reported when Zotero has it: ${result.status}`,
      );
    });
  });
});
