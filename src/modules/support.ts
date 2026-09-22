/**
 * Which Zotero versions this build claims, and how it reads a version string.
 *
 * Declaring a range is not the same as being right about it, so this is kept
 * to the two things the plugin actually needs: one place for the numbers that
 * the manifest, the README and the diagnostic report all quote, and one parser
 * for the version strings Zotero hands out.
 *
 * The manifest allows `11.*`. Zotero 11 does not exist yet, so nothing here can
 * be tested against it - but nothing here is version-pinned to a 10 either: the
 * plugin only uses APIs that have been in Zotero since 7 (item-tree columns,
 * preferences, `Zotero.HTTP`, plugin preference panes) and it probes for the
 * optional ones instead of assuming them. That is what makes the range honest
 * rather than optimistic.
 */

/** The oldest Zotero major this build supports (Zotero 7, the WebExtension line). */
export const SUPPORTED_MAJOR_MIN = 7;

/**
 * The newest Zotero major this build supports.
 *
 * Kept in step with `strict_max_version` in `addon/manifest.json`; raising one
 * without the other means the plugin installs where it says it will not.
 */
export const SUPPORTED_MAJOR_MAX = 11;

/**
 * The major version in a Zotero version string, or `null` when there is none.
 *
 * Zotero has used `8.0.4`, `10.0.3-beta.2+80bc5565e` and (in its own builds)
 * `7.0.32`. The major is the leading run of digits, which is all a support
 * range needs; `beta`, `+hash` and anything else after it are irrelevant here.
 */
export function zoteroMajor(version: string): number | null {
  const match = /^\s*(\d+)/.exec(version ?? "");
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * Whether `version` falls inside the declared range.
 *
 * `null` means the version could not be read at all - unknown, not unsupported.
 * Callers that report to the user should say so instead of guessing, because
 * the failure mode of guessing wrong is telling someone their working setup is
 * broken.
 */
export function isSupportedZotero(version: string): boolean | null {
  const major = zoteroMajor(version);
  if (major === null) return null;
  return major >= SUPPORTED_MAJOR_MIN && major <= SUPPORTED_MAJOR_MAX;
}

/** The range as a label: `7–11`, the form the README and the report use. */
export function supportedRangeLabel(): string {
  return `${SUPPORTED_MAJOR_MIN}–${SUPPORTED_MAJOR_MAX}`;
}

/**
 * A line for the diagnostic report: nothing when the running Zotero is inside
 * the declared range, and otherwise what the range is and that this version is
 * outside it.
 *
 * A report that arrives from a version nobody has tested is worth knowing about
 * before the rest of it is read, but saying so on every report would be noise.
 */
export function zoteroSupportLine(version: string): string {
  const supported = isSupportedZotero(version);
  if (supported === true) return "";
  if (supported === null) {
    return `版本号读不出来（"${version}"），本插件声明支持 Zotero ${supportedRangeLabel()}，请留意。`;
  }
  return `本插件声明支持 Zotero ${supportedRangeLabel()}；当前是 ${version}，超出这个范围。`;
}
