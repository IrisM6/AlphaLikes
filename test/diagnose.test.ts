/**
 * The read diagnostic.
 *
 * The point of the report is that it carries what the machine saw rather than
 * what the user remembers: the exact URLs, the statuses, the exception, the
 * proxy the request went through, and the first words of each answer. These
 * tests pin the report's shape and - with a stubbed requester - that running it
 * changes nothing: no cache, no setting, no Extra.
 */

import { assert } from "chai";
import { getService } from "../src/modules/column";
import pkg from "../package.json";
import {
  describeProxy,
  formatDiagnosis,
  trimBodyHead,
  type HttpProbe,
} from "../src/modules/diagnose";
import {
  failureReasonFrom,
  failureReasonIn,
  isFailureReason,
  withValueDecorations,
} from "../src/modules/likes";
import { setPref } from "../src/modules/prefs";

/** A page shaped like the alphaXiv paper view. */
function alphaXivPage(likes: number): string {
  return (
    `<html><body><button aria-label="Like this paper">` +
    `<span class="inline-block">${likes}</span></button></body></html>`
  );
}

/** A Scholar results page whose first hit is the item itself. */
function scholarPage(count: number, title: string): string {
  return `
    <div class="gs_r gs_or gs_scl"><div class="gs_ri">
      <h3 class="gs_rt"><a href="/url?q=https://example.org/p">${title}</a></h3>
      <div class="gs_fl"><a href="/scholar?cites=1">Cited by ${count}</a></div>
    </div></div>`;
}

interface Stub {
  served: string[];
  likes: number;
  scholar: number;
  scholarStatus: number;
  userName: string;
}

function stubRequester(service: unknown, likes: number, scholar = 0): Stub {
  const state: Stub = {
    served: [],
    likes,
    scholar,
    scholarStatus: 200,
    userName: "probe-agent",
  };
  const target = service as { requester: Record<string, unknown> };
  const previous = target.requester;

  target.requester = {
    ...previous,
    // The service asks the requester what the session's opening request to
    // Google answered; the real one keeps that state, a stub reports none.
    sessionWarmup: () => null,
    // Which path the next Scholar read starts with, and what the last one
    // tried - both are written into the report.
    scholarReadPath: () => "xhr" as const,
    lastScholarAttempts: () => null,
    // The Scholar probe runs both paths and compares them; this stub answers
    // on the request path, so the browser path reports itself as unavailable.
    requestScholarPage: async (url: string) => {
      state.served.push(url);
      const body =
        state.scholarStatus === 200
          ? scholarPage(state.scholar, "AlphaLikes diagnose probe paper")
          : "<html><title>Sorry...</title><body>unusual traffic</body></html>";
      return {
        status: state.scholarStatus,
        body: state.scholarStatus === 200 ? body : "",
        via: state.scholarStatus === 200 ? ("xhr" as const) : null,
        attempts: [
          {
            via: "browser" as const,
            status: null,
            error: "没有可用的浏览器组件",
            bytes: 0,
            bodyHead: "",
            usable: false,
          },
          {
            via: "xhr" as const,
            status: state.scholarStatus,
            error: null,
            bytes: body.length,
            bodyHead: trimBodyHead(body),
            usable: state.scholarStatus === 200,
          },
        ],
      };
    },
    requestPage: async (url: string) => {
      state.served.push(url);
      if (url.includes("alphaxiv.org")) {
        return {
          status: 200,
          body: alphaXivPage(state.likes),
          userAgent: state.userName,
        };
      }
      return {
        status: state.scholarStatus,
        body:
          state.scholarStatus === 200
            ? scholarPage(state.scholar, "AlphaLikes diagnose probe paper")
            : "<html><title>Sorry...</title><body>unusual traffic</body></html>",
        userAgent: state.userName,
      };
    },
  };

  return state;
}

describe("AlphaLikes diagnostics", function () {
  describe("failure reasons", function () {
    it("turns an exception into a reason the cell can carry", function () {
      assert.equal(
        failureReasonFrom(new Error("HTTP 403 for https://scholar.google.com")),
        "http-403",
      );
      assert.equal(failureReasonFrom(new Error("HTTP 429")), "http-429");
      assert.equal(failureReasonFrom(new Error("HTTP 404")), "http-4xx");
      assert.equal(failureReasonFrom(new Error("HTTP 503")), "http-5xx");
      assert.equal(
        failureReasonFrom(new Error("empty response from alphaXiv")),
        "empty",
      );
      assert.equal(
        failureReasonFrom(new Error("NS_ERROR_UNKNOWN_HOST")),
        "network",
      );
    });

    it("recognises a reason wherever the cell decorations carry it", function () {
      const value = withValueDecorations("N/A", ["http-403"]);
      const decorations = value.split("|").slice(1);
      assert.equal(failureReasonIn(decorations), "http-403");
      assert.equal(failureReasonIn(["12"]), null);
      assert.isTrue(isFailureReason("no-count"));
      assert.isFalse(isFailureReason("12"));
    });
  });

  describe("the report", function () {
    it("keeps the useful beginning of a body, and nothing more", function () {
      assert.equal(trimBodyHead("  a\n b\tc  "), "a b c");
      assert.equal(trimBodyHead(""), "");
      const long = trimBodyHead("x".repeat(400));
      assert.equal(long.length, 161);
      assert.isTrue(long.endsWith("…"));
    });

    it("spells out where the request goes instead of what it was set to", function () {
      const proxy = describeProxy();
      assert.include(proxy, "type=");
    });

    it("lays the report out so it can be pasted into a message", function () {
      const probe: HttpProbe = {
        label: "alphaXiv 点赞",
        url: "https://www.alphaxiv.org/abs/2401.00001",
        userAgent: "probe-agent",
        status: 403,
        error: null,
        bodyLength: 1103,
        bodyHead: "<html><title>Sorry</title> unusual traffic",
        verdict: "HTTP 403（正文开头就是服务器返回的内容）",
      };

      const report = formatDiagnosis({
        pluginVersion: "9.9.9",
        zoteroVersion: "9.0.6",
        gecko: "140",
        platform: "Linux",
        proxy: "type=0（直连）",
        consentCookie: true,
        itemCount: 1,
        items: ["「一篇论文」（id 12，journalArticle）"],
        settings: ["引用来源：googleScholar"],
        probes: [probe],
        notes: ["这份报告只包含这些真实请求的结果"],
      });

      assert.include(report, "插件 9.9.9");
      assert.include(report, "Zotero 9.0.6（Gecko 140）");
      assert.include(report, "type=0（直连）");
      assert.include(report, "Google 同意 cookie：已写入");
      assert.include(report, "条目（1 个）");
      assert.include(report, "「一篇论文」（id 12，journalArticle）");
      assert.include(report, "引用来源：googleScholar");
      assert.include(report, probe.url);
      assert.include(report, "结果：HTTP 403，1103 字节");
      assert.include(report, "正文开头：<html><title>Sorry</title>");
      assert.include(report, "这份报告只包含这些真实请求的结果");

      // The count is the number of items, not the number of lines: two lines
      // per item would otherwise read as four items.
      const two = formatDiagnosis({
        pluginVersion: "9.9.9",
        zoteroVersion: "9.0.6",
        gecko: "140",
        platform: "Linux",
        proxy: "type=0（直连）",
        consentCookie: false,
        itemCount: 2,
        items: ["a", "b", "c", "d"],
        settings: [],
        probes: [],
        notes: [],
      });
      assert.include(two, "条目（2 个）");
      assert.include(two, "实际请求（0 次）");

      // A request that never produced a response says so, and says why.
      const failed = formatDiagnosis({
        pluginVersion: "9.9.9",
        zoteroVersion: "9.0.6",
        gecko: "140",
        platform: "Linux",
        proxy: "type=0（直连）",
        consentCookie: false,
        itemCount: 1,
        items: [],
        settings: [],
        probes: [
          { ...probe, status: null, error: "NetworkError", bodyHead: "" },
        ],
        notes: [],
      });
      assert.include(failed, "结果：请求失败 — NetworkError");
      assert.include(failed, "Google 同意 cookie：未写入");
    });
  });

  describe("the probe against a stubbed network", function () {
    let service: ReturnType<typeof getService>;
    let item: Zotero.Item;
    let extraBefore: string;

    before(async function () {
      service = getService();
      // The diagnostic reports the interval it would use; nothing here waits.
      setPref("requestIntervalMs", 0);

      item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "AlphaLikes diagnose probe paper");
      item.setField("date", "2026-09-21");
      item.setField("url", "https://arxiv.org/abs/2401.00001");
      item.setField("extra", "alphaxiv_arxiv_id: 2401.00001");
      await item.saveTx();
      extraBefore = item.getField("extra");
    });

    after(async function () {
      try {
        await item.eraseTx();
      } catch {
        // The library may already be gone when the run tears down.
      }
    });

    it("probes both reads and reports what came back", async function () {
      const stub = stubRequester(service, 1127, 42);

      const report = await service.diagnose([Zotero.Items.get(item.id)]);

      assert.include(report, `插件 ${pkg.version}`);
      assert.include(report, "AlphaLikes diagnose probe paper");
      assert.include(
        stub.served.join(" "),
        "https://www.alphaxiv.org/abs/2401.00001",
        "the report has to name the URL the plugin would really request",
      );
      assert.include(report, "读到点赞数 1127");
      assert.include(report, "Cited by 42");
      assert.include(report, "HTTP 200");
      assert.include(report, "probe-agent");
    });

    it("changes nothing while it probes", async function () {
      stubRequester(service, 1127, 42);
      const ZoteroItem = Zotero.Items.get(item.id);

      await service.diagnose([ZoteroItem]);

      assert.equal(
        Zotero.Items.get(item.id).getField("extra"),
        extraBefore,
        "a diagnostic must not write a count into Extra",
      );
      assert.notInclude(
        service.getCellData(ZoteroItem),
        "1127",
        "and must not leave a count in the cell either",
      );
    });

    it("tells a rate limit apart from a refusal", async function () {
      // Google's two answers mean different things, and the report has to say
      // which one it got: only one of them is worth opening a browser for.
      const stub = stubRequester(service, 1127, 0);
      stub.scholarStatus = 429;

      const report = await service.diagnose([Zotero.Items.get(item.id)]);

      assert.include(report, "HTTP 429");
      assert.include(report, "限流");
      assert.include(report, "等待通常比换办法更快恢复");
    });

    it("points at the verification page when Google refused outright", async function () {
      const stub = stubRequester(service, 1127, 0);
      stub.scholarStatus = 403;

      const report = await service.diagnose([Zotero.Items.get(item.id)]);

      assert.include(report, "HTTP 403");
      assert.include(report, "打开 Google Scholar 验证页");
      assert.include(report, "unusual traffic");
      assert.isFalse(
        service.getScholarBlockStatus().blocked,
        "the diagnostic is read-only: it reports the refusal rather than " +
          "booking a wait of its own",
      );
    });

    it("explains a cleared item instead of leaving the blank column unexplained", async function () {
      const target = Zotero.Items.get(item.id);
      await service.clearItems([target]);

      const report = await service.diagnose([target]);

      assert.include(report, "已清除：是");
      assert.include(report, "被清除过");

      // Put the item back the way the other tests expect it.
      stubRequester(service, 1127, 42);
      await service.refreshItems([target]);
    });

    it("asks for a selection instead of guessing when nothing is selected", async function () {
      const report = await service.diagnose([]);

      assert.include(report, "没有选中任何条目");
      assert.include(report, "实际请求（0 次）");
    });
  });
});
