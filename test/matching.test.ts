import { assert } from "chai";
import {
  arxivIDFromOpenAlexWork,
  buildArxivSearchURL,
  candidateFromCrossref,
  candidateFromOpenAlexWork,
  candidateFromSemanticScholar,
  classify,
  crossrefMetadata,
  normalizeDoi,
  parseArxivAtom,
  rankCandidates,
  selectBest,
  type PaperMetadata,
  type RawCandidate,
  type ResolverPrefs,
} from "../src/modules/resolver";
import {
  authorsMatch,
  levenshteinDistance,
  normalizeText,
  scoreCandidate,
  surnameOf,
  titleSimilarity,
  yearsMatch,
} from "../src/modules/similarity";

const THRESHOLDS: Pick<ResolverPrefs, "autoAccept" | "confirm"> = {
  autoAccept: 0.9,
  confirm: 0.7,
};

function paper(overrides: Partial<PaperMetadata> = {}): PaperMetadata {
  return {
    title: "Observation of Gravitational Waves from a Binary Black Hole Merger",
    doi: "10.1103/PhysRevLett.116.061102",
    authors: ["B. P. Abbott", "R. Abbott"],
    year: 2016,
    ...overrides,
  };
}

function candidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    arxivID: "1602.03837",
    title: "Observation of Gravitational Waves from a Binary Black Hole Merger",
    authors: ["B. P. Abbott", "R. Abbott"],
    year: 2016,
    source: "title:arxiv",
    authoritative: false,
    ...overrides,
  };
}

describe("AlphaLikes title matching", function () {
  describe("text normalisation", function () {
    it("strips LaTeX, punctuation and accents", function () {
      assert.equal(normalizeText("Café $\\alpha$-Test"), "cafe alpha test");
      assert.equal(
        normalizeText("Neural  Networks,\n  {Deep} Learning!"),
        "neural networks deep learning",
      );
    });
  });

  describe("similarity", function () {
    it("computes edit distance", function () {
      assert.equal(levenshteinDistance("kitten", "sitting"), 3);
      assert.equal(levenshteinDistance("same", "same"), 0);
    });

    it("scores identical titles as 1", function () {
      assert.equal(
        titleSimilarity(
          "Attention Is All You Need",
          "attention is all you need",
        ),
        1,
      );
    });

    it("keeps a short title from swallowing a longer one", function () {
      // A different paper whose title shares a long prefix must not match.
      const similarity = titleSimilarity(
        "Attention Is All You Need",
        "Attention Is All You Need In Speech Separation",
      );
      assert.isBelow(similarity, 0.9);
    });

    it("accepts a near-identical title with a subtitle", function () {
      const similarity = titleSimilarity(
        "Deep Residual Learning for Image Recognition",
        "Deep Residual Learning for Image Recognition",
      );
      assert.equal(similarity, 1);
    });

    it("treats an unknown author list as no evidence", function () {
      assert.isNull(authorsMatch(["Ashish Vaswani"], []));
      assert.isTrue(authorsMatch(["Ashish Vaswani"], ["A. Vaswani"]));
      assert.isFalse(authorsMatch(["Ashish Vaswani"], ["Yoshua Bengio"]));
    });

    it("matches names written in either order", function () {
      assert.equal(surnameOf("Vaswani, Ashish"), "vaswani");
      assert.equal(surnameOf("Ashish Vaswani"), "vaswani");
      assert.isTrue(authorsMatch(["Geoffrey Hinton"], ["Hinton, G."]));
    });

    it("uses a one-year tolerance", function () {
      assert.isTrue(yearsMatch(2016, 2017));
      assert.isFalse(yearsMatch(2016, 2019));
      assert.isNull(yearsMatch(null, 2016));
    });
  });

  describe("candidate scoring", function () {
    it("gives an exact match full confidence", function () {
      const result = scoreCandidate(paper(), candidate());
      assert.equal(result.score, 1);
      assert.isTrue(result.authorMatched);
    });

    it("does not punish missing author metadata", function () {
      const result = scoreCandidate(
        paper({ authors: [] }),
        candidate({ authors: [] }),
      );
      assert.equal(result.score, 1);
      assert.isNull(result.authorMatched);
    });

    it("drops confidence when the authors disagree", function () {
      const result = scoreCandidate(
        paper(),
        candidate({ authors: ["Someone Else"] }),
      );
      assert.isTrue(result.score < 0.9);
      assert.isFalse(result.authorMatched);
    });

    it("rejects an unrelated paper", function () {
      const result = scoreCandidate(
        paper(),
        candidate({
          title: "A Survey of Large Language Models",
          authors: ["Wei Zhao"],
          year: 2023,
        }),
      );
      assert.isBelow(result.score, 0.7);
    });
  });

  describe("ranking", function () {
    it("keeps only the best entry per arXiv ID", function () {
      const ranked = rankCandidates(
        paper(),
        [
          candidate({ source: "title:openalex" }),
          candidate({ source: "title:arxiv" }),
        ],
        THRESHOLDS,
      );
      assert.lengthOf(ranked, 1);
      assert.equal(ranked[0].arxivID, "1602.03837");
    });

    it("always trusts a DOI-confirmed candidate", function () {
      const ranked = rankCandidates(
        paper(),
        [
          candidate({
            arxivID: "1602.03837",
            title: "Completely different title",
            authors: [],
            year: 2001,
            authoritative: true,
            source: "doi:semantic-scholar",
          }),
        ],
        THRESHOLDS,
      );
      assert.lengthOf(ranked, 1);
      assert.equal(ranked[0].confidence, "high");
      assert.equal(ranked[0].score, 1);
    });

    it("strips the version suffix", function () {
      const ranked = rankCandidates(
        paper(),
        [candidate({ arxivID: "1602.03837v3" })],
        THRESHOLDS,
      );
      assert.equal(ranked[0].arxivID, "1602.03837");
    });

    it("hides candidates below the display floor", function () {
      const ranked = rankCandidates(
        paper(),
        [candidate({ title: "Something unrelated entirely", authors: [] })],
        THRESHOLDS,
      );
      assert.isEmpty(ranked);
    });
  });

  describe("confidence classification", function () {
    it("maps scores onto the three bands", function () {
      assert.equal(classify(0.95, false, THRESHOLDS), "high");
      assert.equal(classify(0.75, false, THRESHOLDS), "medium");
      assert.equal(classify(0.4, false, THRESHOLDS), "low");
      assert.equal(classify(0.1, true, THRESHOLDS), "high");
    });

    it("only selects a candidate at or above the confirm threshold", function () {
      const medium = rankCandidates(
        paper(),
        [
          candidate({
            title:
              "Observation of Gravitational Waves from a Binary Black Holes Merger",
            authors: [],
            year: 2016,
          }),
        ],
        THRESHOLDS,
      );
      assert.isNotNull(selectBest(medium, THRESHOLDS));

      const weak = rankCandidates(
        paper(),
        [candidate({ title: "Gravitational Waves", authors: [], year: 2016 })],
        THRESHOLDS,
      );
      assert.isNull(selectBest(weak, THRESHOLDS));
    });

    it("offers weak matches to the manual picker", function () {
      // The picker exists for the cases the automatic score is unsure about.
      // Filtering its list with the automatic floor is what made a search that
      // did return something look like a search that found nothing.
      const raw = [
        candidate({ title: "Gravitational Waves", authors: [], year: 2016 }),
      ];

      assert.lengthOf(rankCandidates(paper(), raw, THRESHOLDS), 0);
      assert.lengthOf(
        rankCandidates(paper(), raw, THRESHOLDS, 0.2),
        1,
        "a lower floor keeps the candidate selectable",
      );
      assert.lengthOf(
        rankCandidates(paper(), raw, THRESHOLDS, 0),
        1,
        "the picker's own floor is the only filter left",
      );
    });

    it("still ranks the kept candidates best first", function () {
      const raw = [
        // A different record: same real paper, wrong arXiv ID, no authors and
        // only part of the title.
        candidate({
          arxivID: "1602.00001",
          title: "Gravitational Waves",
          authors: [],
          year: 2016,
        }),
        candidate({
          title:
            "Observation of Gravitational Waves from a Binary Black Hole Merger",
          authors: ["B. P. Abbott", "R. Abbott"],
          year: 2016,
        }),
      ];

      const ranked = rankCandidates(paper(), raw, THRESHOLDS, 0.2);
      assert.lengthOf(ranked, 2, "both records are offered to the user");
      assert.equal(ranked[0].arxivID, "1602.03837");
      assert.isAbove(ranked[0].score, ranked[1].score);
    });
  });

  describe("provider payloads", function () {
    it("reads the arXiv ID out of a Semantic Scholar response", function () {
      const parsed = candidateFromSemanticScholar(
        {
          paperId: "abc",
          externalIds: { ArXiv: "1602.03837", DOI: "10.1103/x" },
          title: "Observation of Gravitational Waves",
          year: 2016,
          authors: [{ name: "B. P. Abbott" }],
        },
        "doi:semantic-scholar",
        true,
      );
      assert.equal(parsed?.arxivID, "1602.03837");
      assert.deepEqual(parsed?.authors, ["B. P. Abbott"]);
    });

    it("returns nothing when a paper has no arXiv version", function () {
      assert.isNull(
        candidateFromSemanticScholar(
          { externalIds: { DOI: "10.1/x" } },
          "doi:semantic-scholar",
          true,
        ),
      );
    });

    it("finds an arXiv location inside an OpenAlex work", function () {
      const work = {
        title: "Observation of Gravitational Waves",
        publication_year: 2016,
        doi: "https://doi.org/10.1103/physrevlett.116.061102",
        authorships: [{ author: { display_name: "B. P. Abbott" } }],
        locations: [
          { landing_page_url: "https://doi.org/10.1103/x", pdf_url: null },
          {
            landing_page_url: "https://arxiv.org/abs/1602.03837",
            pdf_url: "https://arxiv.org/pdf/1602.03837",
          },
        ],
      };
      assert.equal(arxivIDFromOpenAlexWork(work), "1602.03837");

      const parsed = candidateFromOpenAlexWork(work, "title:openalex", false);
      assert.equal(parsed?.arxivID, "1602.03837");
      assert.equal(parsed?.year, 2016);
    });

    it("recognises a DataCite arXiv DOI in OpenAlex", function () {
      assert.equal(
        arxivIDFromOpenAlexWork({
          doi: "https://doi.org/10.48550/arXiv.2301.12345",
        }),
        "2301.12345",
      );
    });

    it("ignores an OpenAlex work with no arXiv evidence", function () {
      assert.isNull(
        arxivIDFromOpenAlexWork({
          doi: "https://doi.org/10.1038/nature12373",
          locations: [
            { landing_page_url: "https://www.nature.com/articles/x" },
          ],
        }),
      );
    });

    it("reads Crossref metadata for a follow-up title search", function () {
      const payload = {
        message: {
          title: [
            "Observation of Gravitational Waves from a Binary Black Hole Merger",
          ],
          author: [{ given: "B. P.", family: "Abbott" }],
          issued: { "date-parts": [[2016, 2, 11]] },
        },
      };
      const metadata = crossrefMetadata(payload);
      assert.equal(metadata?.year, 2016);
      assert.deepEqual(metadata?.authors, ["B. P. Abbott"]);
      assert.isNull(candidateFromCrossref(payload));
    });

    it("recognises an arXiv link in a Crossref record", function () {
      const parsed = candidateFromCrossref({
        message: {
          title: ["Something"],
          link: [{ URL: "https://arxiv.org/abs/2301.12345" }],
        },
      });
      assert.equal(parsed?.arxivID, "2301.12345");
      assert.isTrue(parsed?.authoritative);
    });
  });

  describe("queries", function () {
    it("normalises DOI inputs", function () {
      assert.equal(normalizeDoi("https://doi.org/10.1/x"), "10.1/x");
      assert.equal(normalizeDoi("doi:10.1/x"), "10.1/x");
    });

    it("builds a quoted arXiv title query", function () {
      const url = buildArxivSearchURL('A "Quoted" Title', 5);
      assert.include(url, "export.arxiv.org/api/query");
      assert.include(url, "max_results=5");
      // The inner quotes are stripped so they cannot break the query syntax.
      assert.include(url, "ti%3A%22A+Quoted+Title%22");
    });

    it("falls back to a broad query", function () {
      assert.include(
        buildArxivSearchURL("Attention Is All You Need", 3, "all"),
        "all%3A%22Attention+Is+All+You+Need%22",
      );
    });
  });

  describe("arXiv Atom parsing", function () {
    function parseWithDOMParser(xml: string): Document {
      const mainWindow = Zotero.getMainWindow();
      const Parser = mainWindow?.DOMParser ?? DOMParser;
      return new Parser().parseFromString(xml, "application/xml");
    }

    it("reads entries, authors and years", function () {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>arXiv Query: search_query=ti:"x"</title>
          <entry>
            <id>http://arxiv.org/abs/1706.03762v7</id>
            <title>Attention Is All You Need</title>
            <published>2017-06-12T17:57:34Z</published>
            <author><name>Ashish Vaswani</name></author>
            <author><name>Noam Shazeer</name></author>
          </entry>
        </feed>`;

      const entries = parseArxivAtom(parseWithDOMParser(xml));
      assert.lengthOf(entries, 1);
      assert.equal(entries[0].arxivID, "1706.03762");
      assert.equal(entries[0].title, "Attention Is All You Need");
      assert.deepEqual(entries[0].authors, ["Ashish Vaswani", "Noam Shazeer"]);
      assert.equal(entries[0].year, 2017);
    });

    it("returns an empty list for an empty feed", function () {
      const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
      assert.isEmpty(parseArxivAtom(parseWithDOMParser(xml)));
      assert.isEmpty(parseArxivAtom(null));
    });
  });
});
