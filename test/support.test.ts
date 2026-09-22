/**
 * Compatibility with Zotero versions this build has never run on.
 *
 * Zotero 11 does not exist yet, so this cannot be a test against the real
 * thing. What it can do is keep the promises that are made about versions from
 * drifting apart - the manifest decides whether Zotero loads the plugin at all,
 * the report and the README tell the user a number - and pin the calls that are
 * asked to survive a major version, where a deprecated name disappears.
 */

import { assert } from "chai";
import manifest from "../addon/manifest.json";
import pkg from "../package.json";
import { unregisterColumns, type ColumnRegistry } from "../src/modules/column";
import {
  SUPPORTED_MAJOR_MAX,
  SUPPORTED_MAJOR_MIN,
  isSupportedZotero,
  supportedRangeLabel,
  zoteroMajor,
  zoteroSupportLine,
} from "../src/modules/support";
import { formatDiagnosis, type DiagnosisInput } from "../src/modules/diagnose";

/** The bits of `applications.zotero` in the add-on manifest. */
const zoteroManifest = manifest.applications.zotero as {
  strict_min_version: string;
  strict_max_version: string;
};

/** A report with nothing in it, so only the header lines are under test. */
function emptyDiagnosis(overrides: Partial<DiagnosisInput> = {}): string {
  return formatDiagnosis({
    pluginVersion: "1.2.0",
    zoteroVersion: "9.0.6",
    gecko: "140.12.0esr",
    platform: "WINNT_x86_64",
    proxy: "none",
    consentCookie: false,
    itemCount: 0,
    items: [],
    settings: [],
    probes: [],
    notes: [],
    ...overrides,
  });
}

describe("Zotero compatibility", function () {
  describe("the declared range", function () {
    it("reads the major out of every version string Zotero uses", function () {
      assert.equal(zoteroMajor("7.0.32"), 7);
      assert.equal(zoteroMajor("8.0.4"), 8);
      assert.equal(zoteroMajor("9.0.6"), 9);
      assert.equal(zoteroMajor("10.0.3"), 10);
      // A beta carries its build hash, and the hash is not part of the version.
      assert.equal(zoteroMajor("10.0.3-beta.2+80bc5565e"), 10);
      assert.equal(zoteroMajor("11.0"), 11);
      assert.equal(zoteroMajor(" 11.1.2 "), 11);
    });

    it("says nothing rather than guessing when the string is unreadable", function () {
      assert.isNull(zoteroMajor(""));
      assert.isNull(zoteroMajor("beta"));
      assert.isNull(isSupportedZotero(""));
      // Unknown is not the same answer as unsupported: only `false` may be
      // reported to the user as "this version is not supported".
      assert.isNull(isSupportedZotero("nightly"));
    });

    it("covers 7 through 11 and nothing outside it", function () {
      for (const version of [
        "7.0.32",
        "8.0.4",
        "9.0.6",
        "10.0.3",
        "10.0.3-beta.2+80bc5565e",
        "11.0",
        "11.4.1",
      ]) {
        assert.isTrue(
          isSupportedZotero(version),
          `${version} should be in range`,
        );
      }
      for (const version of ["6.0.27", "12.0", "20.1"]) {
        assert.isFalse(
          isSupportedZotero(version),
          `${version} should be out of range`,
        );
      }
    });

    it("allows the same range in the manifest that the plugin claims", function () {
      // Zotero reads these two itself, so they are what actually decides
      // whether the plugin loads: a range advertised here but not declared
      // there is a plugin that refuses to install.
      assert.equal(
        zoteroManifest.strict_max_version,
        `${SUPPORTED_MAJOR_MAX}.*`,
        "the manifest and SUPPORTED_MAJOR_MAX have to agree",
      );
      assert.equal(
        zoteroManifest.strict_min_version,
        "6.999",
        "6.999 is how a manifest says Zotero 7 and newer",
      );
      assert.isTrue(isSupportedZotero(`${SUPPORTED_MAJOR_MIN}.0`));
    });

    it("quotes the same range in the package description", function () {
      assert.include(
        pkg.description,
        `${SUPPORTED_MAJOR_MIN}-${SUPPORTED_MAJOR_MAX}`,
      );
    });

    it("keeps the range out of the report unless the version is outside it", function () {
      const inside = emptyDiagnosis();
      assert.notInclude(inside, supportedRangeLabel());
      assert.include(inside, "Zotero 9.0.6");

      const outside = emptyDiagnosis({ zoteroVersion: "12.0.1" });
      assert.include(outside, supportedRangeLabel());
      assert.include(outside, "12.0.1");

      const unreadable = emptyDiagnosis({ zoteroVersion: "nightly" });
      assert.include(unreadable, "nightly");
      assert.isString(zoteroSupportLine(""));
    });
  });

  describe("the item-tree column registry", function () {
    /** A registry that records the calls made on it. */
    function fakeRegistry(methods: Array<"singular" | "plural">) {
      const calls: string[] = [];
      const registry: ColumnRegistry = {};
      if (methods.includes("singular")) {
        registry.unregisterColumn = (dataKey: string) => {
          calls.push(`column:${dataKey}`);
        };
      }
      if (methods.includes("plural")) {
        registry.unregisterColumns = (dataKeys: string[]) => {
          calls.push(`columns:${dataKeys.join(",")}`);
          // Zotero's own plural implementation forwards to the singular one.
          for (const dataKey of dataKeys) registry.unregisterColumn?.(dataKey);
        };
      }
      return { registry, calls };
    }

    it("uses the current call when Zotero has one", async function () {
      // `unregisterColumn` is the supported name; the plural is deprecated and
      // is only still there because older Zotero versions predate the rename.
      const { registry, calls } = fakeRegistry(["singular", "plural"]);
      await unregisterColumns(["a", "b"], registry);
      assert.deepEqual(calls, ["column:a", "column:b"]);
    });

    it("falls back to the plural, which is all Zotero 7 has", async function () {
      // The fake's own plural forwards to its singular, which is absent in
      // this configuration - so the one recorded call is the plural.
      const { registry, calls } = fakeRegistry(["plural"]);
      await unregisterColumns(["a", "b"], registry);
      assert.deepEqual(calls, ["columns:a,b"]);
    });

    it("does not throw when a future Zotero offers neither", async function () {
      // Shutdown is the worst place for an exception: the add-on would look
      // half-removed, and the columns would stay behind either way.
      const { registry, calls } = fakeRegistry([]);
      await unregisterColumns(["a"], registry);
      assert.deepEqual(calls, []);
    });
  });
});
