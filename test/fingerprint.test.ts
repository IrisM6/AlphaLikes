/**
 * Reading the fingerprint page's answer.
 *
 * `tls.peet.ws/api/all` is what the self-check in the diagnostic report asks,
 * and it answers differently depending on how it was asked: a plain request
 * gets the JSON document, while a hidden browser hands back the same JSON
 * rendered inside an HTML document. Both have to end up as the same four
 * values, because which path answered is what the report is comparing.
 */

import { assert } from "chai";
import { FINGERPRINT_URL, readFingerprint } from "../src/modules/http";

const SAMPLE = {
  tls: {
    ja3: "771,4865-4867-4866,0-23-65281,4588-29-23,0",
    ja3_hash: "6f7889b9fb1a62a9577e685c1fcfa919",
    ja4: "t13d1717h2_5b57614c22b0_3cbfd9057e0d",
  },
  http2: {
    akamai_fingerprint: "1:65536;2:0;4:131072;5:16384|12517377|0|m,p,a,s",
    akamai_fingerprint_hash: "6ea73faa8fc5aac76bded7bd238f6433",
  },
};

describe("the fingerprint self-check's answer", function () {
  it("reads the fields out of the plain JSON a request gets", function () {
    const reading = readFingerprint(JSON.stringify(SAMPLE));

    assert.equal(reading.ja3, SAMPLE.tls.ja3);
    assert.equal(reading.ja3Hash, SAMPLE.tls.ja3_hash);
    assert.equal(reading.ja4, SAMPLE.tls.ja4);
    assert.equal(reading.akamaiHash, SAMPLE.http2.akamai_fingerprint_hash);
  });

  it("reads the same fields when a browser hands back the page", function () {
    // What the hidden browser returns is a document, with the JSON inside it
    // and the quotes escaped - which is why the parse cannot insist on JSON.
    const html =
      "<html><body><pre>" +
      JSON.stringify(SAMPLE)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;") +
      "</pre></body></html>";

    const reading = readFingerprint(html);

    assert.equal(reading.ja3Hash, SAMPLE.tls.ja3_hash);
    assert.equal(reading.ja4, SAMPLE.tls.ja4);
    assert.equal(reading.akamaiHash, SAMPLE.http2.akamai_fingerprint_hash);
  });

  it("keeps the fields it can find when the answer is not what was expected", function () {
    // Half a reading is still evidence; a parse error would leave the report
    // with a section that says nothing at all.
    const reading = readFingerprint(
      '<html>{"tls":{"ja4":"t13d1717h2_x"}}</html>',
    );

    assert.equal(reading.ja4, "t13d1717h2_x");
    assert.isNull(reading.ja3Hash);
    assert.isNull(reading.akamaiHash);
  });

  it("returns nothing rather than throwing on an error page", function () {
    const reading = readFingerprint(
      "<html><body>500 Server Error</body></html>",
    );

    assert.isNull(reading.ja3);
    assert.isNull(reading.ja3Hash);
    assert.isNull(reading.ja4);
    assert.isNull(reading.akamaiHash);
  });

  it("points at the page the user can open in their own browser", function () {
    // The comparison is the whole point of the section, and it only works if
    // the address in the report is the one the user has to open.
    assert.equal(FINGERPRINT_URL, "https://tls.peet.ws/api/all");
  });
});
