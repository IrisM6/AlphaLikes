/**
 * Registration and rendering of the AlphaPulse item-tree column.
 */

import { config } from "../../package.json";
import {
  CITATIONS_BLOCKED_MARKER,
  CITATION_SOURCE_LABELS,
  type CitationSourceKey,
} from "./citations";
import {
  CELL_CLEARED,
  CELL_LOADING,
  CELL_UNAVAILABLE,
  failureReasonIn,
  fromSortableValue,
  splitValueDecorations,
  type FailureReason,
} from "./likes";
import { t, type MessageId } from "./l10n";
import {
  colorBucket,
  getCitationAppearance,
  getCitationPrefs,
  getCitationSourcePreferences,
  getColorScheme,
  getLikeColorsCustomised,
  getLikeStyle,
  getRangeFilter,
  getTrendPrefs,
  isWithinRange,
  resolveStyleColors,
  type CitationAppearance,
  type ColorScheme,
  type CountLook,
  type LikeStyle,
} from "./prefs";
import {
  customPaint,
  PALETTES,
  SPLIT_RIGHT,
  translucent,
  type Band,
  type BandPaint,
} from "./palette";
import { AlphaLikesService } from "./service";

export const COLUMN_KEY = "alphaxiv_likes";
export const COLUMN_LABEL = "alphaXiv Likes";

/** Second column: citation counts from Semantic Scholar and OpenAlex. */
export const CITATIONS_COLUMN_KEY = "alphaxiv_citations";
export const CITATIONS_COLUMN_LABEL = "Citations";

/** Decoration value that marks a work as being in its field's top decile. */
const HIGH_IMPACT_MARKER = "1";
/** Superscript plus sign, kept as a literal so the cell needs no font tuning. */
const HIGH_IMPACT_GLYPH = "▲";

const NUMERIC_CELL_RE = /^\d+$/;

let service: AlphaLikesService | null = null;
let registeredDataKeys: string[] = [];

/**
 * The shared service instance. The context menu and the column both use it so
 * pending candidates and caches stay in one place.
 */
export function getService(): AlphaLikesService {
  if (!service) service = new AlphaLikesService();
  return service;
}

/**
 * The paint for one band of a palette style.
 *
 * A customised style brings its own paint (derived from the chosen colour);
 * otherwise the style's built-in one is used, byte for byte.
 */
function bandPaint(
  style: string,
  band: Band,
  custom: BandPaint | null,
): BandPaint {
  return custom ?? PALETTES[style]?.[band] ?? {};
}

/** Colours for the shape-only styles that fall back to the colour section. */
const OUTLINE_COLOR = "#CCCCCC";
const OUTLINE_TEXT = "#333333";

/**
 * Applies one of the display styles to the element that carries the text.
 *
 * All styles are inline so they survive `renderCell` having no stylesheet of
 * its own, and none of them change the cell's layout width: the item tree
 * measures column content from the outer cell element. `band` is the colour
 * band the count falls into, which the palette styles paint themselves; the
 * shape-only styles receive `accent` from the colour section instead.
 */
function applyLikeStyle(
  visual: HTMLElement,
  style: LikeStyle,
  accent: string,
  band: Band,
  doc: Document,
  prefix: string,
  paint: BandPaint | null = null,
): void {
  const color = accent.trim();

  // 玻璃胶囊：圆角胶囊 + 极淡的底色与描边。半透明让它在两种主题下都不刺眼，
  // 颜色仍来自「颜色」一节。
  if (style === "badge") {
    visual.style.padding = "1px 8px";
    visual.style.borderRadius = "999px";
    visual.style.background = translucent(color, 16);
    visual.style.border = `1px solid ${translucent(color, 36)}`;
    return;
  }

  if (style === "plain") return;

  // 细边框描边：透明底 + 1px 边框。
  if (style === "outline") {
    const outline = color || OUTLINE_TEXT;
    visual.style.padding = "1px 8px";
    visual.style.borderRadius = "999px";
    visual.style.background = "transparent";
    visual.style.border = `1px solid ${color || OUTLINE_COLOR}`;
    if (!visual.style.color) visual.style.color = outline;
    return;
  }

  // 侧边强调块：用左侧的粗边框当那条深色竖块，比塞一个子元素更稳。
  if (style === "bookmark") {
    const colors = bandPaint("bookmark", band, paint);
    visual.style.padding = "1px 8px 1px 7px";
    visual.style.borderRadius = "0 4px 4px 0";
    if (colors.background) visual.style.background = colors.background;
    if (colors.color) visual.style.color = colors.color;
    // One shorthand sets the hairline around the box, then the left edge is
    // widened into the accent block.
    visual.style.border = `1px solid ${colors.border ?? "transparent"}`;
    visual.style.borderLeftWidth = "3px";
    return;
  }

  // 莫兰迪、学术、清新、活泼：实底/浅底 + 文字，
  // 差别在圆角、字重与阴影。
  if (
    style === "morandi" ||
    style === "academic" ||
    style === "fresh" ||
    style === "playful"
  ) {
    const colors = bandPaint(style, band, paint);
    visual.style.padding = style === "academic" ? "0 6px" : "1px 8px";

    const radius =
      style === "morandi" || style === "fresh"
        ? "999px"
        : style === "academic"
          ? "3px"
          : "6px";
    visual.style.borderRadius = radius;
    if (colors.background) visual.style.background = colors.background;
    if (colors.color) visual.style.color = colors.color;

    if (colors.border) visual.style.border = `1px solid ${colors.border}`;
    else visual.style.border = "none";

    if (style === "academic") {
      // 学术严谨风用等宽数字、无阴影。
      visual.style.fontVariantNumeric = "tabular-nums";
      visual.style.fontWeight = "500";
    }
    if (style === "fresh") {
      visual.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.05)";
    }
    if (style === "playful") {
      // 硬阴影：位移实色，不带模糊。
      visual.style.fontWeight = "700";
      visual.style.boxShadow = band === "low" ? "none" : "2px 2px 0 #000000";
    }
    return;
  }

  // 数字角标：圆底白字，数字完整显示（位数多了就自然变成胶囊，不缩写）。
  if (style === "dot") {
    const colors = bandPaint("dot", band, paint);
    const text = visual.textContent ?? "";

    visual.style.display = "inline-flex";
    visual.style.alignItems = "center";
    visual.style.justifyContent = "center";
    visual.style.minWidth = "18px";
    visual.style.height = "18px";
    visual.style.padding = "0 5px";
    visual.style.borderRadius = text.length <= 2 ? "50%" : "999px";
    if (colors.background) visual.style.background = colors.background;
    if (colors.color) visual.style.color = colors.color;
    visual.style.fontSize = "0.8em";
    visual.style.fontWeight = "600";
    return;
  }

  // 双色拼接：左半深底白字放前缀，右半浅底深字放数字。
  if (style === "split") {
    const left = bandPaint("split", band, paint);
    const right = SPLIT_RIGHT[band];
    const value = visual.textContent ?? "";

    visual.textContent = "";
    visual.style.display = "inline-flex";
    visual.style.alignItems = "stretch";
    visual.style.borderRadius = "4px";
    visual.style.overflow = "hidden";
    visual.style.padding = "0";

    const leftPart = doc.createElement("span");
    leftPart.textContent = prefix;
    leftPart.style.padding = "1px 6px";
    if (left.background) leftPart.style.background = left.background;
    if (left.color) leftPart.style.color = left.color;
    leftPart.style.fontSize = "0.8em";
    leftPart.style.display = "inline-flex";
    leftPart.style.alignItems = "center";

    const rightPart = doc.createElement("span");
    rightPart.textContent = value;
    rightPart.style.padding = "1px 7px";
    if (right.background) rightPart.style.background = right.background;
    if (right.color) rightPart.style.color = right.color;

    visual.append(leftPart, rightPart);
    return;
  }

  // 玻璃圆形：正圆角标。宽数字无法保持正圆而不裁切，因此变成胶囊并把字号
  // 降一档。
  if (style === "ring") {
    const text = visual.textContent ?? "";
    visual.style.display = "inline-flex";
    visual.style.alignItems = "center";
    visual.style.justifyContent = "center";
    visual.style.minWidth = "22px";
    visual.style.height = "22px";
    visual.style.padding = "0 4px";
    visual.style.borderRadius = text.length <= 3 ? "50%" : "999px";
    visual.style.background = translucent(color, 18);
    visual.style.border = `1px solid ${translucent(color, 45)}`;
    visual.style.boxShadow =
      "inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 1px 2px rgba(0, 0, 0, 0.16)";
    if (text.length >= 4) visual.style.fontSize = "0.85em";
    return;
  }

  // Fallback for an unknown style: keep the count readable rather than blank.
  visual.style.padding = "1px 8px";
  visual.style.borderRadius = "999px";
  visual.style.background = translucent(color, 14);
}

export function renderLikeCell(
  data: string,
  column: { className: string },
  doc: Document,
): HTMLElement {
  const cell = doc.createElement("span");
  cell.className = `cell ${column.className}`;
  cell.style.justifyContent = "flex-end";
  cell.style.fontVariantNumeric = "tabular-nums";

  const { decorations } = splitValueDecorations(data);
  const text = fromSortableValue(data);
  const style = getLikeStyle();

  // The outer span keeps the cell's box; the inner one carries the styling so
  // that padding and borders cannot disturb the column's measured width.
  const visual = doc.createElement("span");
  visual.textContent = text;
  cell.appendChild(visual);

  if (NUMERIC_CELL_RE.test(text)) {
    const likes = Number.parseInt(text, 10);
    applyLikeCountStyling(cell, visual, likes, style, doc);
    appendTrend(cell, doc, decorations[0], likes);
    return cell;
  }

  if (text === CELL_LOADING) {
    cell.title = t("cell-loading");
    return cell;
  }

  // An item this plugin has no count for is left visually blank: a cell full
  // of "N/A" is noise to read past, and the tooltip is where the reason
  // belongs anyway.
  if (text === CELL_UNAVAILABLE) {
    visual.textContent = "";
    cell.title = failureTooltip(decorations, "cell-unavailable");
  }

  // A cleared item renders as an empty cell on purpose: the plugin's records
  // are gone, and nothing is read for it until the user asks for a refresh.
  // The tooltip is what keeps that from looking like a paper with no data.
  if (text === CELL_CLEARED) {
    visual.textContent = "";
    cell.title = t("cell-cleared");
  }

  return cell;
}

/**
 * Adds the day-over-day change next to the count, e.g. `2979 ↑12`.
 *
 * A rise at or above the "hot" threshold is drawn in the high colour and says
 * so in the tooltip; every other change stays muted so the number itself keeps
 * the reader's attention.
 */
function appendTrend(
  cell: HTMLElement,
  doc: Document,
  decoration: string | undefined,
  likes: number,
): void {
  if (decoration === undefined) return;

  const delta = Number.parseInt(decoration, 10);
  if (!Number.isSafeInteger(delta)) return;

  const prefs = getTrendPrefs();
  const scheme = getColorScheme();
  // The hot accent obeys the master colour switch, like the count does.
  const hot = scheme.enabled && prefs.hotDelta > 0 && delta >= prefs.hotDelta;

  const suffix = doc.createElement("span");
  suffix.textContent = `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}${Math.abs(delta)}`;
  suffix.style.marginInlineStart = "4px";
  suffix.style.fontSize = "0.85em";
  suffix.style.opacity = hot ? "1" : "0.7";
  if (hot && scheme.high) suffix.style.color = scheme.high;
  suffix.title = t("cell-trend", { delta, likes });

  cell.appendChild(suffix);
}

/**
 * The Citation appearance as a colour scheme.
 *
 * The percentiles are the likes ones on purpose: the pane says so, and the
 * citation banding then ranks by the same rule the like counts use.
 */
function citationScheme(appearance: CitationAppearance): ColorScheme {
  const scheme = getColorScheme();
  return {
    enabled: appearance.enabled,
    mode: appearance.mode,
    quantileLowPercent: scheme.quantileLowPercent,
    quantileHighPercent: scheme.quantileHighPercent,
    high: appearance.high,
    mid: appearance.mid,
    low: appearance.low,
    pending: "",
    customised: appearance.customised,
    highThreshold: appearance.highThreshold,
    lowThreshold: appearance.lowThreshold,
  };
}

/** Marker and tooltip for a work OpenAlex counts among the field's best. */
function appendHighImpact(
  cell: HTMLElement,
  visual: HTMLElement,
  doc: Document,
): void {
  const appearance = getCitationAppearance();
  const colors = resolveStyleColors({
    style: appearance.style,
    scheme: citationScheme(appearance),
    customised: appearance.customised,
    coloring: appearance.enabled,
    thresholds: {
      high: appearance.highThreshold,
      low: appearance.lowThreshold,
      source: appearance.mode,
    },
    effectiveThresholds: () => getService().getEffectiveCitationThresholds(),
    filter: appearance.filter,
    prefix: "",
  });

  const marker = doc.createElement("span");
  marker.textContent = HIGH_IMPACT_GLYPH;
  marker.style.marginInlineStart = "3px";
  marker.style.fontSize = "0.75em";
  marker.style.verticalAlign = "super";
  if (colors.high) marker.style.color = colors.high;
  cell.appendChild(marker);

  visual.title = t("cell-high-impact");
}

/**
 * Renders the Citations column.
 *
 * The styles and the banding apply here exactly as they do to the like
 * counts: the same `applyCountStyling` routine paints either column, so a
 * style or colour picked for the likes can be reused verbatim, and the
 * citation column can band by its own fixed cut-offs or by the same
 * percentile rule. What differs is only where the look comes from - the
 * citation preferences while the two appearances are unlinked - and the
 * high-impact marker, which stays tied to OpenAlex's top-decile flag.
 */
export function renderCitationCell(
  data: string,
  column: { className: string },
  doc: Document,
): HTMLElement {
  const cell = doc.createElement("span");
  cell.className = `cell ${column.className}`;
  cell.style.justifyContent = "flex-end";
  cell.style.fontVariantNumeric = "tabular-nums";

  const { decorations } = splitValueDecorations(data);
  const text = fromSortableValue(data);

  // The Citations column has its own style, colours, cut-offs and range
  // filter; by default they are the likes ones, so there is a single place to
  // edit and one routine that paints both columns.
  const appearance = getCitationAppearance();
  const service = getService();
  const look: CountLook = {
    style: appearance.style,
    scheme: citationScheme(appearance),
    customised: appearance.customised,
    coloring: appearance.enabled,
    thresholds: {
      high: appearance.highThreshold,
      low: appearance.lowThreshold,
      source: appearance.mode === "quantile" ? "quantile" : "threshold",
    },
    effectiveThresholds: () => service.getEffectiveCitationThresholds(),
    filter: appearance.filter,
    prefix: t("cell-split-prefix-citations"),
  };

  const visual = doc.createElement("span");
  visual.textContent = text;
  cell.appendChild(visual);

  if (NUMERIC_CELL_RE.test(text)) {
    const count = Number.parseInt(text, 10);
    const highImpact = decorations.includes(HIGH_IMPACT_MARKER);

    applyCountStyling(cell, visual, count, look, doc);

    const source = citationSourceFrom(decorations);
    if (highImpact) appendHighImpact(cell, visual, doc);
    if (source) {
      const line = t("cell-citation-source", { source });
      cell.title = visual.title ? `${line} · ${visual.title}` : line;
    }
    return cell;
  }

  if (text === CELL_LOADING) {
    // Its own message, not the like column's: "reading from alphaXiv" over a
    // citation cell names the wrong site entirely, and the user who reported
    // it read that as the like counts being refreshed too.
    const pause = getService().scholarPauseStatus();
    if (pause.paused) {
      // A row that waits minutes for its turn is not a broken row, and the
      // number of minutes left is the only thing the user can act on.
      cell.title = t("cell-burst-pause", { minutes: String(pause.minutes) });
      return cell;
    }

    const sources = getCitationSourcePreferences()
      .map((key) => CITATION_SOURCE_LABELS[key] ?? key)
      .join("、");
    cell.title = sources
      ? t("cell-citations-loading-from", { sources })
      : t("cell-citations-loading");
    return cell;
  }

  // An empty cell because Google Scholar is waiting out a human check says so,
  // and says how long until the next attempt: otherwise it is indistinguishable
  // from a paper that genuinely has no citations anywhere.
  if (text === CELL_CLEARED) {
    visual.textContent = "";
    cell.title = t("cell-cleared");
    return cell;
  }

  // Nothing read, nothing shown - the same rule as the like column. The
  // tooltip carries the reason, including which failure it was.
  if (text === CELL_UNAVAILABLE) {
    visual.textContent = "";
  }

  if (decorations.includes(CITATIONS_BLOCKED_MARKER)) {
    const status = getService().getScholarBlockStatus();
    // Rate limiting and a refusal are different answers from Google, and the
    // tooltip is the only place the difference reaches the user: one is worth
    // opening a browser for, the other is worth waiting out.
    const minutes = Math.max(1, status.minutesLeft);
    cell.title = status.rateLimited
      ? t("cell-scholar-rate-limited", { minutes })
      : t("cell-scholar-blocked", { minutes });
    cell.classList.add("alphalikes-citation-blocked");
  } else if (text === CELL_UNAVAILABLE) {
    cell.title = failureTooltip(decorations, "cell-citations-unavailable");
  }
  return cell;
}

/**
 * The tooltip for an empty cell.
 *
 * "N/A" says nothing about what went wrong, and the reason travels in the cell
 * value precisely so it can be turned into a sentence here: a refusal, a rate
 * limit, a dead network and a changed page all look identical otherwise.
 */
/**
 * How a failed cell carries the time until its next attempt.
 *
 * The cell value is the only channel the renderer has, so the number travels
 * with it as a decoration; the tooltip turns it into a sentence.
 */
const RETRY_MARKER = "retry:";

/** Used when a failure arrived without a time of its own. */
const CATCH_ALL_RETRY_MINUTES = "15";

function failureTooltip(decorations: string[], fallback: MessageId): string {
  const reason: FailureReason | null = failureReasonIn(decorations);
  if (!reason) return t(fallback);

  // The read sets how long until it tries again; "读取失败" without it reads as
  // "this is broken", and the wait is the part the user acts on.
  const minutes = decorations
    .find((entry) => entry.startsWith(RETRY_MARKER))
    ?.slice(RETRY_MARKER.length);
  const retry =
    minutes && /^\d+$/.test(minutes)
      ? t("cell-retry-in", { minutes })
      : t("cell-retry-in", { minutes: CATCH_ALL_RETRY_MINUTES });

  return t(
    fallback === "cell-unavailable"
      ? "cell-unavailable-reason"
      : "cell-citations-unavailable-reason",
    { reason: t(`failure-${reason}` as MessageId), retry },
  );
}

/** Maps the provider key carried in the cell data to its display name. */
function citationSourceFrom(decorations: string[]): string | null {
  for (const key of Object.keys(CITATION_SOURCE_LABELS)) {
    if (decorations.includes(key)) {
      return CITATION_SOURCE_LABELS[key as CitationSourceKey];
    }
  }
  return null;
}

/**
 * Paints one count into its cell.
 *
 * Both columns go through here, which is what makes their colouring identical:
 * the same banding, the same palette handling, the same filter presentation.
 * Only the `CountLook` differs — its style, its colours, its cut-offs, its
 * filter and its "likes" / "cited" prefix.
 */
function applyCountStyling(
  cell: HTMLElement,
  visual: HTMLElement,
  count: number,
  look: CountLook,
  doc: Document,
): void {
  const band: Band = look.coloring ? countBucket(count, look) : "mid";
  const colors = resolveStyleColors(look);

  if (look.filter.enabled && !isWithinRange(count, look.filter)) {
    // Out-of-range rows keep their number and are dimmed instead: the value
    // itself is never blanked, so sorting still sees the real figure.
    cell.style.opacity = "0.45";
    cell.title = t("cell-filtered");
    paintBand(cell, visual, look, { band: "low", accent: colors.low }, doc);
    return;
  }

  paintBand(cell, visual, look, { band, accent: colors[band] }, doc);

  if (look.coloring && look.thresholds.source === "quantile") {
    // The tooltip names the cut-offs actually used, not the configured ones:
    // in quantile mode those two differ, and the sample size is the reason the
    // rule fell back to a fixed threshold if it did.
    const effective = look.effectiveThresholds();
    appendQuantileTitle(cell, band, {
      high: effective.high,
      low: effective.low,
      sampleSize: effective.sampleSize ?? look.thresholds.sampleSize,
    });
  }
}

/** Applies one band's colour and the style's shape to the cell. */
function paintBand(
  cell: HTMLElement,
  visual: HTMLElement,
  look: CountLook,
  band: { band: Band; accent: string },
  doc: Document,
): void {
  const accent = look.coloring ? band.accent : "";
  // A palette style whose colours have not been touched keeps the paint it
  // ships with, byte for byte; only an edited colour is translated into the
  // style's own treatment. Anything else would silently redraw the shipped
  // looks the moment this module is loaded.
  const paint =
    accent && look.customised
      ? customPaint(look.style, band.band, accent)
      : null;

  if (accent) visual.style.color = accent;
  applyLikeStyle(
    visual,
    look.style,
    accent,
    band.band,
    doc,
    look.prefix,
    paint,
  );
}

/**
 * Which colour band a count falls into.
 *
 * In quantile mode the cut-offs are percentiles of the counts currently in the
 * item tree, so the same number can be "high" in one view and "mid" in another.
 * The service derives them and falls back to the fixed thresholds whenever the
 * sample is too small to rank.
 */
function countBucket(count: number, look: CountLook): Band {
  const thresholds = look.effectiveThresholds();
  return colorBucket(count, {
    ...look.scheme,
    highThreshold: thresholds.high,
    lowThreshold: thresholds.low,
  });
}

function applyLikeCountStyling(
  cell: HTMLElement,
  visual: HTMLElement,
  likes: number,
  style: LikeStyle,
  doc: Document,
): void {
  const scheme = getColorScheme();
  applyCountStyling(
    cell,
    visual,
    likes,
    {
      style,
      scheme,
      customised: getLikeColorsCustomised(),
      coloring: scheme.enabled,
      thresholds: getService().getEffectiveThresholds(),
      effectiveThresholds: () => getService().getEffectiveThresholds(),
      filter: getRangeFilter(),
      prefix: t("cell-split-prefix"),
    },
    doc,
  );
}

/** Explains a quantile-derived colour on hover. */
function appendQuantileTitle(
  cell: HTMLElement,
  bucket: ReturnType<typeof colorBucket>,
  thresholds: { high: number; low: number; sampleSize?: number },
): void {
  const sampleSize = thresholds.sampleSize ?? 0;
  const label =
    bucket === "high"
      ? t("cell-quantile-high")
      : bucket === "low"
        ? t("cell-quantile-low")
        : t("cell-quantile-mid");

  cell.title = t("cell-quantile-title", {
    label,
    high: thresholds.high,
    low: thresholds.low,
    sample: sampleSize,
  });
}

export async function registerAlphaXivLikesColumn(): Promise<string[]> {
  const activeService = getService();

  // `registerColumns` is the deprecated plural form, which calls the current
  // `registerColumn` internally. Using the singular keeps the call on the
  // supported API and still returns one data key.
  const result = await Zotero.ItemTreeManager.registerColumn({
    pluginID: config.addonID,
    dataKey: COLUMN_KEY,
    label: COLUMN_LABEL,
    enabledTreeIDs: ["main"],
    width: "110",
    minWidth: 72,
    showInColumnPicker: true,
    zoteroPersist: ["width", "hidden", "sortDirection"],
    dataProvider: (item: Zotero.Item) => activeService.getCellData(item),
    renderCell(_index, data, column, _isFirstColumn, doc) {
      return renderLikeCell(data, column, doc);
    },
  });

  registeredDataKeys = (Array.isArray(result) ? result : [result]).filter(
    (key): key is string => typeof key === "string",
  );
  if (!registeredDataKeys.length) {
    throw new Error(
      "AlphaPulse could not register its Zotero item-tree column",
    );
  }

  if (getCitationPrefs().enabled) {
    await registerCitationsColumn(activeService);
  }

  return registeredDataKeys;
}

/**
 * Registers the Citations column.
 *
 * Registration is conditional because the column is opt-out: with citation
 * lookups switched off the column would only ever render blanks.
 */
async function registerCitationsColumn(
  activeService: AlphaLikesService,
): Promise<void> {
  const result = await Zotero.ItemTreeManager.registerColumn({
    pluginID: config.addonID,
    dataKey: CITATIONS_COLUMN_KEY,
    label: t("column-citations-label"),
    enabledTreeIDs: ["main"],
    width: "90",
    minWidth: 64,
    showInColumnPicker: true,
    zoteroPersist: ["width", "hidden", "sortDirection"],
    dataProvider: (item: Zotero.Item) =>
      activeService.getCitationCellData(item),
    renderCell(_index, data, column, _isFirstColumn, doc) {
      return renderCitationCell(data, column, doc);
    },
  });

  const keys = (Array.isArray(result) ? result : [result]).filter(
    (key): key is string => typeof key === "string",
  );
  if (!keys.length) {
    Zotero.debug(
      "[AlphaPulse] Zotero refused the Citations column; like counts keep working",
    );
    return;
  }

  registeredDataKeys.push(...keys);
}

/** The part of `Zotero.ItemTreeManager` this plugin calls on shutdown. */
export interface ColumnRegistry {
  unregisterColumn?: (dataKey: string) => unknown;
  unregisterColumns?: (dataKeys: string[]) => unknown;
}

/**
 * Unregisters the columns this build registered.
 *
 * `unregisterColumn` (singular) is the supported call: the plural form has been
 * deprecated since Zotero 7 and calls the singular one internally, so a future
 * major may drop the plural - while Zotero 7 itself only has the plural. Both
 * are tried, newest first, and if neither exists the plugin says so instead of
 * throwing during shutdown, where an exception would leave the add-on looking
 * half-removed.
 */
export async function unregisterColumns(
  dataKeys: string[],
  registry: ColumnRegistry = Zotero.ItemTreeManager as ColumnRegistry,
): Promise<void> {
  if (typeof registry.unregisterColumn === "function") {
    for (const dataKey of dataKeys) await registry.unregisterColumn(dataKey);
    return;
  }
  if (typeof registry.unregisterColumns === "function") {
    await registry.unregisterColumns(dataKeys);
    return;
  }
  Zotero.debug(
    "[AlphaPulse] Zotero offers neither unregisterColumn nor unregisterColumns; the columns stay registered until restart",
  );
}

export async function shutdownAlphaXivLikesColumn(): Promise<void> {
  service?.dispose();
  service = null;

  if (registeredDataKeys.length) {
    await unregisterColumns(registeredDataKeys);
    registeredDataKeys = [];
  }
}
