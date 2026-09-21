/**
 * What the plugin actually sends to Google Scholar.
 *
 * The reported bug: every Scholar read failed, while opening the verification
 * page in a browser on the same machine was fine. Scholar refuses an agent it
 * does not recognise - the plugin was announcing itself as `AlphaLikes/1.8.0`,
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
  ensureGoogleConsent,
  isGoogleHost,
  PacedRequester,
  userAgentFor,
  type HttpTransport,
} from "../src/modules/http";

interface Captured {
  method: string;
  url: string;
  options: Record<string, unknown>;
}

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

function headersOf(captured: Captured[]): Record<string, string> {
  return (captured[0]?.options.headers ?? {}) as Record<string, string>;
}

describe("the Google Scholar request", function () {
  it("looks like the browser next to it, and brings the consent cookie", async function () {
    const { captured, transport } = stubTransport({
      status: 200,
      response: "<html><body></body></html>",
    });
    const requester = new PacedRequester({
      timeoutMs: 5_000,
      intervalMs: 0,
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

  it("names this plugin to the APIs, which ask for a contactable agent", function () {
    const agent = userAgentFor("api.openalex.org");
    assert.include(agent, "AlphaLikes");
    assert.notInclude(agent, "Mozilla");
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

  it("stores the consent cookie even when nothing has been read yet", function () {
    // Exposed so the failure mode is visible: a jar that refuses the cookie
    // is reported as `false` here rather than silently costing every result.
    assert.isTrue(ensureGoogleConsent());
    assert.isTrue(consentCookieStored());
  });
});
