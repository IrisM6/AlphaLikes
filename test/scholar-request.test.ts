/**
 * What the plugin actually sends to Google Scholar.
 *
 * The reported bug: every Scholar read failed, while opening the verification
 * page in a browser on the same machine was fine. Scholar refuses an agent it
 * does not recognise - the plugin used to announce itself as `AlphaLikes/<version>`,
 * which is exactly the kind of client a block page is reserved for - and from
 * inside the EU it answers without results unless Google's consent cookie is
 * stored first.
 *
 * The assertions are about the request itself, because Google's own answer
 * cannot be asserted from an automated run: this machine is hard-blocked and
 * gets the "sorry" page whatever it sends. That is also the second half of the
 * fix - a refusal is now recognised as the human check instead of surfacing as
 * a broken read.
 */

import { assert } from "chai";
import {
  clearGoogleCookies,
  consentExpiry,
  countsExpiryInMilliseconds,
  ensureGoogleConsent,
  geckoMajorVersion,
  isGoogleCookieHost,
  isGoogleHost,
  usePlainUserAgentFor,
  PacedRequester,
  userAgentFor,
  type HttpTransport,
} from "../src/modules/http";

interface Captured {
  method: string;
  url: string;
  options: Record<string, unknown>;
}

/**
 * No waiting at all.
 *
 * These tests send several Scholar reads back to back, which is the one thing
 * the production rhythm exists to prevent; the pacing itself has its own tests.
 */
const NO_PACING = {
  intervalMinMs: 0,
  intervalMaxMs: 0,
  dwellMs: 0,
  batchMin: 1,
  batchMax: 1,
  pauseMinMs: 0,
  pauseMaxMs: 0,
};

function stubTransport(reply: { status: number; response?: string }): {
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

/** Whether Google's consent cookie reached Zotero's own cookie jar. */
function consentCookieStored(): boolean {
  const cookies = Services.cookies.getCookiesFromHost(
    "scholar.google.com",
    {},
  ) as unknown as Array<{ name: string; value: string }>;

  return cookies.some(
    (cookie) => cookie.name === "SOCS" && cookie.value === "CAI",
  );
}

/**
 * The headers of the request the caller actually asked for.
 *
 * A Google request is now made in two steps - the opening request first, then
 * the search - so the interesting one is the last.
 */
function headersOf(captured: Captured[]): Record<string, string> {
  return (captured[captured.length - 1]?.options.headers ?? {}) as Record<
    string,
    string
  >;
}

describe("the Google Scholar request", function () {
  it("sends the headers of a navigation, not of a bare request", async function () {
    const { captured, transport } = stubTransport({
      status: 200,
      response: "<html><body></body></html>",
    });
    const requester = new PacedRequester({
      timeoutMs: 5_000,
      intervalMs: 0,
      scholarPacing: NO_PACING,
      transport,
    });

    await requester.requestPage(
      "https://scholar.google.com/scholar?hl=en&as_sdt=0,5&q=probe",
      "text/html,application/xhtml+xml",
    );

    const search = headersOf(captured);
    assert.equal(search["Sec-Fetch-Mode"], "navigate");
    assert.equal(search["Sec-Fetch-Dest"], "document");
    assert.equal(search["Sec-Fetch-Site"], "same-origin");
    assert.equal(search["Upgrade-Insecure-Requests"], "1");
    assert.equal(
      search.Referer,
      "https://scholar.google.com/",
      "a search follows the site's own front page, and says so",
    );

    // The site's opening request is the first navigation of the session: it
    // was referred by nothing.
    const opening = captured[0].options.headers as Record<string, string>;
    assert.equal(opening["Sec-Fetch-Site"], "none");
    assert.notProperty(opening, "Referer");
  });

  it("keeps the application's own name out of the request", async function () {
    const { captured, transport } = stubTransport({
      status: 200,
      response: "<html><body></body></html>",
    });
    const requester = new PacedRequester({
      timeoutMs: 5_000,
      intervalMs: 0,
      scholarPacing: NO_PACING,
      transport,
    });

    await requester.requestPage(
      "https://scholar.google.com/scholar?hl=en&as_sdt=0,5&q=probe",
      "text/html,application/xhtml+xml",
    );

    const agent = headersOf(captured)["User-Agent"];
    assert.notInclude(
      agent,
      "Zotero/",
      "every Zotero request carries Zotero/<version> unless the host is " +
        "registered otherwise, and that suffix is exactly what a site that " +
        'screens clients reads as "not a browser"',
    );
    assert.match(agent, /Firefox\/\d+\.0/);

    // Zotero's own mechanism, and the reason for registering at all: it also
    // covers the requests this plugin does not make itself - the hidden
    // browser's navigation among them.
    // Zotero's own mechanism, where the build has one: registering the host
    // also covers requests this plugin does not make itself, the hidden
    // browser's navigation among them. Zotero 7 has no such registry - its
    // observer rewrites the application token out of whatever it sends, and
    // the agent above already has none - so the check is that registering is
    // available and does not throw, not that a particular build keeps a Set.
    const versionHeader = (
      Zotero as unknown as {
        VersionHeader?: {
          _plainUAHosts?: Set<string>;
          registerPlainUAHost?: (host: string) => void;
        };
      }
    ).VersionHeader;
    assert.isOk(versionHeader, "Zotero exposes VersionHeader");

    if (versionHeader?._plainUAHosts) {
      assert.isTrue(
        versionHeader._plainUAHosts.has("scholar.google.com"),
        "the Scholar host is registered for the plain user agent",
      );
    } else {
      assert.doesNotThrow(() => usePlainUserAgentFor("scholar.google.com"));
    }
  });

  it("looks like the browser next to it, and brings the consent cookie", async function () {
    const { captured, transport } = stubTransport({
      status: 200,
      response: "<html><body></body></html>",
    });
    const requester = new PacedRequester({
      timeoutMs: 5_000,
      intervalMs: 0,
      scholarPacing: NO_PACING,
      transport,
    });

    await requester.requestPage(
      "https://scholar.google.com/scholar?hl=en&q=probe",
      "text/html,application/xhtml+xml",
    );

    const headers = headersOf(captured);
    const agent = headers["User-Agent"] ?? "";
    assert.match(
      agent,
      /Firefox\//,
      "Scholar needs a browser agent: this plugin's own name is what the " +
        "block page is reserved for",
    );
    assert.notInclude(agent, "AlphaLikes");
    assert.isTrue(
      String(headers["Accept-Language"] ?? "").startsWith("en"),
      "the page is requested in English, the language the parser expects",
    );
    assert.isTrue(
      consentCookieStored(),
      "without SOCS=CAI an EU visitor is answered with the consent page",
    );
  });

  it("opens Scholar's front page once per session, the way a browser does", async function () {
    // Google answers a search that arrives with a cold cookie jar with
    // "unusual traffic". A browser reaches a search page by way of the site,
    // so the plugin makes the same opening request and keeps whatever cookies
    // come back - Zotero's requests share the application's own cookie jar.
    const { captured, transport } = stubTransport({
      status: 200,
      response: "<html><body>scholar</body></html>",
    });
    const requester = new PacedRequester({
      timeoutMs: 5_000,
      intervalMs: 0,
      scholarPacing: NO_PACING,
      transport,
    });

    await requester.requestPage(
      "https://scholar.google.com/scholar?hl=en&q=one",
      "text/html,application/xhtml+xml",
    );

    assert.equal(
      captured[0]?.url,
      "https://scholar.google.com/",
      "the first Google request of a session has to be the site itself",
    );
    assert.lengthOf(captured, 2, "the search follows the opening request");
    assert.equal(requester.sessionWarmup()?.status, 200);

    await requester.requestPage(
      "https://scholar.google.com/scholar?hl=en&q=two",
      "text/html,application/xhtml+xml",
    );

    assert.equal(
      captured.filter(
        (request) => request.url === "https://scholar.google.com/",
      ).length,
      1,
      "the opening request belongs to the session, not to every search",
    );
  });

  it("records what the opening request answered, even when it was refused", async function () {
    // This is the diagnostic's key discriminator: if the front page is limited
    // too, waiting is the only thing that helps, and the report says so.
    const { captured, transport } = stubTransport({
      status: 429,
      response: "<html><title>Sorry</title></html>",
    });
    const requester = new PacedRequester({
      timeoutMs: 5_000,
      intervalMs: 0,
      scholarPacing: NO_PACING,
      transport,
    });

    const page = await requester.requestPage(
      "https://scholar.google.com/scholar?hl=en&q=one",
    );

    assert.lengthOf(captured, 2);
    assert.equal(requester.sessionWarmup()?.status, 429);
    assert.equal(
      page.status,
      429,
      "the search's own answer is still the one that is returned",
    );
  });

  it("leaves the APIs alone: only Google gets the opening request", async function () {
    const { captured, transport } = stubTransport({
      status: 200,
      response: "{}",
    });
    const requester = new PacedRequester({
      timeoutMs: 5_000,
      intervalMs: 0,
      scholarPacing: NO_PACING,
      transport,
    });

    await requester.requestPage("https://api.openalex.org/works/doi:10.1234/x");

    assert.lengthOf(captured, 1);
    assert.equal(
      captured[0]?.url,
      "https://api.openalex.org/works/doi:10.1234/x",
    );
    assert.isNull(requester.sessionWarmup());
  });

  it("names this plugin to the APIs, which ask for a contactable agent", function () {
    const agent = userAgentFor("api.openalex.org");
    assert.include(agent, "AlphaLikes");
    assert.notInclude(agent, "Mozilla");
  });

  it("names the engine the browser next to it is running", function () {
    const agent = userAgentFor("scholar.google.com");
    const major = geckoMajorVersion();
    assert.include(agent, "Mozilla/5.0");
    assert.include(agent, `Firefox/${major}.0`);
    assert.include(
      agent,
      `rv:${major}.0`,
      "the engine version has to match the headers that surround it",
    );
  });

  it("knows which hosts play that game", function () {
    for (const host of [
      "scholar.google.com",
      "www.google.de",
      "scholar.google.co.uk",
      "www.google.com.hk",
    ]) {
      assert.isTrue(isGoogleHost(host), `${host} is a Google host`);
    }
    for (const host of [
      "openalex.org",
      "api.semanticscholar.org",
      "export.arxiv.org",
      "google.com.example.org",
    ]) {
      assert.isFalse(isGoogleHost(host), `${host} is not a Google host`);
    }
  });

  it("hands a refusal back instead of throwing, and still throws elsewhere", async function () {
    // The reported symptom: a 403 from Scholar left the count permanently
    // empty, because the status was thrown away before the block could be
    // recognised.
    const { transport } = stubTransport({
      status: 403,
      response: "<html><title>Sorry...</title>unusual traffic</html>",
    });
    const requester = new PacedRequester({
      timeoutMs: 5_000,
      intervalMs: 0,
      scholarPacing: NO_PACING,
      transport,
    });

    const page = await requester.requestPage(
      "https://scholar.google.com/scholar?hl=en&q=probe",
    );
    assert.equal(page.status, 403);
    assert.include(page.body, "Sorry");

    // Every other caller keeps the old contract: a non-2xx is an error there.
    let threw = false;
    try {
      await requester.requestText("https://api.example.org/likes");
    } catch (error) {
      threw = true;
      assert.include(String(error), "403");
    }
    assert.isTrue(
      threw,
      "requestText still reports a failed request to its callers",
    );
  });

  it("calls Zotero's own request as a method, which is what it needs", async function () {
    // The regression that broke the likes *and* the Scholar reads in the same
    // release: `const send = Zotero.HTTP.request; send(...)` hands the method
    // around without its receiver, and Zotero's request needs it
    // (`this._requestInternal`, `this.isWriteMethod`). Every production request
    // then threw before any network traffic, while the tests - which inject a
    // transport - never touched that path.
    const requester = new PacedRequester({ timeoutMs: 3_000, intervalMs: 0 });

    let message = "";
    try {
      // Nothing listens on this port, so the request is expected to fail - at
      // the network layer, which is the part that proves the call got there.
      await requester.requestPage("http://127.0.0.1:1/alphalikes-probe");
    } catch (error) {
      message = String(error instanceof Error ? error.message : error);
    }

    assert.notInclude(message, "_requestInternal");
    assert.notInclude(message, "isWriteMethod");
    assert.notInclude(
      message,
      "not a function",
      "a missing receiver must not be what fails the request",
    );
  });

  it("stores the consent cookie even when nothing has been read yet", function () {
    // Exposed so the failure mode is visible: a jar that refuses the cookie
    // is reported as `false` here rather than silently costing every result.
    assert.isTrue(ensureGoogleConsent());
    assert.isTrue(consentCookieStored());
  });

  it("writes the expiry in the unit the running jar counts in", function () {
    // The unit changed under the same interface. Gecko 145 (Zotero 11) reads
    // the expiry as milliseconds, so the seconds this used to pass are read as
    // a date in 1970: `add()` returns without complaint, the jar stays empty,
    // and every read keeps landing on the consent page. `maybeCapExpiry`
    // arrived with the new unit, and is what the browser calls before writing.
    const modern = { maybeCapExpiry: (milliseconds: number) => milliseconds };
    const legacy = { add: () => undefined };
    const now = Date.UTC(2026, 0, 1);
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;

    assert.isTrue(countsExpiryInMilliseconds(modern));
    assert.isFalse(countsExpiryInMilliseconds(legacy));
    assert.equal(consentExpiry(modern, now), now + oneYearMs);
    assert.equal(
      consentExpiry(legacy, now),
      Math.floor(now / 1000) + oneYearMs / 1000,
    );
  });

  it("leaves the stored consent cookie valid for a year, on any jar", function () {
    // A jar echoes back the number it was given and interprets it in its own
    // unit, so the check is on how long the cookie is good for once the
    // running jar reads it - not on the number's size. A write the jar dropped
    // reads as 1970 here, and is what this is for.
    assert.isTrue(ensureGoogleConsent());

    const cookies = Services.cookies.getCookiesFromHost(
      "scholar.google.com",
      {},
    ) as unknown as Array<{ name: string; expiry: number }>;
    const consent = cookies.find((cookie) => cookie.name === "SOCS");
    assert.isOk(consent, "the consent cookie is in the jar");

    const stored = consent?.expiry ?? 0;
    const expiresAt = countsExpiryInMilliseconds(Services.cookies)
      ? stored
      : stored * 1000;
    const year = 365 * 24 * 60 * 60 * 1000;
    assert.isAbove(
      expiresAt,
      Date.now() + year / 2,
      "a consent cookie that expires in 1970 is one Scholar never received",
    );
    assert.isBelow(
      expiresAt,
      Date.now() + year * 2,
      "and a cookie that never expires is not what a browser leaves either",
    );
  });

  describe("forgetting the Google session", function () {
    it("recognises every Google domain the reads can land on", function () {
      // Scholar answers on the country domains too, and the cookies that mark a
      // jar are set on whichever one answered.
      for (const host of [
        "google.com",
        ".google.com",
        "www.google.com",
        "scholar.google.com",
        "scholar.google.de",
        "accounts.google.com",
        "consent.google.com",
        "www.google.com.hk",
        "google.co.uk",
      ]) {
        assert.isTrue(isGoogleCookieHost(host), `${host} is a Google domain`);
      }

      for (const host of [
        "example.com",
        "notgoogle.com",
        "googleusercontent.com",
        "alphaxiv.org",
      ]) {
        assert.isFalse(isGoogleCookieHost(host), `${host} is not one of ours`);
      }
    });

    it("empties the jar without throwing when there is nothing to empty", function () {
      // Whatever the jar holds, the call is the user's "start over" button: it
      // reports what it removed and never turns into an error dialog.
      const removed = clearGoogleCookies();
      assert.isTrue(
        Number.isInteger(removed) && removed >= 0,
        "it answers with a count of what it removed",
      );
    });
  });
});
