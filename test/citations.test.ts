import { assert } from "chai";
import {
  CITATIONS_BLOCKED_MARKER,
  CITATIONS_KEY,
  citationProviderOrder,
  scholarRetryDelayMs,
  CITATION_AUTHORITY_ORDER,
  CITATIONS_UPDATED_KEY,
  citationCountsFromSemanticScholar,
  googleScholarCitationCount,
  googleScholarCitationSearchURL,
  googleScholarResultBlocks,
  googleScholarResultTitle,
  isHighImpact,
  openAlexCitationSearchURL,
  openAlexCitationURL,
  openAlexSearchResults,
  openAlexWorkInfo,
  parseCitationsLine,
  primaryCitationCount,
  primaryCitationSource,
  readCitations,
  readCitationsUpdatedAt,
  semanticScholarCitationURL,
  stripCitations,
  upsertCitations,
} from "../src/modules/citations";

const OTHER_EXTRA = "arXiv: 2301.12345\nPublisher: ACM";

describe("AlphaLikes citations", function () {
  describe("cache line", function () {
    it("reads every field", function () {
      const counts = parseCitationsLine(
        `${CITATIONS_KEY}: gs=8012,oa=1300,s2=1234,infl=56,top10=1,top1=0`,
      );

      assert.deepEqual(counts, {
        googleScholar: 8012,
        openAlex: 1300,
        semanticScholar: 1234,
        influential: 56,
        top10Percent: true,
        top1Percent: false,
      });
    });

    it("copes with partial provider coverage", function () {
      const counts = parseCitationsLine(`${CITATIONS_KEY}: s2=42`);
      assert.equal(counts?.semanticScholar, 42);
      assert.isUndefined(counts?.openAlex);
    });

    it("ignores unknown fields and junk values", function () {
      assert.isNull(parseCitationsLine(`${CITATIONS_KEY}: oa=abc,s2=`));
      assert.isNull(parseCitationsLine(OTHER_EXTRA));
      assert.deepEqual(
        parseCitationsLine(`${CITATIONS_KEY}: oa=7,weird=1`)?.openAlex,
        7,
      );
    });

    it("writes a compact line and keeps the rest of Extra", function () {
      const extra = upsertCitations(
        OTHER_EXTRA,
        { openAlex: 12, influential: 3 },
        new Date("2026-09-20T10:00:00.000Z"),
      );

      assert.include(extra, OTHER_EXTRA);
      assert.include(extra, `${CITATIONS_KEY}: oa=12,infl=3`);
      assert.include(
        extra,
        `${CITATIONS_UPDATED_KEY}: 2026-09-20T10:00:00.000Z`,
      );
    });

    it("keeps a known value when a later read misses that provider", function () {
      const first = upsertCitations(OTHER_EXTRA, {
        openAlex: 100,
        semanticScholar: 90,
      });
      const second = upsertCitations(first, { openAlex: 105 });

      const counts = readCitations(second);
      assert.equal(counts?.openAlex, 105);
      assert.equal(counts?.semanticScholar, 90);
    });

    it("replaces the line instead of appending a second one", function () {
      const first = upsertCitations(OTHER_EXTRA, { openAlex: 1 });
      const second = upsertCitations(first, { openAlex: 2 });

      // The updated-at line shares the prefix, so match the key exactly.
      const lines = second
        .split("\n")
        .filter((line) => line.startsWith(`${CITATIONS_KEY}:`));
      assert.lengthOf(lines, 1);
      assert.include(lines[0], "oa=2");
    });

    it("parses the timestamp back", function () {
      const extra = upsertCitations(
        OTHER_EXTRA,
        { openAlex: 1 },
        new Date("2026-09-20T10:00:00Z"),
      );
      assert.equal(
        readCitationsUpdatedAt(extra)?.toISOString(),
        "2026-09-20T10:00:00.000Z",
      );
      assert.isNull(readCitationsUpdatedAt(OTHER_EXTRA));
    });

    it("removes both lines and nothing else", function () {
      const extra = upsertCitations(OTHER_EXTRA, { openAlex: 5 });
      const stripped = stripCitations(extra);

      assert.notInclude(stripped, CITATIONS_KEY);
      assert.notInclude(stripped, CITATIONS_UPDATED_KEY);
      assert.include(stripped, "arXiv: 2301.12345");
      assert.include(stripped, "Publisher: ACM");
    });
  });

  describe("provider selection", function () {
    it("takes the first provider in the order it is given", function () {
      assert.equal(
        primaryCitationCount({ openAlex: 5, semanticScholar: 9 }, [
          "openAlex",
          "semanticScholar",
        ]),
        5,
      );
      assert.equal(
        primaryCitationCount(
          { googleScholar: 800, openAlex: 500, semanticScholar: 400 },
          CITATION_AUTHORITY_ORDER,
        ),
        800,
      );
      assert.isNull(primaryCitationCount(null, CITATION_AUTHORITY_ORDER));
      assert.isNull(
        primaryCitationCount({ influential: 3 }, CITATION_AUTHORITY_ORDER),
      );
    });

    it("falls through only when the order says it may", function () {
      // Walking the authority order still falls through...
      assert.equal(
        primaryCitationCount({ openAlex: 500, semanticScholar: 400 }, [
          "googleScholar",
          "openAlex",
          "semanticScholar",
        ]),
        500,
      );
      assert.equal(
        primaryCitationCount({ semanticScholar: 400 }, [
          "googleScholar",
          "openAlex",
          "semanticScholar",
        ]),
        400,
      );
    });

    it("honours an explicit order", function () {
      const counts = {
        googleScholar: 800,
        openAlex: 500,
        semanticScholar: 400,
      };
      assert.equal(primaryCitationCount(counts, ["semanticScholar"]), 400);
      // Providers outside the list are ignored, not guessed at.
      assert.isNull(
        primaryCitationCount({ influential: 2 }, ["googleScholar"]),
      );
      assert.deepEqual(
        [...CITATION_AUTHORITY_ORDER],
        ["googleScholar", "openAlex", "semanticScholar"],
      );
    });

    it("names the provider that produced the displayed count", function () {
      assert.equal(
        primaryCitationSource({ googleScholar: 1, openAlex: 2 }, [
          "googleScholar",
          "openAlex",
        ]),
        "googleScholar",
      );
      assert.equal(
        primaryCitationSource({ openAlex: 2 }, ["openAlex"]),
        "openAlex",
      );
      assert.isNull(primaryCitationSource({ infl: 1 }, ["googleScholar"]));
    });

    it("treats only the field-normalised percentile as high impact", function () {
      assert.isTrue(isHighImpact({ top10Percent: true }));
      assert.isTrue(isHighImpact({ top1Percent: true }));
      assert.isFalse(isHighImpact({ openAlex: 100000 }));
      assert.isFalse(isHighImpact(null));
    });
  });

  describe("the strict source choice", function () {
    it("asks one provider only, with nothing behind it", function () {
      assert.deepEqual(citationProviderOrder("googleScholar"), [
        "googleScholar",
      ]);
      assert.deepEqual(citationProviderOrder("openAlex"), ["openAlex"]);
      assert.deepEqual(citationProviderOrder("semanticScholar"), [
        "semanticScholar",
      ]);
    });

    it("shows nothing rather than another provider's number", function () {
      const counts = { openAlex: 42, semanticScholar: 7 };
      const order = citationProviderOrder("googleScholar");

      // The reported bug: Google Scholar had nothing for an item and the
      // column showed OpenAlex's count instead.
      assert.isNull(primaryCitationCount(counts, order));
      assert.isNull(primaryCitationSource(counts, order));
    });

    it("marks a blocked cell so it does not read as empty", function () {
      assert.isString(CITATIONS_BLOCKED_MARKER);
      assert.notEqual(CITATIONS_BLOCKED_MARKER, "");
      // The marker travels in the pipe-separated decoration list.
      assert.notInclude(CITATIONS_BLOCKED_MARKER, "|");
    });
  });

  describe("the Google Scholar retry backoff", function () {
    it("waits ten minutes before the first retry", function () {
      assert.equal(scholarRetryDelayMs(1), 10 * 60_000);
    });

    it("doubles the wait on every further block", function () {
      assert.equal(scholarRetryDelayMs(2), 20 * 60_000);
      assert.equal(scholarRetryDelayMs(3), 40 * 60_000);
    });

    it("stops growing at two hours", function () {
      assert.equal(scholarRetryDelayMs(10), 2 * 60 * 60_000);
      assert.equal(scholarRetryDelayMs(100), 2 * 60 * 60_000);
    });

    it("treats a nonsense attempt count as the first one", function () {
      assert.equal(scholarRetryDelayMs(0), 10 * 60_000);
      assert.equal(scholarRetryDelayMs(-3), 10 * 60_000);
    });
  });

  describe("requests", function () {
    it("keys Semantic Scholar on the DOI when there is one", function () {
      const url = semanticScholarCitationURL({ doi: "10.1038/nature12373" });
      assert.include(url ?? "", "/paper/DOI:10.1038%2Fnature12373");
      assert.include(url ?? "", "influentialCitationCount");
    });

    it("falls back to the arXiv ID", function () {
      const url = semanticScholarCitationURL({ arxivID: "2301.12345" });
      assert.include(url ?? "", "/paper/arXiv:2301.12345");
    });

    it("has nothing to ask when both identifiers are missing", function () {
      assert.isNull(semanticScholarCitationURL({}));
    });

    it("asks OpenAlex for the DOI with the polite-pool address", function () {
      const url = openAlexCitationURL({
        doi: "10.1038/nature12373",
        contactEmail: "me@example.org",
      });
      assert.include(url ?? "", "works/doi:10.1038%2Fnature12373");
      assert.include(url ?? "", "mailto=me%40example.org");
      assert.isNull(openAlexCitationURL({}));
    });

    it("searches OpenAlex by title when there is no DOI", function () {
      const url = openAlexCitationSearchURL("Attention is all you need", {
        perPage: 3,
      });
      assert.include(url, "works?search=Attention%20is%20all%20you%20need");
      assert.include(url, "per-page=3");
      assert.include(url, "citation_normalized_percentile");
    });
  });

  describe("responses", function () {
    it("reads a Semantic Scholar payload", function () {
      const counts = citationCountsFromSemanticScholar({
        citationCount: 1234,
        influentialCitationCount: 56,
        title: "ignored",
      });
      assert.deepEqual(counts, { semanticScholar: 1234, influential: 56 });
      assert.isNull(citationCountsFromSemanticScholar({}));
      assert.isNull(citationCountsFromSemanticScholar(null));
    });

    it("reads an OpenAlex work", function () {
      const info = openAlexWorkInfo({
        title: "Attention Is All You Need",
        doi: "https://doi.org/10.65215/2q58a426",
        publication_year: 2017,
        cited_by_count: 7608,
        citation_normalized_percentile: {
          value: 0.999,
          is_in_top_1_percent: true,
          is_in_top_10_percent: true,
        },
      });

      assert.equal(info?.counts.openAlex, 7608);
      assert.isTrue(info?.counts.top10Percent);
      assert.equal(info?.doi, "10.65215/2q58a426");
      assert.equal(info?.year, 2017);
    });

    it("survives a record with no percentile", function () {
      const info = openAlexWorkInfo({ cited_by_count: 12, title: "x" });
      assert.equal(info?.counts.openAlex, 12);
      assert.isUndefined(info?.counts.top10Percent);
      assert.isFalse(isHighImpact(info?.counts ?? null));
    });

    it("reads a search response and ignores extra entries", function () {
      const results = openAlexSearchResults({
        results: [
          { cited_by_count: 1, title: "a", publication_year: 2020 },
          "not an object",
        ],
      });
      assert.lengthOf(results, 1);
      assert.equal(results[0].counts.openAlex, 1);
    });

    it("returns nothing for a payload that is not a work", function () {
      assert.deepEqual(openAlexSearchResults(null), []);
      assert.isNull(openAlexWorkInfo("nope"));
    });
  });

  describe("Google Scholar", function () {
    it("quotes the title so Scholar matches the whole phrase", function () {
      const url = googleScholarCitationSearchURL("Attention is all you need");
      assert.include(url, "scholar.google.com/scholar");
      assert.include(url, "q=%22Attention%20is%20all%20you%20need%22");
      // Pinning the interface language keeps the "Cited by" label stable.
      assert.include(url, "hl=en");
    });

    it("reads the count out of a results page", function () {
      const html = `
        <div class="gs_r gs_or gs_scl">
          <div class="gs_ri">
            <h3 class="gs_rt"><a href="#">Attention Is All You Need</a></h3>
            <div class="gs_fl gs_flb">
              <a href="/scholar?cites=123">Cited by 8012</a>
            </div>
          </div>
        </div>`;
      assert.equal(googleScholarCitationCount(html), 8012);
    });

    it("reads a thousands separator", function () {
      const html =
        '<div id="gs_res_ccl_mid"><a href="#">Cited by 12,345</a></div>';
      assert.equal(googleScholarCitationCount(html), 12345);
    });

    it("reports a block page instead of a miss", function () {
      const html = "<html><body>Our systems have detected unusual traffic";
      assert.equal(googleScholarCitationCount(html), -1);
    });

    it("reports no result as a miss, not as a block", function () {
      assert.isNull(googleScholarCitationCount("<html><body>nothing here"));
      assert.isNull(googleScholarCitationCount(""));
    });

    it("splits results and reads their titles", function () {
      const html = `
        <div class="gs_r gs_or gs_scl"><div class="gs_ri">
          <h3 class="gs_rt"><a href="#">First &amp; Foremost</a></h3>
        </div></div>
        <div class="gs_r gs_or gs_scl"><div class="gs_ri">
          <h3 class="gs_rt"><span>[PDF]</span> <a href="#">Second Paper</a></h3>
        </div></div>`;

      const blocks = googleScholarResultBlocks(html);
      assert.lengthOf(blocks, 2);
      assert.equal(googleScholarResultTitle(blocks[0]), "First & Foremost");
      assert.equal(googleScholarResultTitle(blocks[1]), "Second Paper");
    });

    it("handles the Chinese interface labels too", function () {
      const html = '<div id="gs_res_ccl_mid">被引用次数：1234</div>';
      assert.equal(googleScholarCitationCount(html), 1234);
    });
  });
});
