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
 * The settings pane has a button that runs this and copies the text to the
 * clipboard. The labels are English on purpose: the report is read by whoever
 * is fixing the plugin, while the pane's own status line around it is
 * translated like every other string in the interface.
 */

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
  /** One line per item the diagnostic looked at. */
  items: string[];
  /** The settings that decide where the reads go. */
  settings: string[];
  probes: HttpProbe[];
  /** Anything else worth saying, e.g. what to do with the report. */
  notes: string[];
}

/** How much of a response body the report quotes. */
const BODY_HEAD_LIMIT = 160;

export function trimBodyHead(body: string): string {
  const clean = (body || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > BODY_HEAD_LIMIT
    ? `${clean.slice(0, BODY_HEAD_LIMIT)}…`
    : clean;
}

function formatProbe(probe: HttpProbe): string[] {
  const lines = [
    probe.label,
    `  URL: ${probe.url}`,
    `  User-Agent: ${probe.userAgent}`,
  ];

  if (probe.status === null) {
    lines.push(`  result: request failed - ${probe.error ?? "unknown error"}`);
    return lines;
  }

  lines.push(`  result: HTTP ${probe.status}, ${probe.bodyLength} bytes`);
  lines.push(`  verdict: ${probe.verdict}`);
  if (probe.bodyHead) lines.push(`  body starts: ${probe.bodyHead}`);
  return lines;
}

export function formatDiagnosis(input: DiagnosisInput): string {
  const lines: string[] = [
    `AlphaLikes read diagnostic - plugin ${input.pluginVersion}`,
    `Zotero ${input.zoteroVersion} (Gecko ${input.gecko}) - ${input.platform}`,
    `proxy: ${input.proxy}`,
    `Google consent cookie: ${input.consentCookie ? "present" : "missing"}`,
    "",
    `items (${input.items.length}):`,
    ...input.items.map((line) => `  ${line}`),
    "",
    "settings:",
    ...input.settings.map((line) => `  ${line}`),
    "",
    `requests actually made (${input.probes.length}):`,
  ];

  for (const probe of input.probes) lines.push(...formatProbe(probe));

  if (input.notes.length) {
    lines.push("", "notes:");
    for (const note of input.notes) lines.push(`  ${note}`);
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
    0: "direct (no proxy)",
    1: "manual",
    2: "automatic (PAC)",
    3: "automatic (WPAD)",
    4: "system proxy settings",
    5: "system settings",
  };

  try {
    const prefs = Services.prefs;
    const type = prefs.getIntPref("network.proxy.type", 0);
    const parts = [`type=${type} (${types[type] ?? "unknown"})`];

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
        `pac=${prefs.getCharPref("network.proxy.autoconfig_url", "") || "(empty)"}`,
      );
    }

    const excluded = prefs.getCharPref("network.proxy.no_proxies_on", "");
    if (excluded) parts.push(`no_proxy=${excluded}`);
    return parts.join("; ");
  } catch (error) {
    return `could not read the proxy preferences (${
      error instanceof Error ? error.message : error
    })`;
  }
}
