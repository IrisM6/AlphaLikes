import { assert } from "chai";
import {
  CSV_BOM,
  escapeCsvField,
  exportFileName,
  sortRows,
  toCsv,
  toJson,
  type ExportRow,
} from "../src/modules/export";

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    title: "Attention Is All You Need",
    doi: "10.1038/nature12373",
    arxivID: "1706.03762",
    likes: 2979,
    citations: 7608,
    influential: 56,
    highImpact: true,
    updated: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("AlphaLikes export", function () {
  describe("sorting", function () {
    it("puts the highest like count first by default", function () {
      const sorted = sortRows(
        [
          row({ title: "low", likes: 5 }),
          row({ title: "high", likes: 900 }),
          row({ title: "mid", likes: 100 }),
        ],
        "likes",
      );
      assert.deepEqual(
        sorted.map((entry) => entry.title),
        ["high", "mid", "low"],
      );
    });

    it("sorts unknown counts last instead of treating them as zero", function () {
      const sorted = sortRows(
        [
          row({ title: "unknown", likes: null }),
          row({ title: "zero", likes: 0 }),
        ],
        "likes",
      );
      assert.deepEqual(
        sorted.map((entry) => entry.title),
        ["zero", "unknown"],
      );
    });

    it("sorts by citation count", function () {
      const sorted = sortRows(
        [row({ title: "a", citations: 1 }), row({ title: "b", citations: 50 })],
        "citations",
      );
      assert.deepEqual(
        sorted.map((entry) => entry.title),
        ["b", "a"],
      );
    });

    it("keeps the Zotero order when asked", function () {
      const rows = [row({ title: "b" }), row({ title: "a" })];
      assert.deepEqual(
        sortRows(rows, "none").map((entry) => entry.title),
        ["b", "a"],
      );
    });

    it("does not mutate the input", function () {
      const rows = [
        row({ title: "a", likes: 1 }),
        row({ title: "b", likes: 2 }),
      ];
      sortRows(rows, "likes");
      assert.equal(rows[0].title, "a");
    });
  });

  describe("CSV", function () {
    it("quotes fields that contain separators", function () {
      assert.equal(escapeCsvField("a,b"), '"a,b"');
      assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
      assert.equal(escapeCsvField("line\nbreak"), '"line\nbreak"');
      assert.equal(escapeCsvField("plain"), "plain");
    });

    it("neutralises spreadsheet formulas", function () {
      assert.equal(escapeCsvField("=1+1"), "'=1+1");
      assert.equal(escapeCsvField("@SUM(A1)"), "'@SUM(A1)");
      assert.equal(escapeCsvField("-2"), "'-2");
    });

    it("starts with a byte-order mark so Excel keeps non-Latin titles", function () {
      const csv = toCsv([row({ title: "注意力就是一切" })]);
      assert.isTrue(csv.startsWith(CSV_BOM));
      assert.include(csv, "注意力就是一切");
    });

    it("writes a header and one line per item", function () {
      const csv = toCsv([row(), row({ title: "second" })], { bom: false });
      const lines = csv.trimEnd().split("\n");

      assert.lengthOf(lines, 3);
      assert.include(lines[0], "arXiv ID");
      assert.include(lines[0], "alphaXiv Likes");
      assert.include(lines[1], "1706.03762");
    });

    it("leaves missing values empty", function () {
      const csv = toCsv(
        [row({ likes: null, citations: null, highImpact: false, updated: "" })],
        { bom: false },
      );
      const fields = csv.trimEnd().split("\n")[1].split(",");
      assert.equal(fields[3], "");
      assert.equal(fields[4], "");
      assert.equal(fields[6], "");
    });
  });

  describe("JSON", function () {
    it("wraps the rows with metadata", function () {
      const payload = JSON.parse(
        toJson([row()], {
          version: "1.3.0",
          sortedBy: "likes",
          exportedAt: new Date("2026-09-20T10:00:00Z"),
        }),
      );

      assert.equal(payload.count, 1);
      assert.equal(payload.version, "1.3.0");
      assert.equal(payload.sortedBy, "likes");
      assert.equal(payload.exportedAt, "2026-09-20T10:00:00.000Z");
      assert.equal(payload.items[0].arxivID, "1706.03762");
    });
  });

  describe("file name", function () {
    it("is timestamped and safe on every platform", function () {
      const name = exportFileName("csv", new Date(2026, 8, 20, 9, 5));
      assert.equal(name, "alphalikes-20260920-0905.csv");
      assert.match(exportFileName("json"), /^alphalikes-\d{8}-\d{4}\.json$/);
    });
  });
});
