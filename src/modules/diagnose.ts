/**
 * The read diagnostic.
 *
 * "It does not work" cannot be debugged from a distance: what a read does
 * depends on the machine's network, its proxy settings, the address the
 * requests leave from, and what the two sites decide to answer that address. So
 * the plugin makes one real attempt at each read and writes down everything
 * that decided the outcome - the exact URL, the exact headers, the status, the
 * exception, and the first characters of the answer.
 *
 * Nothing in the settings pane runs this: the pane is for the settings a user
 * changes, not for troubleshooting. The report is produced on request (the
 * `diagnose` API method) and written to Zotero's debug log as a fallback.
 */

import { trimBodyHead, type ScholarAttempt } from "./http";
import { zoteroSupportLine } from "./support";

export { trimBodyHead };

/** One attempt at one URL, in the form the report needs. */
export interface HttpProbe {
  /** Which read this was, in words: "alphaXiv likes". */
  label: string;
  url: string;
  userAgent: string;
  /** `null` when the request never produced a response at all. */
  status: number | null;
  /** The exception's message, when the request threw. */
  error: string | null;
  bodyLength: number;
  bodyHead: string;
  /** What the plugin made of whatever came back. */
  verdict: string;
  /**
   * Every path that was tried, when the read has more than one.
   *
   * This is what separates "the address is blocked" from "this client is
   * blocked": one of them answers a browser and refuses a request, the other
   * refuses both.
   */
  attempts?: ScholarAttempt[];
}

export interface DiagnosisInput {
  pluginVersion: string;
  zoteroVersion: string;
  gecko: string;
  platform: string;
  /** The proxy preferences, or why they could not be read. */
  proxy: string;
  /** Whether Google's consent cookie is in Zotero's jar. */
  consentCookie: boolean;
  /** How many items were probed (the lines below run two per item). */
  itemCount: number;
  /** Two lines per probed item: what it is, and what state it is in. */
  items: string[];
  /** The settings that decide where the reads go. */
  settings: string[];
  probes: HttpProbe[];
  /**
   * What a third-party page saw of this client's handshake, per read path.
   *
   * Empty when the check could not run at all, which is not worth a section of
   * its own: the read failures above are the substance of the report.
   */
  fingerprints?: FingerprintReading[];
  /** Anything else worth saying, e.g. what to do with the report. */
  notes: string[];
}

import { FINGERPRINT_URL, type FingerprintReading } from "./http";

const PATH_NAMES: Record<string, string> = {
  browser: "浏览器页面加载",
  xhr: "直接请求",
};

function formatAttempt(attempt: ScholarAttempt): string {
  const name = PATH_NAMES[attempt.via] ?? attempt.via;
  if (attempt.status === null) {
    return `  ${name}：没有回应 — ${attempt.error ?? "未知错误"}`;
  }
  return `  ${name}：HTTP ${attempt.status}，${attempt.bytes} 字节`;
}

function formatProbe(probe: HttpProbe): string[] {
  const lines = [
    probe.label,
    `  URL：${probe.url}`,
    `  User-Agent：${probe.userAgent}`,
  ];

  if (probe.attempts && probe.attempts.length > 1) {
    lines.push("  两种读取方式的结果：");
    for (const attempt of probe.attempts) lines.push(formatAttempt(attempt));
  }

  if (probe.status === null) {
    lines.push(`  结果：请求失败 — ${probe.error ?? "未知错误"}`);
    return lines;
  }

  lines.push(`  结果：HTTP ${probe.status}，${probe.bodyLength} 字节`);
  lines.push(`  判定：${probe.verdict}`);
  if (probe.bodyHead) lines.push(`  正文开头：${probe.bodyHead}`);
  return lines;
}

export function formatDiagnosis(input: DiagnosisInput): string {
  // Empty unless the running Zotero is outside the range this build declares,
  // so the report says nothing about versions in the ordinary case.
  const support = zoteroSupportLine(input.zoteroVersion);
  const lines: string[] = [
    `AlphaPulse 读取诊断 · 插件 ${input.pluginVersion}`,
    `Zotero ${input.zoteroVersion}（Gecko ${input.gecko}）· ${input.platform}`,
    ...(support ? [support] : []),
    `代理：${input.proxy}`,
    `Google 同意 cookie：${input.consentCookie ? "已写入" : "未写入"}`,
    "",
    `条目（${input.itemCount} 个）：`,
    ...input.items.map((line) => `  ${line}`),
    "",
    "相关设置：",
    ...input.settings.map((line) => `  ${line}`),
    "",
    `实际请求（${input.probes.length} 次）：`,
  ];

  for (const probe of input.probes) lines.push(...formatProbe(probe));

  const fingerprints = input.fingerprints ?? [];
  if (fingerprints.length) {
    lines.push("", "浏览器指纹自检（tls.peet.ws 看到的样子）：");
    for (const reading of fingerprints) {
      const name = PATH_NAMES[reading.via] ?? reading.via;
      if (reading.error) {
        lines.push(`  ${name}：没有读到 — ${reading.error}`);
        continue;
      }
      lines.push(
        `  ${name}：JA3 ${reading.ja3Hash ?? "?"}，JA4 ${reading.ja4 ?? "?"}，` +
          `HTTP/2 Akamai ${reading.akamaiHash ?? "?"}`,
      );
      if (!reading.ja4 && reading.bodyHead) {
        lines.push(
          `    页面能打开，但里面没有指纹字段；开头是：${reading.bodyHead}`,
        );
      }
    }
    lines.push(
      "  这两条都来自 Zotero 自己的 Gecko 引擎（和 Firefox 同源，同一套 NSS 加密栈），" +
        "并不是 Python 或 curl 那种客户端；想对比的话，用你平时上网的火狐打开 " +
        FINGERPRINT_URL +
        " ，把里面的 JA3 哈希和 JA4 发回来，两边一致就说明 Google 的拒绝与 TLS 指纹无关。",
    );
  }

  // The same advice is produced once per probed item; saying it twice reads
  // like two different problems.
  const notes = [...new Set(input.notes)];
  if (notes.length) {
    lines.push("", "备注：");
    for (const note of notes) lines.push(`  ${note}`);
  }

  return lines.join("\n").trimEnd();
}

/**
 * How Zotero reaches the network, in words.
 *
 * This is the first thing to look at when a browser on the same machine works
 * and the plugin does not: a VPN client or a browser extension can be routing
 * the browser's traffic while Zotero goes out directly.
 */
export function describeProxy(): string {
  const types: Record<number, string> = {
    0: "直连（不使用代理）",
    1: "手动配置",
    2: "自动配置（PAC）",
    3: "自动检测（WPAD）",
    4: "系统代理设置",
    5: "系统设置",
  };

  try {
    const prefs = Services.prefs;
    const type = prefs.getIntPref("network.proxy.type", 0);
    const parts = [`type=${type}（${types[type] ?? "未知"}）`];

    if (type === 1 || type === 4 || type === 5) {
      const host = prefs.getCharPref("network.proxy.http", "");
      const port = prefs.getIntPref("network.proxy.http_port", 0);
      if (host) parts.push(`http=${host}:${port}`);
      const socks = prefs.getCharPref("network.proxy.socks", "");
      if (socks) {
        parts.push(
          `socks=${socks}:${prefs.getIntPref("network.proxy.socks_port", 0)}`,
        );
      }
    }
    if (type === 2) {
      parts.push(
        `pac=${prefs.getCharPref("network.proxy.autoconfig_url", "") || "（空）"}`,
      );
    }

    const excluded = prefs.getCharPref("network.proxy.no_proxies_on", "");
    if (excluded) parts.push(`排除=${excluded}`);
    return parts.join("; ");
  } catch (error) {
    return `无法读取代理设置（${
      error instanceof Error ? error.message : error
    }）`;
  }
}
